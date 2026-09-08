// Task 7.8: read-only queries backing the search-configuration API routes.
export async function getUserProfileForGeneration(pool, userProfileId) {
    const result = await pool.query(
        'SELECT id, enrichment_status FROM user_profiles WHERE id = $1',
        [userProfileId],
    );
    return result.rows[0] ?? null;
}

// Scoped strictly to one profile via the WHERE clause - never leaks another
// profile's configurations regardless of caller input.
export async function listSearchConfigurationsForProfile(pool, userProfileId, limit = 20) {
    const result = await pool.query(
        `SELECT * FROM search_configurations WHERE user_profile_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userProfileId, limit],
    );
    return result.rows;
}

// Task 7.9: mirrors scraper-orchestration/src/ingestion/loadSearchConfig.js's
// loadLatestSearchConfiguration exactly (same WHERE/ORDER BY/LIMIT) - that
// function is this project's established source of truth for "latest valid
// configuration" (Task 7.3), but it lives in a sibling module with no
// cross-imports allowed, so this is a same-semantics read query rather than
// a shared import, matching how config/database.js already has independent
// sibling copies across modules. Any future change to what counts as
// "valid" must be made in both places.
export async function getLatestValidSearchConfiguration(pool, userProfileId) {
    const result = await pool.query(
        `SELECT * FROM search_configurations
         WHERE user_profile_id = $1 AND generation_status != 'failed'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userProfileId],
    );
    return result.rows[0] ?? null;
}
