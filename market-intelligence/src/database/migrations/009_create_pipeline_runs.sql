-- Task 7.5: one row per complete personalized pipeline execution (resume
-- profile -> search config -> scraper orchestration -> analysis ->
-- ingestion/aggregation), tying together the already-separate scraper_runs/
-- user_profiles/search_configurations records into a single logical run.

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

    -- Nullable: at creation time (before scraper-orchestration has even run)
    -- only user_profile_id is known - scraper-orchestration is what resolves
    -- "the latest search_configuration" (see loadLatestSearchConfiguration),
    -- so this is filled in once that resolution happens. SET NULL (not
    -- CASCADE) so a pipeline run's own history/counts survive even if the
    -- specific configuration row it used is later removed.
    search_configuration_id UUID REFERENCES search_configurations(id) ON DELETE SET NULL,

    -- Lifecycle: pending -> scraping -> analyzing -> ingesting -> completed,
    -- plus failed and completed_with_errors. "aggregating" is intentionally
    -- NOT a distinct value here despite the task's suggested example
    -- lifecycle - investigation confirmed market-intelligence's `daily`
    -- script runs ingest+aggregate as one atomic child-process call
    -- (dailyPipeline.js), so the orchestrator can never actually observe a
    -- boundary between them. Adding a status the code can never truthfully
    -- set would be exactly the kind of misleading state this task warns
    -- against - "ingesting" covers both stages honestly.
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'scraping', 'analyzing', 'ingesting', 'completed', 'completed_with_errors', 'failed')),

    -- The three result counts the task asked for by name, sourced from data
    -- already produced by existing steps - no new calculation logic:
    -- jobs_scraped     = sum of scraper_runs.result_count across this run's succeeded scraper runs
    -- jobs_analyzed    = unique jobs attempted after cross-dataset dedup (llm-pipeline's processJobs() `total`)
    -- jobs_processed_successfully = llm-pipeline's processJobs() `succeeded`
    jobs_scraped INTEGER,
    jobs_analyzed INTEGER,
    jobs_processed_successfully INTEGER,

    error_message TEXT,

    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_profile_id ON pipeline_runs(user_profile_id);

-- Links scraper_runs (Task 7.3/7.4) back to the pipeline_runs cycle that
-- triggered them - additive only, no existing scraper_runs columns changed
-- or removed.
ALTER TABLE scraper_runs
    ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scraper_runs_pipeline_run_id ON scraper_runs(pipeline_run_id);
