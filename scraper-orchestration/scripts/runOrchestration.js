import { pool } from '../src/config/database.js';
import { loadLatestSearchConfiguration } from '../src/ingestion/loadSearchConfig.js';
import { planRuns } from '../src/orchestration/planRuns.js';
import { buildActorInput } from '../src/mapping/buildActorInput.js';
import { startActorRun, pollRunUntilFinished, getDatasetInfo } from '../src/apify/apifyClient.js';
import { createScraperRunRecord, markRunStarted, markRunFinished, markRunFailedToStart } from '../src/ingestion/persistScraperRun.js';

// Task 7.4: human progress goes to stderr, and exactly ONE line of machine-
// readable JSON goes to stdout at the very end - this lets
// scripts/run-personalized-pipeline.js (the new cross-module sequencer)
// capture this run's exact successful dataset IDs directly from this
// invocation's stdout, with no separate query script and no risk of picking
// up unrelated datasets from a different, earlier orchestration cycle for
// the same profile. Nothing about the actual orchestration behavior changed
// - only which stream each message goes to.
function log(message) {
    console.error(message);
}

function emitResult(result) {
    console.log(JSON.stringify(result));
}

// pipelineRunId (Task 7.5) is optional - present only when this script is
// invoked from scripts/run-personalized-pipeline.js, so every scraper_runs
// row it creates can be linked back to that pipeline_runs row. Standalone
// invocation (`npm run orchestrate -- <profileId>`) still works exactly as
// in Task 7.3/7.4, just with pipeline_run_id left null.
const [, , userProfileId, pipelineRunId] = process.argv;
if (!userProfileId) {
    log('Usage: npm run orchestrate -- <user_profiles.id> [pipelineRunId]');
    process.exitCode = 1;
    process.exit();
}

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID ?? 'WoIkcryaPU8xUSqP0';
const DEFAULT_MAX_ITEMS = Number(process.env.DEFAULT_MAX_ITEMS ?? 25);

if (!APIFY_TOKEN) {
    log('Missing APIFY_TOKEN. Set it in the project root .env file (same token used by llm-pipeline).');
    process.exitCode = 1;
    process.exit();
}

try {
    log(`[orchestration] Loading latest search configuration for profile ${userProfileId}...`);
    const config = await loadLatestSearchConfiguration(userProfileId);
    if (!config) {
        log('[orchestration] No search configuration found for this profile - nothing to orchestrate.');
        emitResult({ searchConfigurationId: null, successfulDatasetIds: [], runs: [], reason: 'no_search_configuration' });
        process.exit();
    }
    log(`[orchestration] Using search_configurations.id = ${config.id}`);

    const runs = planRuns({ primary_queries: config.primary_queries, secondary_queries: config.secondary_queries });
    if (runs.length === 0) {
        log('[orchestration] No usable queries in this configuration (both primary and secondary are empty) - nothing to run.');
        emitResult({ searchConfigurationId: config.id, successfulDatasetIds: [], runs: [], reason: 'no_usable_queries' });
        process.exit();
    }
    log(`[orchestration] Planned ${runs.length} run(s): ${runs.map((r) => r.queryType).join(', ')}`);

    const filters = { seniority: config.seniority, location: config.location };
    const results = [];

    for (const run of runs) {
        log(`\n[orchestration] --- ${run.queryType} run: ${run.queries.join(' | ')} ---`);

        const actorInput = buildActorInput({
            queries: run.queries,
            filters,
            titleKeywords: config.keywords ?? [],
            maxItems: DEFAULT_MAX_ITEMS,
        });
        log(`[orchestration] Actor input: ${JSON.stringify(actorInput)}`);

        const recordId = await createScraperRunRecord({
            searchConfigurationId: config.id,
            queryType: run.queryType,
            apifyActorId: APIFY_ACTOR_ID,
            actorInput,
            pipelineRunId: pipelineRunId ?? null,
        });

        try {
            const started = await startActorRun({ token: APIFY_TOKEN, actorId: APIFY_ACTOR_ID, input: actorInput });
            log(`[orchestration] Started Apify run ${started.id} (status=${started.status})`);
            await markRunStarted({ id: recordId, apifyRunId: started.id });

            const finished = await pollRunUntilFinished({ token: APIFY_TOKEN, runId: started.id });
            log(`[orchestration] Run ${started.id} finished with status ${finished.status}`);

            let resultCount = null;
            if (finished.status === 'SUCCEEDED' && finished.defaultDatasetId) {
                const dataset = await getDatasetInfo({ token: APIFY_TOKEN, datasetId: finished.defaultDatasetId });
                resultCount = dataset.itemCount ?? null;
                log(`[orchestration] Dataset ${finished.defaultDatasetId}: ${resultCount} item(s)`);
            }

            const finalStatus = { SUCCEEDED: 'succeeded', FAILED: 'failed', ABORTED: 'failed', 'TIMED-OUT': 'timed_out' }[finished.status] ?? 'failed';
            await markRunFinished({
                id: recordId,
                status: finalStatus,
                apifyDatasetId: finished.defaultDatasetId,
                resultCount,
                errorMessage: finalStatus === 'succeeded' ? null : `Apify run ended with status ${finished.status}`,
            });

            results.push({ queryType: run.queryType, recordId, apifyRunId: started.id, datasetId: finished.defaultDatasetId ?? null, status: finalStatus, resultCount });
        } catch (err) {
            log(`[orchestration] ${run.queryType} run failed: ${err.message}`);
            await markRunFailedToStart({ id: recordId, errorMessage: err.message });
            results.push({ queryType: run.queryType, recordId, datasetId: null, status: 'failed', error: err.message });
        }
    }

    log('\n[orchestration] Summary logged above. Emitting machine-readable result on stdout.');
    const successfulDatasetIds = results.filter((r) => r.status === 'succeeded' && r.datasetId).map((r) => r.datasetId);
    emitResult({ searchConfigurationId: config.id, successfulDatasetIds, runs: results });
} finally {
    await pool.end();
}
