import { nullifyLiteralNull } from '../ingestion/validateAnalysis.js';
import { CAPABILITY_RULES } from '../ingestion/normalizeCapabilities.js';

// Only dimensions with a real canonical entity table today. seniority/
// industry are recognized (for a clear error) but not supported, since no
// canonical entity table exists for them yet - see Task 5.3/5.5. 'role'
// moved here in Task 5.11 once the roles table (migration 004) existed - the
// exact_match/alias_match/unresolved steps below are already fully
// dimension-generic, so no other resolver logic changed to support it. Step
// 5 (deterministic rule matching) stays capability-only: with only a
// handful of known real role values and no regex-worthy pattern evidence,
// rule-based role matching isn't justified yet (see Task 5.11 report) - a
// role value that isn't an exact/alias match simply falls through to
// 'unresolved', same as it would for any other unmatched capability.
const SUPPORTED_DIMENSIONS = ['skill', 'capability', 'role'];
const KNOWN_UNSUPPORTED_DIMENSIONS = ['seniority', 'industry'];

// Exported (only this line changed) so the review resolution service
// (reviewResolution.js) can validate a supplied canonical target against the
// correct table for a queue item's dimension without redefining this map -
// nothing else about this module's behavior changes.
export const CANONICAL_TABLE_BY_DIMENSION = {
    skill: 'skills',
    capability: 'capabilities',
    role: 'roles',
};

// Thrown when taxonomy_aliases.canonical_id (a polymorphic reference with no
// database-level FK - by design, see Task 5.4.1/5.5) points at a row that
// does not actually exist in the target dimension's canonical table. This is
// a data integrity problem, not a normal "unresolved" outcome, so it is
// surfaced as a thrown error rather than folded into the return value.
export class AliasIntegrityError extends Error {}

// Same lowercase+trim+collapse-whitespace transformation already used by
// both normalizeSkills.js's toNormalizedKey and normalizeCapabilities.js's
// toNormalizedKey (verified identical in both, Task 5.7 Phase 1). Neither
// function exports its version, so this reproduces the same behavior rather
// than reaching into either module's private internals.
function toNormalizedKey(value) {
    return String(value).toLowerCase().trim().replace(/\s+/g, ' ');
}

// Returns the canonical label of the first CAPABILITY_RULES entry whose
// pattern matches, or null if none match. Reuses the real, exported rules
// array directly - not a copy, not a redesign.
function matchCapabilityRule(trimmedValue) {
    for (const rule of CAPABILITY_RULES) {
        if (rule.pattern.test(trimmedValue)) {
            return rule.canonical;
        }
    }
    return null;
}

// Following a role merge (Task 5.14) is role-specific: skills/capabilities
// have no merged_into_id column at all, so this is only ever called for
// dimension==='role', keeping their query shape completely untouched. A
// merge target is only ever allowed to be active (enforced by
// roleConsolidation.js's mergeRole()), so every real pointer is exactly one
// hop - MAX_ROLE_MERGE_HOPS exists only to surface corrupted/out-of-band
// data (e.g. a chain created outside mergeRole()) as a clear error instead
// of looping forever or silently returning the wrong role.
const MAX_ROLE_MERGE_HOPS = 5;

// Exported (Task 5.15, only this line changed) so reviewResolution.js's
// approveAsAlias() can resolve a requested canonical target to its final
// active role before storing an alias, reusing this exact merge-walking
// logic instead of duplicating it in a second file.
export async function followRoleMerge(db, roleId, roleName) {
    let currentId = roleId;
    let hops = 0;
    for (;;) {
        const row = await db.query('SELECT id, name, merged_into_id FROM roles WHERE id = $1', [currentId]);
        if (row.rows.length === 0) {
            throw new Error(
                `Role merge chain from "${roleName}" (id=${roleId}) references a nonexistent role id "${currentId}". ` +
                `This should be impossible given roles.merged_into_id's foreign key (migration 005) - data may have ` +
                `been modified outside mergeRole().`,
            );
        }
        const current = row.rows[0];
        if (!current.merged_into_id) {
            return { id: current.id, name: current.name };
        }
        hops += 1;
        if (hops > MAX_ROLE_MERGE_HOPS) {
            throw new Error(
                `Role merge chain starting from "${roleName}" (id=${roleId}) did not reach an active role within ` +
                `${MAX_ROLE_MERGE_HOPS} hops - likely a circular or corrupted merge chain. mergeRole() only permits ` +
                `merging into an already-active role, so a real chain this long should be impossible.`,
            );
        }
        currentId = current.merged_into_id;
    }
}

function droppedResult(dimension, rawValue, reason) {
    return {
        dimension,
        rawValue,
        normalizedValue: null,
        canonicalId: null,
        canonicalName: null,
        normalizationMethod: 'dropped_null_like',
        requiresReview: false,
        reason,
    };
}

/**
 * Read-only taxonomy normalization resolver (Task 5.3's shared resolver,
 * built independently - not wired into ingestion yet).
 *
 * Never writes to the database: no aliases, no review-queue rows, no
 * canonical entities are created, updated, or deleted here. It only
 * determines what a raw value means against the data that already exists.
 *
 * @param {object} params
 * @param {'skill'|'capability'} params.dimension
 * @param {*} params.rawValue - the raw extracted value (usually a string)
 * @param {{query: (text: string, params?: any[]) => Promise<{rows: any[]}>}} params.db
 *   - a pg Pool or a checked-out Client; anything exposing .query(text, params)
 *
 * @returns {Promise<{
 *   dimension: string,
 *   rawValue: *,
 *   normalizedValue: string|null,
 *   canonicalId: string|null,
 *   canonicalName: string|null,
 *   normalizationMethod: 'dropped_null_like'|'exact_match'|'alias_match'|'rule_match'|'rule_match_entity_missing'|'unresolved',
 *   requiresReview: boolean,
 *   reason: string|null,
 * }>}
 *
 * @throws {Error} for an unsupported/unknown dimension (caller/programming error)
 * @throws {AliasIntegrityError} if a matched alias's canonical_id doesn't resolve to a real row
 * @throws {Error} propagated unmodified on any real database failure - never
 *   silently converted into an "unresolved" result
 */
export async function resolveTaxonomyValue({ dimension, rawValue, db }) {
    if (KNOWN_UNSUPPORTED_DIMENSIONS.includes(dimension)) {
        throw new Error(
            `Dimension "${dimension}" is not yet supported by resolveTaxonomyValue: no canonical entity table exists for it yet (see Task 5.3/5.5).`,
        );
    }
    if (!SUPPORTED_DIMENSIONS.includes(dimension)) {
        throw new Error(
            `Unknown dimension "${dimension}". Supported dimensions: ${SUPPORTED_DIMENSIONS.join(', ')}.`,
        );
    }

    // Step 1 - null/empty detection. Never creates a taxonomy entity for these.
    const nullified = nullifyLiteralNull(rawValue);
    if (nullified == null || (typeof nullified === 'string' && nullified.trim() === '')) {
        return droppedResult(dimension, rawValue, 'Value was null, undefined, empty, whitespace-only, or the literal string "null".');
    }

    // Step 2 - mechanical normalization. The original rawValue is preserved
    // unmodified in the returned result; only the lookup key is transformed.
    const trimmedValue = String(nullified).trim();
    const normalizedValue = toNormalizedKey(trimmedValue);
    const table = CANONICAL_TABLE_BY_DIMENSION[dimension];

    // Step 3 - exact canonical match.
    const exactMatch = await db.query(
        `SELECT id, name FROM ${table} WHERE normalized_name = $1`,
        [normalizedValue],
    );
    if (exactMatch.rows.length > 0) {
        const resolved = dimension === 'role'
            ? await followRoleMerge(db, exactMatch.rows[0].id, exactMatch.rows[0].name)
            : exactMatch.rows[0];
        return {
            dimension,
            rawValue,
            normalizedValue,
            canonicalId: resolved.id,
            canonicalName: resolved.name,
            normalizationMethod: 'exact_match',
            requiresReview: false,
            reason: null,
        };
    }

    // Step 4 - taxonomy_aliases lookup, with canonical_id integrity check.
    // canonical_id is a polymorphic UUID with no database FK (by design), so
    // it is never trusted blindly here.
    const aliasMatch = await db.query(
        `SELECT canonical_id FROM taxonomy_aliases WHERE dimension = $1 AND normalized_alias_text = $2`,
        [dimension, normalizedValue],
    );
    if (aliasMatch.rows.length > 0) {
        const canonicalId = aliasMatch.rows[0].canonical_id;
        const canonicalRow = await db.query(
            `SELECT id, name FROM ${table} WHERE id = $1`,
            [canonicalId],
        );
        if (canonicalRow.rows.length === 0) {
            throw new AliasIntegrityError(
                `Alias integrity failure: taxonomy_aliases has a "${dimension}" alias for "${rawValue}" pointing to canonical_id=${canonicalId}, but no matching row exists in "${table}".`,
            );
        }
        const resolvedAlias = dimension === 'role'
            ? await followRoleMerge(db, canonicalRow.rows[0].id, canonicalRow.rows[0].name)
            : canonicalRow.rows[0];
        return {
            dimension,
            rawValue,
            normalizedValue,
            canonicalId: resolvedAlias.id,
            canonicalName: resolvedAlias.name,
            normalizationMethod: 'alias_match',
            requiresReview: false,
            reason: null,
        };
    }

    // Step 5 - deterministic rule matching (capability only; CAPABILITY_RULES
    // is not redesigned, just reused as-is).
    if (dimension === 'capability') {
        const ruleCanonical = matchCapabilityRule(trimmedValue);
        if (ruleCanonical) {
            const ruleNormalized = toNormalizedKey(ruleCanonical);
            const ruleEntity = await db.query(
                `SELECT id, name FROM capabilities WHERE normalized_name = $1`,
                [ruleNormalized],
            );
            if (ruleEntity.rows.length > 0) {
                return {
                    dimension,
                    rawValue,
                    normalizedValue,
                    canonicalId: ruleEntity.rows[0].id,
                    canonicalName: ruleEntity.rows[0].name,
                    normalizationMethod: 'rule_match',
                    requiresReview: false,
                    reason: null,
                };
            }
            // The rule fired, but no capability row has ever been created
            // for its canonical label (a real, verified case: "Develop
            // Production AI Systems" matches no ingested job so far). The
            // resolver is read-only, so it reports this distinctly instead
            // of fabricating an entity or silently treating it as unresolved.
            return {
                dimension,
                rawValue,
                normalizedValue,
                canonicalId: null,
                canonicalName: ruleCanonical,
                normalizationMethod: 'rule_match_entity_missing',
                requiresReview: true,
                reason: `A deterministic rule matched this value to "${ruleCanonical}", but no capability row exists yet for that canonical name. Creating one is an ingestion-layer decision outside this resolver's read-only scope.`,
            };
        }
    }

    // Step 6 - unknown. Not created, not held back - reported as unresolved.
    return {
        dimension,
        rawValue,
        normalizedValue,
        canonicalId: null,
        canonicalName: null,
        normalizationMethod: 'unresolved',
        requiresReview: true,
        reason: 'No exact match, alias, or deterministic rule matched this value.',
    };
}
