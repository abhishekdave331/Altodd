// Only these two resolver outcomes are ever review-worthy in the current
// architecture (see resolveTaxonomyValue.js): everything else is either
// dropped (null-like) or already successfully resolved. Mapped to the
// existing queue_reason/confidence CHECK constraints from migration 001 -
// no new enum values, no schema changes.
const REASON_BY_METHOD = {
    unresolved: 'new_unreviewed',
    rule_match_entity_missing: 'suggested_alias',
};

const CONFIDENCE_BY_METHOD = {
    unresolved: 'low',
    rule_match_entity_missing: 'medium',
};

/**
 * Records a resolver result that requires human review as a pending
 * taxonomy_review_queue row. No-op (returns null) for any result where
 * requiresReview is false - re-checked here defensively even though callers
 * are expected to already guard on this, since inserting a resolved value
 * would misrepresent it as a problem.
 *
 * suggested_canonical_id is always NULL: neither supported reason carries a
 * real canonical_id to point at (rule_match_entity_missing has a suggested
 * *name*, not an id, since no row exists yet for it) - never fabricated.
 *
 * Duplicate-safe via ON CONFLICT targeting the exact partial unique index
 * created in migration 003 - (dimension, normalized_raw_value) WHERE
 * status='pending' - so repeated casing/whitespace variants of an already-
 * queued value are silently absorbed with no SELECT-before-INSERT race.
 *
 * @param {object} params
 * @param {object} params.resolution - a resolveTaxonomyValue() result
 * @param {{query: Function}} params.db - pool or client
 * @param {string|null} [params.jobId] - real jobs.id UUID for context, or
 *   null when no job context is available. Never fabricated.
 * @returns {Promise<string|null>} the new row's id, or null if a pending row
 *   for this (dimension, normalized_raw_value) already existed.
 */
export async function recordForReview({ resolution, db, jobId = null }) {
    if (!resolution.requiresReview) return null;

    const queueReason = REASON_BY_METHOD[resolution.normalizationMethod];
    const confidence = CONFIDENCE_BY_METHOD[resolution.normalizationMethod];
    if (!queueReason) {
        throw new Error(
            `recordForReview() does not know how to queue a "${resolution.normalizationMethod}" result. ` +
            `Only "unresolved" and "rule_match_entity_missing" are currently supported.`,
        );
    }

    const notes = resolution.normalizationMethod === 'rule_match_entity_missing'
        ? `Deterministic rule suggests canonical name "${resolution.canonicalName}", which has no matching row yet in the canonical table.`
        : null;

    const result = await db.query(
        `INSERT INTO taxonomy_review_queue
            (dimension, raw_value, normalized_raw_value, suggested_canonical_id, first_seen_job_id, queue_reason, confidence, status, notes)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, 'pending', $7)
         ON CONFLICT (dimension, normalized_raw_value) WHERE status = 'pending' DO NOTHING
         RETURNING id`,
        [
            resolution.dimension,
            String(resolution.rawValue),
            resolution.normalizedValue,
            jobId,
            queueReason,
            confidence,
            notes,
        ],
    );

    return result.rows[0]?.id ?? null;
}
