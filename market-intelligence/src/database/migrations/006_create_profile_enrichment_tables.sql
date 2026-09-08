-- Foundation for Module 7 (personalized job search). Adds resumes/user_profiles
-- tables to the same altodd_market database used by market-intelligence -
-- this project has exactly one database and one working migration mechanism,
-- so a second module (profile-enrichment) reuses it rather than standing up
-- a parallel migration runner for the same physical database.
--
-- profile-enrichment/ (a separate, independently deployable module - see its
-- own README) owns the application logic that writes to these tables; this
-- migration only owns the schema itself, consistent with how schema.sql/
-- migrations/ have always been the single source of truth for this database
-- regardless of which module's code performs the writes.

CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    original_filename TEXT NOT NULL,

    file_format VARCHAR(20) NOT NULL,

    -- Local filesystem path where the uploaded file is stored (this project
    -- has no blob storage infra) - the actual bytes live on disk, never in
    -- this column, matching how llm-pipeline output already lives on disk
    -- rather than in Postgres.
    storage_path TEXT NOT NULL,

    -- Full extracted resume text, preserved for audit/reprocessing/future
    -- re-enrichment with an improved prompt - same "never discard the raw
    -- input" principle already used for job_analysis.analysis.
    raw_text TEXT,

    uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ON DELETE CASCADE: a user_profiles row has no independent meaning
    -- without the resume it was extracted from.
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,

    -- Denormalized copies of a few scalar fields for simple querying without
    -- unpacking JSONB - everything else (target_roles, skills, tools,
    -- industries, education, keywords) stays inside enriched_profile for now.
    -- Not split into separate relational/junction tables yet: no consumer
    -- exists that needs to query them individually (Module 5's taxonomy
    -- tables were only built once ingestion actually needed them - same
    -- principle applies here).
    seniority_level VARCHAR(50),

    years_of_experience NUMERIC,

    location TEXT,

    -- The full validated structured profile (see profile-enrichment's
    -- validateProfile.js) - the single source of truth for this profile.
    enriched_profile JSONB NOT NULL,

    -- 'partial' means at least one field from the LLM's raw output failed
    -- shape validation and was coerced to null rather than saved as-is or
    -- causing a failure - never silently indistinguishable from a clean
    -- 'complete' result.
    enrichment_status VARCHAR(20) NOT NULL DEFAULT 'complete'
        CHECK (enrichment_status IN ('complete', 'partial', 'failed')),

    created_at TIMESTAMP DEFAULT NOW()
);

-- No UNIQUE(resume_id): re-running enrichment (e.g. after a prompt
-- improvement) creates a new row rather than overwriting history, matching
-- this project's general "never destructively overwrite" convention.
CREATE INDEX IF NOT EXISTS idx_user_profiles_resume_id ON user_profiles(resume_id);
