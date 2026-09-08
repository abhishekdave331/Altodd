import { withTransaction } from '../config/database.js';

// Thrown for any expected, caller-facing failure: missing role, self-merge,
// merging an already-merged source, merging into a non-active target, or
// merging a role that other roles already depend on. Kept distinct from a
// raw database error, matching the ReviewResolutionError/AliasIntegrityError
// convention already established elsewhere in this module.
export class RoleConsolidationError extends Error {}

async function loadRole(client, roleId) {
    const result = await client.query(
        'SELECT id, name, merged_into_id FROM roles WHERE id = $1 FOR UPDATE',
        [roleId],
    );
    if (result.rows.length === 0) {
        throw new RoleConsolidationError(`No roles row found with id "${roleId}".`);
    }
    return result.rows[0];
}

/**
 * Merges one canonical role into another, non-destructively. The source row
 * is never deleted - only its merged_into_id is set. Resolution (see
 * resolveTaxonomyValue.js) follows this pointer so future lookups of the
 * source role's name return the target as the final canonical result.
 *
 * Invariant enforced here (not by a schema constraint, since it depends on
 * another row's state): a merge target must always be an ACTIVE role
 * (merged_into_id IS NULL), and a source must not already have other roles
 * depending on it. Together these guarantee every merge pointer is exactly
 * one hop - which makes circular and multi-hop chains structurally
 * impossible, not just disallowed by convention.
 *
 * @param {object} params
 * @param {string} params.sourceRoleId - the role being retired (preserved, never deleted)
 * @param {string} params.targetRoleId - the surviving canonical role
 * @param {string} [params.notes] - logged (not persisted - roles has no
 *   notes column and adding one for this alone would be a speculative schema
 *   addition beyond this task's scope)
 * @returns {Promise<{sourceRoleId: string, sourceName: string, targetRoleId: string, targetName: string}>}
 * @throws {RoleConsolidationError} for a missing role, sourceRoleId === targetRoleId,
 *   an already-merged source, a non-active target, or a source that other
 *   roles are already merged into
 */
export async function mergeRole({ sourceRoleId, targetRoleId, notes }) {
    if (sourceRoleId === targetRoleId) {
        throw new RoleConsolidationError('sourceRoleId and targetRoleId must be different roles - a role cannot merge into itself.');
    }

    return withTransaction(async (client) => {
        const source = await loadRole(client, sourceRoleId);
        const target = await loadRole(client, targetRoleId);

        if (source.merged_into_id) {
            throw new RoleConsolidationError(
                `Role "${source.name}" (id=${sourceRoleId}) is already merged into role id "${source.merged_into_id}" - ` +
                `cannot merge an already-merged role. Merge from its current active target instead.`,
            );
        }
        if (target.merged_into_id) {
            throw new RoleConsolidationError(
                `Merge target "${target.name}" (id=${targetRoleId}) is itself merged into role id "${target.merged_into_id}" - ` +
                `merge targets must be an active (non-merged) role. This restriction keeps every merge pointer a single ` +
                `hop, which structurally prevents circular or multi-hop chains. Merge into "${target.merged_into_id}" directly instead.`,
            );
        }

        const dependents = await client.query('SELECT id, name FROM roles WHERE merged_into_id = $1', [sourceRoleId]);
        if (dependents.rows.length > 0) {
            throw new RoleConsolidationError(
                `Role "${source.name}" (id=${sourceRoleId}) cannot be merged: ${dependents.rows.length} other role(s) ` +
                `are already merged into it (e.g. "${dependents.rows[0].name}") - merging it further would create a ` +
                `multi-hop chain, which this service does not support. Re-point those roles directly at the intended ` +
                `final target first.`,
            );
        }

        await client.query('UPDATE roles SET merged_into_id = $2 WHERE id = $1', [sourceRoleId, targetRoleId]);

        console.log(
            `[role-consolidation] Merged "${source.name}" (${sourceRoleId}) into "${target.name}" (${targetRoleId}).` +
            (notes ? ` Notes: ${notes}` : ''),
        );

        return { sourceRoleId, sourceName: source.name, targetRoleId, targetName: target.name };
    });
}
