-- Task 7.6: the personalized pipeline is now triggerable over HTTP (POST
-- /api/pipeline-runs), which means two real concurrent requests for the same
-- profile are possible for the first time - Task 7.5's CLI sequencer only
-- ever had one human running one command at a time, so nothing enforced
-- "one active run per profile" at the database level.
--
-- A partial unique index (rather than an application-level check) is the
-- correct minimum protection here: it closes the check-then-insert race
-- window that a plain "SELECT ... then INSERT" in the API route cannot close
-- by itself, without introducing any new locking infrastructure - Postgres
-- already guarantees uniqueness atomically. "Active" is defined as any
-- non-terminal status; the terminal set here must exactly match the
-- CHECK constraint's terminal statuses from migration 009.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_one_active_per_profile
    ON pipeline_runs (user_profile_id)
    WHERE status NOT IN ('completed', 'completed_with_errors', 'failed');
