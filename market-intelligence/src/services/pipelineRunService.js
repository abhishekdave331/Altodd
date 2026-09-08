// Task 7.6: pipeline_runs read/write logic, extracted out of
// scripts/pipelineRunTracker.js (Task 7.5's CLI-only tracker) so the new
// HTTP API and the CLI both call the exact same functions instead of two
// copies of the same SQL. No new tracking table or duplicated state - this
// is still the one pipeline_runs table from migration 009/010.

const TERMINAL_STATUSES = ['completed', 'completed_with_errors', 'failed'];

// Task 7.9: searchConfigurationId is optional (defaults to null, preserving
// Task 7.6's original behavior exactly for its existing POST /api/
// pipeline-runs route and the CLI tracker) - the new run-job-search endpoint
// already knows which search configuration it resolved/generated before
// creating this row, so it can record that link immediately instead of
// waiting for the sequencer to discover and report it back mid-run.
export async function createPipelineRun(pool, userProfileId, searchConfigurationId = null) {
    const result = await pool.query(
        `INSERT INTO pipeline_runs (user_profile_id, search_configuration_id, status, started_at) VALUES ($1, $2, 'pending', NOW()) RETURNING *`,
        [userProfileId, searchConfigurationId],
    );
    return result.rows[0];
}

export async function updatePipelineRun(pool, pipelineRunId, fields) {
    const setClauses = [];
    const values = [pipelineRunId];
    const addSet = (column, value) => {
        values.push(value);
        setClauses.push(`${column} = $${values.length}`);
    };

    if (fields.status !== undefined) addSet('status', fields.status);
    if (fields.searchConfigurationId !== undefined) addSet('search_configuration_id', fields.searchConfigurationId);
    if (fields.jobsScraped !== undefined) addSet('jobs_scraped', Number(fields.jobsScraped));
    if (fields.jobsAnalyzed !== undefined) addSet('jobs_analyzed', Number(fields.jobsAnalyzed));
    if (fields.jobsProcessedSuccessfully !== undefined) addSet('jobs_processed_successfully', Number(fields.jobsProcessedSuccessfully));
    if (fields.errorMessage !== undefined) addSet('error_message', fields.errorMessage);
    if (fields.completed === true) setClauses.push('completed_at = NOW()');

    if (setClauses.length === 0) throw new Error('No fields provided to update.');

    const result = await pool.query(
        `UPDATE pipeline_runs SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        values,
    );
    return result.rows[0];
}

export async function getPipelineRunById(pool, id) {
    const result = await pool.query('SELECT * FROM pipeline_runs WHERE id = $1', [id]);
    return result.rows[0] ?? null;
}

export async function listPipelineRunsForProfile(pool, userProfileId, limit = 20) {
    const result = await pool.query(
        'SELECT * FROM pipeline_runs WHERE user_profile_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userProfileId, limit],
    );
    return result.rows;
}

// Mirrors migration 010's partial unique index definition exactly - used for
// the API's fast-path pre-check (a friendly 409 before even attempting the
// insert). The index itself is the actual correctness guarantee against the
// race window between this check and the insert; see createPipelineRun's
// caller for the 23505 fallback that closes that window.
export async function getActivePipelineRunForProfile(pool, userProfileId) {
    const result = await pool.query(
        `SELECT * FROM pipeline_runs WHERE user_profile_id = $1 AND status != ALL($2::varchar[]) ORDER BY created_at DESC LIMIT 1`,
        [userProfileId, TERMINAL_STATUSES],
    );
    return result.rows[0] ?? null;
}

export async function userProfileExists(pool, userProfileId) {
    const result = await pool.query('SELECT 1 FROM user_profiles WHERE id = $1', [userProfileId]);
    return result.rowCount > 0;
}

export const PIPELINE_RUN_TERMINAL_STATUSES = TERMINAL_STATUSES;
