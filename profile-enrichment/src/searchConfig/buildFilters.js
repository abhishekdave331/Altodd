/**
 * Deterministic, LLM-free pass-through of structured profile fields into
 * scraper filter parameters. No semantic interpretation happens here - these
 * fields are already controlled-vocabulary/scalar values from Task 7.1's
 * enriched_profile, so there is nothing for an LLM to usefully reinterpret.
 *
 * employment_type is always null: enriched_profile (Task 7.1) has no
 * employment-preference field at all, and this function must not fabricate
 * one just because the search-configuration schema has a column for it.
 */
export function buildFiltersFromProfile(profile) {
    const source = profile && typeof profile === 'object' ? profile : {};
    return {
        seniority: typeof source.seniority_level === 'string' ? source.seniority_level : null,
        location: typeof source.location === 'string' ? source.location : null,
        industries: Array.isArray(source.preferred_industries) ? source.preferred_industries : null,
        employment_type: null,
    };
}
