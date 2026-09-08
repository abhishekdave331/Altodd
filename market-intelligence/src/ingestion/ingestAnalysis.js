import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { withTransaction } from '../config/database.js';
import {
    parseJsonSafe,
    isValidAnalysis,
    getFirstDefined,
    nullifyLiteralNull,
    parseApplicants,
    combineExperience,
    coerceTriState,
    isFlatArrayAiLifecycle,
    parseLocation,
} from './validateAnalysis.js';
import { flattenJobSkills, assignPriority, upsertSkill } from './normalizeSkills.js';
import { normalizeRole, normalizeSeniority, upsertRole } from './normalizeRoles.js';
import { upsertCapability } from './normalizeCapabilities.js';
import { resolveTaxonomyValue } from '../normalization/resolveTaxonomyValue.js';
import { recordForReview } from '../normalization/reviewQueue.js';

// Evaluated BEFORE the corresponding upsertSkill/upsertCapability call, on
// the same transactional client, so "has this value ever been seen before"
// reflects true prior state - upsertSkill/upsertCapability always succeed by
// design (falling back to the raw text as its own canonical), so calling the
// resolver afterward would find its own just-created row and never queue
// anything. This is a read-only governance side-channel: its outcome never
// changes what upsertSkill/upsertCapability do, so existing ingestion
// behavior is fully preserved regardless of what happens here.
async function queueIfUnresolved(client, dimension, rawValue, jobId) {
    try {
        const resolution = await resolveTaxonomyValue({ dimension, rawValue, db: client });
        if (resolution.requiresReview) {
            await recordForReview({ resolution, db: client, jobId });
        }
    } catch (err) {
        // Never let a review-queue evaluation failure abort ingestion of the
        // job/skill/capability data itself - logged (not silently swallowed)
        // so a genuine bug is still visible, but not rethrown.
        console.error(`[review-queue] Failed to evaluate "${rawValue}" (${dimension}) for job ${jobId}: ${err.message}`);
    }
}

async function upsertJob(client, jobMetadata) {
    const { location, city, state, country } = parseLocation(jobMetadata);
    const employmentType = getFirstDefined(jobMetadata, ['employment_type', 'job_type', 'employmentType']) ?? null;
    const jobFunction = getFirstDefined(jobMetadata, ['job_function', 'jobFunction']) ?? null;
    const industry = getFirstDefined(jobMetadata, ['industry', 'industries']) ?? null;
    const postedAt = getFirstDefined(jobMetadata, ['posted_at', 'postedAt']) ?? null;
    const jobUrl = getFirstDefined(jobMetadata, ['job_url', 'url']) ?? null;
    const applicants = parseApplicants(jobMetadata.applicants);

    const result = await client.query(
        `INSERT INTO jobs (external_job_id, title, company, location, city, state, country,
                           employment_type, job_function, industry, applicants, posted_at, job_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (external_job_id) DO UPDATE SET
           title=EXCLUDED.title, company=EXCLUDED.company, location=EXCLUDED.location,
           city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country,
           employment_type=EXCLUDED.employment_type, job_function=EXCLUDED.job_function,
           industry=EXCLUDED.industry, applicants=EXCLUDED.applicants,
           posted_at=EXCLUDED.posted_at, job_url=EXCLUDED.job_url,
           last_seen_at=NOW()
         RETURNING id`,
        [
            String(jobMetadata.job_id),
            nullifyLiteralNull(jobMetadata.title) ?? 'Untitled',
            nullifyLiteralNull(jobMetadata.company),
            location,
            city,
            state,
            country,
            employmentType,
            jobFunction,
            industry,
            applicants,
            postedAt,
            jobUrl,
        ],
    );
    return result.rows[0].id;
}

async function upsertJobAnalysis(client, jobId, analysis) {
    await client.query(
        `INSERT INTO job_analysis (job_id, analysis_version, analysis)
         VALUES ($1, 'v1', $2::jsonb)
         ON CONFLICT (job_id, analysis_version) DO UPDATE SET analysis = EXCLUDED.analysis`,
        [jobId, JSON.stringify(analysis)],
    );
}

async function upsertJobSkills(client, jobId, skillsObj, skillPriority) {
    const flattened = assignPriority(flattenJobSkills(skillsObj), skillPriority);
    for (const skill of flattened) {
        await queueIfUnresolved(client, 'skill', skill.name, jobId);
        const skillId = await upsertSkill(client, skill.name, skill.normalized_name, skill.category);
        await client.query(
            `INSERT INTO job_skills (job_id, skill_id, category, priority)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (job_id, skill_id) DO UPDATE SET
               category = EXCLUDED.category,
               priority = COALESCE(EXCLUDED.priority, job_skills.priority)`,
            [jobId, skillId, skill.category, skill.priority],
        );
    }
}

async function upsertJobCapabilities(client, jobId, capabilities) {
    if (!Array.isArray(capabilities)) return;
    for (const rawText of capabilities) {
        if (!rawText || typeof rawText !== 'string') continue;
        await queueIfUnresolved(client, 'capability', rawText, jobId);
        const capabilityId = await upsertCapability(client, rawText);
        await client.query(
            `INSERT INTO job_capabilities (job_id, capability_id)
             VALUES ($1,$2)
             ON CONFLICT (job_id, capability_id) DO NOTHING`,
            [jobId, capabilityId],
        );
    }
}

async function upsertJobRoles(client, jobId, roleAnalysis) {
    const advertisedRole = normalizeRole(
        getFirstDefined(roleAnalysis, ['advertised_role', 'advertised_role_category']),
    );
    const actualRole = normalizeRole(
        getFirstDefined(roleAnalysis, ['actual_role_category', 'advertised_role_category']),
    );
    const seniority = normalizeSeniority(roleAnalysis?.seniority_inferred);
    const experience = roleAnalysis?.experience_required ?? {};
    const { minimum_experience, maximum_experience } = combineExperience(
        experience.minimum_years,
        experience.maximum_years,
        experience.preferred_years,
    );

    // Only actual_role feeds the canonical roles taxonomy - see Task 5.12
    // report for why: it's the LLM's "true role" classification (populated
    // for ~90% of jobs), whereas advertised_role is sparse (~14%) and closer
    // to a title-inflation signal than a second parallel role concept.
    // job_roles.advertised_role/actual_role themselves are untouched - this
    // only adds a canonical roles row alongside them, same non-blocking
    // resolve-then-upsert ordering already established for skills/capabilities.
    if (actualRole) {
        await queueIfUnresolved(client, 'role', actualRole, jobId);
        await upsertRole(client, actualRole);
    }

    await client.query(
        `INSERT INTO job_roles (job_id, advertised_role, actual_role, seniority, minimum_experience, maximum_experience)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (job_id) DO UPDATE SET
           advertised_role=EXCLUDED.advertised_role, actual_role=EXCLUDED.actual_role,
           seniority=EXCLUDED.seniority, minimum_experience=EXCLUDED.minimum_experience,
           maximum_experience=EXCLUDED.maximum_experience`,
        [jobId, advertisedRole, actualRole, seniority, minimum_experience, maximum_experience],
    );
}

async function upsertJobAttributes(client, jobId, productionRequirements, engineeringRequirements, domainAnalysis) {
    const p = productionRequirements ?? {};
    const e = engineeringRequirements ?? {};
    const domainExpertiseRequired = coerceTriState(domainAnalysis?.domain_expertise_required);

    const values = [
        jobId,
        coerceTriState(p.production_systems),
        coerceTriState(p.scalability),
        coerceTriState(p.reliability),
        coerceTriState(p.cloud),
        coerceTriState(p.containerization),
        coerceTriState(p.deployment),
        coerceTriState(p.monitoring),
        coerceTriState(p.observability),
        coerceTriState(p.cicd),
        coerceTriState(e.backend_development),
        coerceTriState(e.api_development),
        coerceTriState(e.system_design),
        coerceTriState(e.clean_architecture),
        coerceTriState(e.testing),
        coerceTriState(e.code_quality),
        domainExpertiseRequired,
    ];

    await client.query(
        `INSERT INTO job_attributes (job_id, production_systems, scalability, reliability, cloud,
           containerization, deployment, monitoring, observability, cicd,
           backend_development, api_development, system_design, clean_architecture, testing, code_quality,
           domain_expertise_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (job_id) DO UPDATE SET
           production_systems=EXCLUDED.production_systems, scalability=EXCLUDED.scalability,
           reliability=EXCLUDED.reliability, cloud=EXCLUDED.cloud,
           containerization=EXCLUDED.containerization, deployment=EXCLUDED.deployment,
           monitoring=EXCLUDED.monitoring, observability=EXCLUDED.observability, cicd=EXCLUDED.cicd,
           backend_development=EXCLUDED.backend_development, api_development=EXCLUDED.api_development,
           system_design=EXCLUDED.system_design, clean_architecture=EXCLUDED.clean_architecture,
           testing=EXCLUDED.testing, code_quality=EXCLUDED.code_quality,
           domain_expertise_required=EXCLUDED.domain_expertise_required`,
        values,
    );
}

async function upsertJobAiLifecycle(client, jobId, aiLifecycleCoverage) {
    if (isFlatArrayAiLifecycle(aiLifecycleCoverage) || !aiLifecycleCoverage) {
        // Old-format file (flat string[]) or entirely absent — can't reliably
        // map array items to specific lifecycle keys, so leave an all-NULL
        // row rather than crash or guess. DO NOTHING preserves a real object
        // form from a later re-ingest instead of clobbering it back to NULL.
        await client.query(
            `INSERT INTO job_ai_lifecycle (job_id)
             VALUES ($1)
             ON CONFLICT (job_id) DO NOTHING`,
            [jobId],
        );
        return;
    }

    const l = aiLifecycleCoverage;
    await client.query(
        `INSERT INTO job_ai_lifecycle (job_id, data_ingestion, data_processing, model_development,
           rag_pipeline, agent_development, evaluation, deployment, monitoring)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (job_id) DO UPDATE SET
           data_ingestion=EXCLUDED.data_ingestion, data_processing=EXCLUDED.data_processing,
           model_development=EXCLUDED.model_development, rag_pipeline=EXCLUDED.rag_pipeline,
           agent_development=EXCLUDED.agent_development, evaluation=EXCLUDED.evaluation,
           deployment=EXCLUDED.deployment, monitoring=EXCLUDED.monitoring`,
        [
            jobId,
            coerceTriState(l.data_ingestion),
            coerceTriState(l.data_processing),
            coerceTriState(l.model_development),
            coerceTriState(l.rag_pipeline),
            coerceTriState(l.agent_development),
            coerceTriState(l.evaluation),
            coerceTriState(l.deployment),
            coerceTriState(l.monitoring),
        ],
    );
}

export async function ingestFile(pool, filePath) {
    const fileName = path.basename(filePath);
    let raw;
    try {
        raw = await readFile(filePath, 'utf8');
    } catch (err) {
        return { file: fileName, status: 'error', error: err.message, timestamp: new Date().toISOString() };
    }

    const parsed = parseJsonSafe(raw);
    if (!parsed.ok) {
        return { file: fileName, status: 'skipped_invalid_json', error: parsed.error, timestamp: new Date().toISOString() };
    }

    const analysis = parsed.value;
    if (!isValidAnalysis(analysis)) {
        return {
            file: fileName,
            status: 'skipped_invalid_structure',
            error: 'Missing job_metadata.job_id',
            timestamp: new Date().toISOString(),
        };
    }

    try {
        const jobId = await withTransaction(async (client) => {
            const jobId = await upsertJob(client, analysis.job_metadata);
            await upsertJobAnalysis(client, jobId, analysis);
            await upsertJobSkills(client, jobId, analysis.skills, analysis.skill_priority);
            await upsertJobCapabilities(client, jobId, analysis.capabilities);
            await upsertJobRoles(client, jobId, analysis.role_analysis ?? {});
            await upsertJobAttributes(
                client,
                jobId,
                analysis.production_requirements,
                analysis.engineering_requirements,
                analysis.domain_analysis,
            );
            await upsertJobAiLifecycle(client, jobId, analysis.ai_lifecycle_coverage);
            return jobId;
        });

        return { file: fileName, status: 'ok', jobId };
    } catch (err) {
        return { file: fileName, status: 'error', error: err.message, timestamp: new Date().toISOString() };
    }
}

export async function ingestDirectory(pool, dirPath) {
    const entries = await readdir(dirPath);
    const jsonFiles = entries.filter((name) => name.endsWith('.json'));

    const results = [];
    for (const fileName of jsonFiles) {
        const result = await ingestFile(pool, path.join(dirPath, fileName));
        results.push(result);
        if (result.status !== 'ok') {
            console.error(`[ingest] ${result.file}: ${result.status} - ${result.error}`);
        } else {
            console.log(`[ingest] ${result.file}: ok (job ${result.jobId})`);
        }
    }

    const succeeded = results.filter((r) => r.status === 'ok').length;
    return {
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        results,
    };
}
