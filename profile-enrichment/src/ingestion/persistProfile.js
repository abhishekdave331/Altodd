import { pool } from '../config/database.js';

export async function persistResume({ originalFilename, fileFormat, storagePath, rawText }) {
    const result = await pool.query(
        `INSERT INTO resumes (original_filename, file_format, storage_path, raw_text)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [originalFilename, fileFormat, storagePath, rawText],
    );
    return result.rows[0].id;
}

export async function persistUserProfile({ resumeId, profile, status }) {
    const result = await pool.query(
        `INSERT INTO user_profiles (resume_id, seniority_level, years_of_experience, location, enriched_profile, enrichment_status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id, created_at`,
        [
            resumeId,
            profile.seniority_level,
            profile.years_of_experience,
            profile.location,
            JSON.stringify(profile),
            status,
        ],
    );
    return result.rows[0];
}
