import { withTransaction } from '../config/database.js';
import { CANONICAL_TABLE_BY_DIMENSION, followRoleMerge } from './resolveTaxonomyValue.js';

// Thrown for any expected, caller-facing failure in this module: missing
// queue item, wrong status, unsupported dimension, invalid/mismatched
// canonical target, or a conflicting existing alias. Kept distinct from a
// raw database error so callers can tell "your request was invalid" apart
// from "something broke."
export class ReviewResolutionError extends Error {}

async function loadPendingQueueItem(client, queueItemId) {
    const result = await client.query(
        'SELECT * FROM taxonomy_review_queue WHERE id = $1 FOR UPDATE',
        [queueItemId],
    );
    if (result.rows.length === 0) {
        throw new ReviewResolutionError(`No taxonomy_review_queue row found with id "${queueItemId}".`);
    }
    const item = result.rows[0];
    if (item.status !== 'pending') {
        throw new ReviewResolutionError(
            `Queue item "${queueItemId}" is not pending (status="${item.status}") - it has already been resolved.`,
        );
    }
    return item;
}

function appendNote(existingNotes, addition) {
    if (!addition) return existingNotes ?? null;
    return existingNotes ? `${existingNotes} | ${addition}` : addition;
}

/**
 * Approves a pending taxonomy_review_queue item by linking its raw value to
 * an existing canonical entity as a new taxonomy_aliases row, then marks the
 * queue item resolved. Atomic - the alias insert and the queue-item update
 * either both happen or neither does.
 *
 * For merge-capable dimensions (role only, today), if the requested
 * canonicalId has been merged into another role (Task 5.14), the alias is
 * stored pointing at the final ACTIVE target instead - never intentionally
 * at a tombstoned row (Task 5.15). The caller does not need to know merge
 * topology; canonicalId/canonicalName in the return value always reflect the
 * final active target, which may differ from the id originally passed in.
 *
 * @param {object} params
 * @param {string} params.queueItemId - taxonomy_review_queue.id
 * @param {string} params.canonicalId - id of the row in the dimension's
 *   canonical table (skills.id for dimension='skill', etc.) this value
 *   should become an alias of - for role, this may be a merged (tombstoned)
 *   role id, which will be transparently redirected to its final active target
 * @param {string} [params.notes] - optional human-authored note, appended to
 *   (not replacing) whatever notes already exist on the queue item
 * @returns {Promise<{queueItemId: string, canonicalId: string, canonicalName: string, aliasCreated: boolean}>}
 *   canonicalId/canonicalName are always the FINAL active target, not
 *   necessarily the id originally requested. aliasCreated is false when an
 *   identical alias already existed pointing at the same effective target
 *   (idempotent no-op on taxonomy_aliases, but the queue item is still resolved)
 * @throws {ReviewResolutionError} for a missing/non-pending queue item, an
 *   unsupported dimension, a nonexistent canonical target, or an existing
 *   alias for this value pointing at a DIFFERENT effective canonical target
 *   (never silently overwritten)
 * @throws {Error} propagated unmodified from followRoleMerge() if a role's
 *   merge chain is corrupted or missing its target - never silently falls
 *   back to the originally-requested tombstoned role
 */
export async function approveAsAlias({ queueItemId, canonicalId, notes }) {
    return withTransaction(async (client) => {
        const item = await loadPendingQueueItem(client, queueItemId);

        const table = CANONICAL_TABLE_BY_DIMENSION[item.dimension];
        if (!table) {
            throw new ReviewResolutionError(
                `Dimension "${item.dimension}" has no canonical entity table - cannot approve as alias. ` +
                `Supported dimensions: ${Object.keys(CANONICAL_TABLE_BY_DIMENSION).join(', ')}.`,
            );
        }

        const canonicalRow = await client.query(`SELECT id, name FROM ${table} WHERE id = $1`, [canonicalId]);
        if (canonicalRow.rows.length === 0) {
            throw new ReviewResolutionError(
                `Canonical target "${canonicalId}" does not exist in "${table}" (dimension "${item.dimension}"). ` +
                `Refusing to create an alias pointing at a nonexistent or wrong-dimension entity.`,
            );
        }

        // Merge-capable dimensions (role only, today - see migration 005)
        // must never end up with a new alias pointing at a tombstoned
        // canonical row. Resolve to the final active target first, reusing
        // resolveTaxonomyValue.js's followRoleMerge() directly rather than
        // duplicating merge-walking logic here. followRoleMerge() throws on
        // a corrupted/missing chain - never silently falls back to the
        // originally-requested (tombstoned) row.
        const canonical = item.dimension === 'role'
            ? await followRoleMerge(client, canonicalRow.rows[0].id, canonicalRow.rows[0].name)
            : canonicalRow.rows[0];

        const existingAlias = await client.query(
            `SELECT id, canonical_id FROM taxonomy_aliases WHERE dimension = $1 AND normalized_alias_text = $2`,
            [item.dimension, item.normalized_raw_value],
        );

        let aliasCreated = false;
        if (existingAlias.rows.length > 0) {
            if (existingAlias.rows[0].canonical_id !== canonical.id) {
                throw new ReviewResolutionError(
                    `An alias already exists for "${item.normalized_raw_value}" (dimension "${item.dimension}") ` +
                    `pointing at a different canonical target (${existingAlias.rows[0].canonical_id}), not "${canonical.id}". ` +
                    `Refusing to silently overwrite - resolve the conflict explicitly before approving.`,
                );
            }
            // Same effective target already aliased (comparing against the
            // final active target, so a request against either a merged role
            // or its survivor is recognized as the same target) - the alias
            // table needs no change, but the queue item is still resolved.
        } else {
            await client.query(
                `INSERT INTO taxonomy_aliases (dimension, alias_text, normalized_alias_text, canonical_id, source)
                 VALUES ($1, $2, $3, $4, 'human_approved')`,
                [item.dimension, item.raw_value, item.normalized_raw_value, canonical.id],
            );
            aliasCreated = true;
        }

        const redirectNote = canonical.id !== canonicalId
            ? ` (requested target "${canonicalId}" has been merged into "${canonical.name}" - alias stored pointing at the final active target instead.)`
            : '';
        const auditNote = (aliasCreated
            ? `Approved as alias of "${canonical.name}" (${table}.id=${canonical.id}).`
            : `Approved - alias for "${item.normalized_raw_value}" already existed pointing at "${canonical.name}" (${table}.id=${canonical.id}).`
        ) + redirectNote;

        await client.query(
            `UPDATE taxonomy_review_queue SET status = 'approved', resolved_at = NOW(), notes = $2 WHERE id = $1`,
            [queueItemId, appendNote(item.notes, [auditNote, notes].filter(Boolean).join(' '))],
        );

        return { queueItemId, canonicalId: canonical.id, canonicalName: canonical.name, aliasCreated };
    });
}

/**
 * Resolves a pending taxonomy_review_queue item without creating any alias -
 * the reject/dismiss path (or an "approved, but handled outside this
 * service" path, since the status CHECK constraint permits either terminal
 * value). Never touches taxonomy_aliases.
 *
 * @param {object} params
 * @param {string} params.queueItemId
 * @param {'approved'|'rejected'} [params.status='rejected']
 * @param {string} [params.notes] - appended to, not replacing, existing notes
 * @returns {Promise<{queueItemId: string, status: string}>}
 * @throws {ReviewResolutionError} for a missing/non-pending queue item or an
 *   invalid status value
 */
export async function resolveWithoutAlias({ queueItemId, status = 'rejected', notes }) {
    if (status !== 'approved' && status !== 'rejected') {
        throw new ReviewResolutionError(`resolveWithoutAlias() status must be "approved" or "rejected", got "${status}".`);
    }

    return withTransaction(async (client) => {
        const item = await loadPendingQueueItem(client, queueItemId);

        await client.query(
            `UPDATE taxonomy_review_queue SET status = $2, resolved_at = NOW(), notes = $3 WHERE id = $1`,
            [queueItemId, status, appendNote(item.notes, notes)],
        );

        return { queueItemId, status };
    });
}
