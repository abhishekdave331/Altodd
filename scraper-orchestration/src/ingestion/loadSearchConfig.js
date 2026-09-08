import { pool } from '../config/database.js';

/**
 * Loads the most recently generated, non-failed search_configurations row
 * for a user profile. "Latest valid" - never a hardcoded ID, never assumes
 * only one configuration exists per profile (Task 7.2 preserves history by
 * design, so there may be several over time).
 *
 * @param {string} userProfileId
 * @returns {Promise<object|null>} the row, or null if none exist
 */
export async function loadLatestSearchConfiguration(userProfileId) {
    const result = await pool.query(
        `SELECT id, user_profile_id, primary_queries, secondary_queries, keywords,
                seniority, location, industries, employment_type, generation_status
         FROM search_configurations
         WHERE user_profile_id = $1 AND generation_status != 'failed'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userProfileId],
    );
    return result.rows[0] ?? null;
}
