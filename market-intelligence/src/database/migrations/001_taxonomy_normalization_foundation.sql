CREATE TABLE IF NOT EXISTS taxonomy_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    dimension VARCHAR(20) NOT NULL CHECK (dimension IN ('skill', 'capability', 'role', 'seniority', 'industry')),

    alias_text TEXT NOT NULL,

    normalized_alias_text TEXT NOT NULL,

    canonical_id UUID NOT NULL,

    source VARCHAR(20) NOT NULL CHECK (source IN ('seed', 'rule_authored', 'human_approved')),

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(dimension, normalized_alias_text)
);

-- Supports the reverse lookup "which aliases point to this canonical entity?".
-- The UNIQUE(dimension, normalized_alias_text) constraint above already backs
-- the resolver's forward lookup ("is this raw value a known alias?"), so no
-- separate index is added for that.
CREATE INDEX IF NOT EXISTS idx_taxonomy_aliases_canonical_id ON taxonomy_aliases(canonical_id);

CREATE TABLE IF NOT EXISTS taxonomy_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    dimension VARCHAR(20) NOT NULL CHECK (dimension IN ('skill', 'capability', 'role', 'seniority', 'industry')),

    raw_value TEXT NOT NULL,

    suggested_canonical_id UUID,

    -- Optional context for a reviewer: which job first surfaced this value.
    -- SET NULL (not CASCADE, unlike every other jobs(id) reference in this
    -- schema) because a review-queue row is a standalone normalization
    -- question, not a per-job record - deleting the originating job should
    -- not delete the still-open question about the raw value itself.
    first_seen_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

    queue_reason VARCHAR(20) NOT NULL CHECK (queue_reason IN ('suggested_alias', 'suspicious_value', 'new_unreviewed')),

    confidence VARCHAR(10) NOT NULL CHECK (confidence IN ('medium', 'low')),

    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),

    notes TEXT,

    created_at TIMESTAMP DEFAULT NOW(),

    resolved_at TIMESTAMP
);

-- Prevents the same raw value from flooding the queue with duplicate pending
-- entries within one dimension. Resolved (approved/rejected) rows are exempt
-- so the same raw value can be queued again later if it recurs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_review_queue_pending_unique
    ON taxonomy_review_queue(dimension, raw_value)
    WHERE status = 'pending';
