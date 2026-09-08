import { pool } from '../config/database.js';

export async function persistSearchConfiguration({ userProfileId, queries, filters, status }) {
    const result = await pool.query(
        `INSERT INTO search_configurations
            (user_profile_id, primary_queries, secondary_queries, keywords, seniority, location, industries, employment_type, generation_status)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb, $8, $9)
         RETURNING *`,
        [
            userProfileId,
            JSON.stringify(queries.primary_queries),
            JSON.stringify(queries.secondary_queries),
            JSON.stringify(queries.keywords),
            filters.seniority,
            filters.location,
            filters.industries != null ? JSON.stringify(filters.industries) : null,
            filters.employment_type,
            status,
        ],
    );
    return result.rows[0];
}
