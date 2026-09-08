import { mapSeniorityToExperienceLevels } from './mapSeniority.js';

// linkedin-jobs-scraper's `keywords` field is a single string that supports
// boolean OR / quoted phrases (see its input_schema.json prefill,
// e.g. `"AI Engineer" OR "Applied AI Engineer"`) - joining a query list this
// way requires no change to the existing actor.
function joinAsQuotedOr(queries) {
    return queries.map((q) => `"${q.replace(/"/g, '')}"`).join(' OR ');
}

/**
 * Builds one linkedin-jobs-scraper actor input object from a query list plus
 * the deterministic filters already resolved by profile-enrichment (Task
 * 7.2). Every optional field is omitted (left undefined, not a guessed
 * default) when the source data doesn't support it - only `keywords` is
 * required by the actor's own schema.
 *
 * industries/employment_type from search_configurations are intentionally
 * NOT mapped here: the actor has no industry filter at all, and
 * employment_type is always null at the source (Task 7.1/7.2 never capture
 * it) - see Task 7.3 report for both as known/documented gaps, not silently
 * dropped without explanation.
 *
 * @param {object} params
 * @param {string[]} params.queries - non-empty list of query strings for the `keywords` field
 * @param {{seniority: string|null, location: string|null}} params.filters
 * @param {string[]} [params.titleKeywords] - relevance-filter keywords (Task 7.2's `keywords`), mapped to the actor's own post-scrape titleKeywordFilter - a direct conceptual match, not a repurposing
 * @param {number} params.maxItems
 * @returns {object} a full linkedin-jobs-scraper actor input object
 * @throws {Error} if queries is empty - the actor requires a non-empty `keywords` string
 */
export function buildActorInput({ queries, filters, titleKeywords = [], maxItems }) {
    if (!Array.isArray(queries) || queries.length === 0) {
        throw new Error('buildActorInput() requires at least one query - the actor\'s "keywords" field is required and must not be an empty string.');
    }

    const input = {
        keywords: joinAsQuotedOr(queries),
        maxItems,
        fetchFullDescription: true,
    };

    if (filters.location) {
        input.location = filters.location;
    }

    const experienceLevels = mapSeniorityToExperienceLevels(filters.seniority);
    if (experienceLevels.length > 0) {
        input.experienceLevels = experienceLevels;
    }

    if (titleKeywords.length > 0) {
        input.titleKeywordFilter = titleKeywords;
    }

    return input;
}
