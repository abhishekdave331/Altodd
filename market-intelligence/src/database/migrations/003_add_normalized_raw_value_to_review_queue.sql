-- Corrective, additive migration for taxonomy_review_queue (does not touch
-- 001_taxonomy_normalization_foundation.sql or 002_seed_existing_taxonomy_aliases.sql).
--
-- Problem: the table's pending-item duplicate-prevention index was built on
-- raw_value (UNIQUE(dimension, raw_value) WHERE status='pending'), but raw_value
-- is unnormalized extracted text. "Python", "python", " Python", and "PYTHON"
-- are the same taxonomy concept but four distinct raw strings, so the current
-- index would allow all four to sit as separate pending rows for the same
-- dimension - defeating the intended "one pending item per normalized value"
-- behavior. The fix requires a normalized_raw_value column to key uniqueness
-- on instead.
--
-- Backfill strategy: the table has 0 rows as of this migration's authoring
-- (verified live), but the column is added nullable + backfilled + then set
-- NOT NULL rather than added as NOT NULL directly, so this migration remains
-- correct even if that assumption changes before it actually executes. The
-- backfill expression mirrors the exact normalization already used elsewhere
-- in this codebase: toNormalizedKey() in resolveTaxonomyValue.js
-- (.toLowerCase().trim().replace(/\s+/g, ' ')) and the equivalent SQL form
-- already established in 002_seed_existing_taxonomy_aliases.sql
-- (LOWER(TRIM(REGEXP_REPLACE(text, '\s+', ' ', 'g')))) - not a new formula.
--
-- raw_value itself is never modified - the original extracted text remains
-- fully preserved; normalized_raw_value is purely an additional derived column.

ALTER TABLE taxonomy_review_queue
    ADD COLUMN IF NOT EXISTS normalized_raw_value TEXT;

UPDATE taxonomy_review_queue
SET normalized_raw_value = LOWER(TRIM(REGEXP_REPLACE(raw_value, '\s+', ' ', 'g')))
WHERE normalized_raw_value IS NULL;

ALTER TABLE taxonomy_review_queue
    ALTER COLUMN normalized_raw_value SET NOT NULL;

-- Replace the raw-value-keyed pending-uniqueness index with a
-- normalized-value-keyed one. Same name reused since this is a correction of
-- the same logical constraint, not a new concept - not a new index alongside
-- a stale one.
DROP INDEX IF EXISTS idx_taxonomy_review_queue_pending_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_review_queue_pending_unique
    ON taxonomy_review_queue(dimension, normalized_raw_value)
    WHERE status = 'pending';

-- No separate status-only index added: no application code queries this
-- table yet (verified - only this migration file references it repo-wide),
-- and the partial unique index above already fully serves a bare
-- `WHERE status = 'pending'` scan since its predicate matches such a query
-- exactly. Adding an index for a query pattern with no real caller yet would
-- be speculative - deferred until real review-queue-reading code exists and
-- its actual access pattern is known.
