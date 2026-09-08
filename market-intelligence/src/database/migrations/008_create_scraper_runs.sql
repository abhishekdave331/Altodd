-- Task 7.3: minimum persistence needed to track scraper orchestration
-- executions (Apify actor runs triggered dynamically from a
-- search_configurations row) - audit trail only, not a duplicate of jobs/
-- job_analysis. Same database/migration mechanism as migrations 006/007.

CREATE TABLE IF NOT EXISTS scraper_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ON DELETE CASCADE: a scraper_runs row has no independent meaning
    -- without the search configuration that produced its input.
    search_configuration_id UUID NOT NULL REFERENCES search_configurations(id) ON DELETE CASCADE,

    -- Which query list drove this specific run - lets the multiple-query
    -- strategy (primary always run, secondary conditional/deduped) be
    -- audited after the fact.
    query_type VARCHAR(20) NOT NULL CHECK (query_type IN ('primary', 'secondary')),

    apify_actor_id VARCHAR(100) NOT NULL,
    apify_run_id VARCHAR(100),
    apify_dataset_id VARCHAR(100),

    -- The exact dynamically-built payload sent to Apify - preserved for
    -- audit/debugging, same "never discard the real input" principle used
    -- for job_analysis.analysis and resumes.raw_text.
    actor_input JSONB NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'timed_out')),

    result_count INTEGER,

    error_message TEXT,

    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_runs_search_configuration_id ON scraper_runs(search_configuration_id);
