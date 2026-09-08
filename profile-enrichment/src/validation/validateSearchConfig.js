const MAX_PRIMARY = 5;
const MAX_SECONDARY = 8;
const MAX_KEYWORDS = 15;

/**
 * Validates and coerces the LLM's raw query-generation output. Never throws
 * on malformed shape: a field that isn't an array (or isn't present at all)
 * becomes an empty array rather than crashing, fabricating filler queries,
 * or persisting the malformed value as-is. Mirrors
 * validateProfile.js's coercion philosophy.
 *
 * Deduplicates and caps each list to keep results genuinely "focused"
 * (Task 7.2's explicit requirement), not open-ended.
 *
 * @param {*} raw - parsed JSON from the LLM (any shape, possibly malformed)
 * @returns {{queries: {primary_queries: string[], secondary_queries: string[], keywords: string[]}, status: 'complete'|'partial', droppedFields: string[]}}
 */
export function validateSearchQueries(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const droppedFields = [];

    function coerceList(key, maxItems) {
        const value = input[key];
        if (value == null) return []; // omitted entirely - not a validation failure, just nothing generated
        if (!Array.isArray(value)) {
            droppedFields.push(key);
            return [];
        }
        const cleaned = value.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
        const deduped = [...new Set(cleaned)];
        if (cleaned.length !== value.length) {
            // some entries were the wrong type or empty - the list is still
            // usable, but flag that it needed cleanup
            droppedFields.push(`${key} (some entries invalid)`);
        }
        return deduped.slice(0, maxItems);
    }

    const queries = {
        primary_queries: coerceList('primary_queries', MAX_PRIMARY),
        secondary_queries: coerceList('secondary_queries', MAX_SECONDARY),
        keywords: coerceList('keywords', MAX_KEYWORDS),
    };

    return {
        queries,
        status: droppedFields.length === 0 ? 'complete' : 'partial',
        droppedFields,
    };
}
