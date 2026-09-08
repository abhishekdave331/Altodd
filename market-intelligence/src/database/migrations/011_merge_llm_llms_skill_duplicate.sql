-- Task 6.6: found via a live dashboard-API audit - GET /api/dashboard/skills
-- was showing "LLM" (6 jobs) and "LLMs" (9 jobs) as two separate top-skills
-- entries. Root cause: normalizeSkillName()'s toNormalizedKey() only
-- lowercases/trims/collapses whitespace - it does not strip a trailing "s",
-- so "LLM" and "LLMs" hashed to different normalized_name values and got
-- separate `skills` rows at ingestion time. This migration adds the missing
-- alias to SKILL_ALIASES) so future ingests correctly resolve to one row,
-- but that alone does nothing for jobs already ingested before the fix
-- existed - this migration performs the one-time retroactive merge for
-- those.
--
-- Idempotent and safe to run on a fresh database or a database where this
-- was already merged: the DO block only acts if both a canonical 'llm' row
-- and a duplicate 'llms' row currently exist. ON CONFLICT DO NOTHING on the
-- re-pointing UPDATE guards against the (not currently observed, but
-- theoretically possible on other datasets) case where the same job was
-- independently tagged with both "LLM" and "LLMs" - in that case the
-- job_skills row already pointing at the canonical id wins and the
-- duplicate-id row for that same job is simply dropped, never duplicated.
DO $$
DECLARE
    canonical_id UUID;
    duplicate_id UUID;
BEGIN
    SELECT id INTO canonical_id FROM skills WHERE normalized_name = 'llm';
    SELECT id INTO duplicate_id FROM skills WHERE normalized_name = 'llms';

    IF canonical_id IS NOT NULL AND duplicate_id IS NOT NULL THEN
        -- Re-point every job_skills row from the duplicate to the canonical
        -- skill. A plain UPDATE would violate the (job_id, skill_id) primary
        -- key for any job already tagged with both - delete first, keeping
        -- the canonical-id row if one already exists for that job.
        DELETE FROM job_skills
        WHERE skill_id = duplicate_id
          AND job_id IN (SELECT job_id FROM job_skills WHERE skill_id = canonical_id);

        UPDATE job_skills SET skill_id = canonical_id WHERE skill_id = duplicate_id;

        -- daily_skill_metrics.skill_id REFERENCES skills(id) with no ON
        -- DELETE CASCADE - these rows must be cleared before the skills row
        -- itself can be deleted, or the DELETE below fails on the FK
        -- constraint. This also removes the stale split-out metrics
        -- immediately rather than waiting for the next scheduled
        -- aggregation run to overwrite them.
        DELETE FROM daily_skill_metrics WHERE skill_id = duplicate_id;

        DELETE FROM skills WHERE id = duplicate_id;
    END IF;
END $$;
