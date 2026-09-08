-- Task 7.2: persists generated job-search parameters derived from a
-- user_profiles.enriched_profile row (Task 7.1). Lives in the same
-- altodd_market database / migration mechanism as migration 006, for the
-- same reason: one database, one working migration runner.

CREATE TABLE IF NOT EXISTS search_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ON DELETE CASCADE: a search configuration has no independent meaning
    -- without the profile it was derived from.
    user_profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

    -- LLM-assisted (semantic interpretation of skills/roles into effective
    -- search phrasing) - see searchQueryPrompt.js. Always arrays (never
    -- null) - an empty array is the honest "no signal" result, not an
    -- absent field.
    primary_queries JSONB NOT NULL,
    secondary_queries JSONB NOT NULL,

    -- Filtering/relevance keywords - not meant to be run as standalone
    -- search queries themselves.
    keywords JSONB NOT NULL,

    -- Deterministic pass-through filters from the enriched profile - no LLM
    -- involvement, since these are already structured fields needing no
    -- semantic interpretation. employment_type stays permanently NULL today:
    -- Task 7.1's enriched_profile schema has no employment-preference field
    -- at all, and this task must not fabricate one.
    seniority VARCHAR(50),
    location TEXT,
    industries JSONB,
    employment_type VARCHAR(50),

    -- 'partial' means at least one LLM-generated field failed shape
    -- validation and was coerced/dropped rather than saved as-is or causing
    -- a failure - same convention as user_profiles.enrichment_status.
    generation_status VARCHAR(20) NOT NULL DEFAULT 'complete'
        CHECK (generation_status IN ('complete', 'partial', 'failed')),

    created_at TIMESTAMP DEFAULT NOW()
);

-- No UNIQUE(user_profile_id): regenerating (e.g. after a prompt change)
-- creates a new row rather than overwriting history, matching the
-- resumes/user_profiles precedent from migration 006.
CREATE INDEX IF NOT EXISTS idx_search_configurations_user_profile_id ON search_configurations(user_profile_id);
