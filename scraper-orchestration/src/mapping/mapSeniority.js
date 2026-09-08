// Deterministic translation from Altodd's canonical seniority vocabulary
// (Internship, Entry-Level, Junior, Associate, Mid-Level, Senior, Staff,
// Principal, Lead, Manager - see market-intelligence/normalizeRoles.js and
// profile-enrichment's SENIORITY_LEVELS) to LinkedIn's own experienceLevels
// filter enum (internship, entryLevel, associate, midSeniorLevel, director,
// executive), as accepted by linkedin-jobs-scraper's input_schema.json.
//
// LinkedIn has no finer granularity above "Mid-Senior level" for individual-
// contributor tracks, so Senior/Staff/Principal/Lead all collapse into
// midSeniorLevel - the closest real LinkedIn bucket, not a guess. "Manager"
// maps to "director" since LinkedIn has no distinct management-track tier
// below director.
const SENIORITY_TO_EXPERIENCE_LEVEL = {
    Internship: 'internship',
    'Entry-Level': 'entryLevel',
    Junior: 'entryLevel',
    Associate: 'associate',
    'Mid-Level': 'midSeniorLevel',
    Senior: 'midSeniorLevel',
    Staff: 'midSeniorLevel',
    Principal: 'midSeniorLevel',
    Lead: 'midSeniorLevel',
    Manager: 'director',
};

/**
 * @param {string|null} seniority - a value from search_configurations.seniority
 * @returns {string[]} an experienceLevels array for the actor input - empty
 *   if seniority is null/unrecognized, so the filter is safely OMITTED
 *   (see buildActorInput.js) rather than guessed.
 */
export function mapSeniorityToExperienceLevels(seniority) {
    if (!seniority) return [];
    const mapped = SENIORITY_TO_EXPERIENCE_LEVEL[seniority];
    return mapped ? [mapped] : [];
}
