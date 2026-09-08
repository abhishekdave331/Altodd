// Task 7.7: thin HTTP boundary around profile-enrichment's existing resume
// pipeline - upload handling/validation and DB reads only, no extraction/
// Groq/persistence logic lives here.
import { Router } from 'express';
import multer from 'multer';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pool } from '../config/database.js';
import { processResume, ResumeProcessingError } from '../services/resumeEnrichmentService.js';
import { getUserProfileWithResume } from '../services/profileService.js';
import { generateSearchConfiguration, SearchConfigGenerationError } from '../services/searchConfigGenerationService.js';
import { getUserProfileForGeneration, listSearchConfigurationsForProfile, getLatestValidSearchConfiguration } from '../services/searchConfigService.js';
import { createPipelineRun, getActivePipelineRunForProfile } from '../services/pipelineRunService.js';
import { spawnPersonalizedPipeline } from '../services/pipelineExecutionService.js';

export const profileRoutes = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres error code for a unique_violation - same race-window backstop as
// pipelineRoutes.js's POST /api/pipeline-runs (migration 010's partial
// unique index is the single source of truth for "one active run per
// profile"; this endpoint deliberately does not add a second mechanism).
const UNIQUE_VIOLATION = '23505';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB - a text-based resume PDF has no legitimate reason to exceed this.
const TMP_UPLOAD_DIR = path.resolve(import.meta.dirname, '..', '..', 'tmp-uploads');
const PDF_MAGIC_BYTES = Buffer.from('%PDF-');

const upload = multer({
    // Custom filename (rather than multer's default `dest` shorthand,
    // which generates an extensionless temp name) - processResume.js
    // determines the resume format from the file's own extension, matching
    // its existing CLI usage (`process-resume -- <path.pdf>`), so the temp
    // copy must keep a real .pdf extension for that check to pass.
    storage: multer.diskStorage({
        destination: TMP_UPLOAD_DIR,
        filename: (req, file, cb) => cb(null, `${randomUUID()}.pdf`),
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        // Extension + declared mimetype are both attacker-controlled labels,
        // not proof of real content - true content is checked separately
        // via magic bytes below, once the file is actually on disk. This
        // filter only screens out the obviously-wrong case early.
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.pdf' || file.mimetype !== 'application/pdf') {
            return cb(new Error('UNSUPPORTED_FORMAT'));
        }
        cb(null, true);
    },
}).single('resume');

function asyncHandler(fn) {
    return (req, res, next) => fn(req, res, next).catch(next);
}

function handleUpload(req, res, next) {
    upload(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: `File exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.` });
        }
        if (err && err.message === 'UNSUPPORTED_FORMAT') {
            return res.status(400).json({ error: 'Only PDF resumes are supported.' });
        }
        if (err) return next(err);
        next();
    });
}

profileRoutes.post('/resume', handleUpload, asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No resume file was uploaded. Send it as multipart/form-data under the "resume" field.' });
    }

    const tempPath = req.file.path;

    try {
        if (req.file.size === 0) {
            return res.status(400).json({ error: 'Uploaded file is empty.' });
        }

        // Magic-byte check: a renamed non-PDF (e.g. a .txt file uploaded as
        // "resume.pdf" with a spoofed mimetype) would otherwise reach
        // pdf-parse and fail there with a much less clear error.
        const header = await readFile(tempPath, { encoding: null, flag: 'r' });
        if (!header.subarray(0, 5).equals(PDF_MAGIC_BYTES)) {
            return res.status(400).json({ error: 'File does not appear to be a valid PDF.' });
        }

        let result;
        try {
            result = await processResume(tempPath, req.file.originalname);
        } catch (err) {
            if (err instanceof ResumeProcessingError) {
                if (err.stage === 'extraction') {
                    // Bad/unreadable input file - the client's fault, not ours.
                    return res.status(422).json({ error: `Could not extract text from this resume: ${err.message}` });
                }
                if (err.stage === 'enrichment') {
                    // Groq failed, but the resume was safely stored and an
                    // honest 'failed' user_profiles row already exists -
                    // never reported as if enrichment succeeded.
                    return res.status(502).json({
                        error: `Resume was stored but enrichment failed: ${err.message}`,
                        user_profile_id: err.profileId,
                        enrichment_status: 'failed',
                    });
                }
                // 'persistence' or 'storage' or generic 'process' failure - our infrastructure, not the client's input.
                return res.status(500).json({ error: `Resume processing failed: ${err.message}` });
            }
            throw err;
        }

        res.status(201).json({
            user_profile_id: result.profileId,
            enrichment_status: result.status,
            enriched_profile: result.profile,
            created_at: result.createdAt,
        });
    } finally {
        await unlink(tempPath).catch(() => {});
    }
}));

profileRoutes.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid profile id format.' });
    }

    const profile = await getUserProfileWithResume(pool, id);
    if (!profile) {
        return res.status(404).json({ error: `No user profile found with id "${id}".` });
    }

    res.json({ profile });
}));

// Task 7.8
profileRoutes.post('/:id/search-configuration', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid profile id format.' });
    }

    const profile = await getUserProfileForGeneration(pool, id);
    if (!profile) {
        return res.status(404).json({ error: `No user profile found with id "${id}".` });
    }

    if (profile.enrichment_status === 'failed') {
        // Nothing real to generate from: enrichment produced no usable
        // profile data (enriched_profile is {}). Running the LLM step on
        // that would either return honestly-empty queries (best case, but a
        // wasted Groq call for a result we already know) or risk it
        // reaching for generic filler despite the prompt's own guardrail -
        // reject clearly instead of gambling on the model's behavior.
        return res.status(422).json({
            error: 'Cannot generate a search configuration: this profile\'s resume enrichment failed, so there is no real profile data to generate search parameters from.',
        });
    }

    let config;
    try {
        config = await generateSearchConfiguration(id);
    } catch (err) {
        if (err instanceof SearchConfigGenerationError) {
            if (err.stage === 'generation') {
                // Groq failed, but an honest 'failed' search_configurations
                // row already exists (deterministic filters preserved) -
                // never reported as if generation succeeded.
                return res.status(502).json({
                    error: `Search configuration generation failed: ${err.message}`,
                    ...(err.configId && { id: err.configId, generation_status: 'failed' }),
                });
            }
            return res.status(500).json({ error: `Search configuration generation failed: ${err.message}` });
        }
        throw err;
    }

    res.status(201).json({ search_configuration: config });
}));

profileRoutes.get('/:id/search-configurations', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid profile id format.' });
    }

    const profile = await getUserProfileForGeneration(pool, id);
    if (!profile) {
        return res.status(404).json({ error: `No user profile found with id "${id}".` });
    }

    const rawLimit = Number(req.query.limit ?? 20);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

    const configs = await listSearchConfigurationsForProfile(pool, id, limit);
    res.json({ search_configurations: configs });
}));

// Task 7.11: closes a gap found during the Module 7 API surface review -
// getLatestValidSearchConfiguration already existed and was already used
// internally by POST /:id/run-job-search (Task 7.9), but was never exposed
// to a caller. Without this, a frontend's only option was GET
// /:id/search-configurations and picking the newest entry client-side -
// which is WRONG whenever the most recent generation attempt failed
// (generation_status='failed'), since that failed row would sort first but
// is exactly the one run-job-search would skip. This route reuses that
// existing, already-tested function as-is - no new query logic.
profileRoutes.get('/:id/search-configurations/latest', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid profile id format.' });
    }

    const profile = await getUserProfileForGeneration(pool, id);
    if (!profile) {
        return res.status(404).json({ error: `No user profile found with id "${id}".` });
    }

    // A profile that exists but has no valid configuration yet is an
    // honest, expected state (e.g. right after enrichment, before the first
    // generation) - null here, not a 404, matching this project's existing
    // "no data yet" convention (e.g. dashboardService's insufficient-data
    // responses) rather than treating an empty result as an error.
    const config = await getLatestValidSearchConfiguration(pool, id);
    res.json({ search_configuration: config });
}));

// Task 7.9: convenience/orchestration endpoint over the existing Task 7.6
// (pipelineRunService/pipelineExecutionService) and Task 7.8
// (searchConfigGenerationService) services - it does not run Apify or Groq
// itself, does not talk to scraper-orchestration/llm-pipeline directly, and
// does not implement its own concurrency mechanism. The lower-level
// POST /api/pipeline-runs and POST /api/profiles/:id/search-configuration
// endpoints are untouched and still work exactly as before this task.
profileRoutes.post('/:id/run-job-search', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid profile id format.' });
    }

    const profile = await getUserProfileForGeneration(pool, id);
    if (!profile) {
        return res.status(404).json({ error: `No user profile found with id "${id}".` });
    }

    if (profile.enrichment_status === 'failed') {
        return res.status(422).json({
            error: 'Cannot start a job search: this profile\'s resume enrichment failed, so there is no real profile data to search from.',
        });
    }

    // Cheap check first, before any possible Groq call below - reuses Task
    // 7.6's exact active-run definition rather than a second concurrency
    // mechanism. The unique index from migration 010 is still the actual
    // correctness guarantee against the race window; see the 23505 catch
    // further down.
    const activeRun = await getActivePipelineRunForProfile(pool, id);
    if (activeRun) {
        return res.status(409).json({
            error: 'A pipeline run is already in progress for this profile.',
            pipeline_run: activeRun,
        });
    }

    // "Latest valid configuration" = Task 7.3's loadLatestSearchConfiguration
    // semantics (generation_status != 'failed', newest first) - reused as-is
    // rather than regenerated, so a pipeline run doesn't burn an extra Groq
    // call every single time this endpoint is hit for a profile that
    // already has a perfectly usable configuration.
    let searchConfig = await getLatestValidSearchConfiguration(pool, id);
    if (!searchConfig) {
        try {
            searchConfig = await generateSearchConfiguration(id);
        } catch (err) {
            if (err instanceof SearchConfigGenerationError) {
                // No pipeline run is created in this branch at all - a
                // search-configuration failure must never lead to a
                // pipeline_runs row that then has nothing valid to search
                // with.
                return res.status(502).json({
                    error: `Could not generate a search configuration for this profile: ${err.message}`,
                });
            }
            throw err;
        }
    }

    let run;
    try {
        run = await createPipelineRun(pool, id, searchConfig.id);
    } catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
            const raceWinner = await getActivePipelineRunForProfile(pool, id);
            return res.status(409).json({
                error: 'A pipeline run is already in progress for this profile.',
                pipeline_run: raceWinner,
            });
        }
        throw err;
    }

    // Same spawn path as POST /api/pipeline-runs (Task 7.6) - detached
    // child process, non-blocking, and its own error handler already marks
    // this row 'failed' (rather than leaving it stuck at 'pending') if the
    // process itself can't even start.
    spawnPersonalizedPipeline({ userProfileId: id, pipelineRunId: run.id });

    res.status(202).json({
        pipeline_run_id: run.id,
        user_profile_id: run.user_profile_id,
        search_configuration_id: run.search_configuration_id,
        status: run.status,
        started_at: run.started_at,
    });
}));
