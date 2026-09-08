// Task 7.7: read-only queries backing GET /api/profiles/:id. storage_path
// (a local filesystem path) is intentionally never selected/returned - it
// has no meaning to an API client and would leak server-side layout.
export async function getUserProfileWithResume(pool, userProfileId) {
    const result = await pool.query(
        `SELECT
            up.id AS user_profile_id,
            up.resume_id,
            up.seniority_level,
            up.years_of_experience,
            up.location,
            up.enriched_profile,
            up.enrichment_status,
            up.created_at,
            r.original_filename,
            r.file_format,
            r.uploaded_at
         FROM user_profiles up
         JOIN resumes r ON r.id = up.resume_id
         WHERE up.id = $1`,
        [userProfileId],
    );
    return result.rows[0] ?? null;
}
