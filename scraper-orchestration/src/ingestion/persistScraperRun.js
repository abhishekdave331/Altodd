import { pool } from '../config/database.js';

// pipelineRunId is optional (Task 7.5) - null when scraper-orchestration is
// invoked standalone (e.g. directly via `npm run orchestrate`, outside the
// personalized-pipeline sequencer), so this table remains usable on its own
// exactly as it was in Task 7.3/7.4.
export async function createScraperRunRecord({ searchConfigurationId, queryType, apifyActorId, actorInput, pipelineRunId = null }) {
    const result = await pool.query(
        `INSERT INTO scraper_runs (search_configuration_id, query_type, apify_actor_id, actor_input, status, pipeline_run_id)
         VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
         RETURNING id`,
        [searchConfigurationId, queryType, apifyActorId, JSON.stringify(actorInput), pipelineRunId],
    );
    return result.rows[0].id;
}

export async function markRunStarted({ id, apifyRunId }) {
    await pool.query(
        `UPDATE scraper_runs SET status = 'running', apify_run_id = $2, started_at = NOW() WHERE id = $1`,
        [id, apifyRunId],
    );
}

export async function markRunFinished({ id, status, apifyDatasetId, resultCount, errorMessage }) {
    await pool.query(
        `UPDATE scraper_runs
         SET status = $2, apify_dataset_id = $3, result_count = $4, error_message = $5, completed_at = NOW()
         WHERE id = $1`,
        [id, status, apifyDatasetId ?? null, resultCount ?? null, errorMessage ?? null],
    );
}

export async function markRunFailedToStart({ id, errorMessage }) {
    await pool.query(
        `UPDATE scraper_runs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`,
        [id, errorMessage],
    );
}
