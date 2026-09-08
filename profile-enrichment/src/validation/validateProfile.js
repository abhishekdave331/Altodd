// Same canonical seniority vocabulary as profilePrompt.js - kept as a
// separate copy here (not shared code) so the prompt module and this
// validator each own their own list independently, matching this project's
// existing convention of not reaching into another module's internals for a
// small constant (see normalizeSkills.js/normalizeCapabilities.js/
// normalizeRoles.js each having their own private toKey()-style helpers).
const VALID_SENIORITY_LEVELS = [
    'Internship', 'Entry-Level', 'Junior', 'Associate', 'Mid-Level',
    'Senior', 'Staff', 'Principal', 'Lead', 'Manager',
];

function toStringOrNull(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed !== '' ? trimmed : null;
}

function toStringArrayOrNull(value) {
    if (value == null || !Array.isArray(value)) return null;
    const cleaned = value
        .filter((v) => typeof v === 'string' && v.trim() !== '')
        .map((v) => v.trim());
    return cleaned.length > 0 ? cleaned : null;
}

function toNumberOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function toEducationArrayOrNull(value) {
    if (value == null || !Array.isArray(value)) return null;
    const cleaned = value
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => ({
            degree: toStringOrNull(entry.degree),
            field: toStringOrNull(entry.field),
            institution: toStringOrNull(entry.institution),
            year: toStringOrNull(entry.year),
        }))
        .filter((entry) => entry.degree || entry.field || entry.institution || entry.year);
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * Validates and coerces raw LLM JSON output into the strict enriched-profile
 * shape. Never throws on malformed shape - a field that doesn't match its
 * expected type is dropped to null (recorded in droppedFields) rather than
 * saved as-is, crashing the pipeline, or silently fabricated. This mirrors
 * market-intelligence/src/ingestion/validateAnalysis.js's coercion
 * philosophy: never trust the LLM's own type discipline, always the
 * project's own validator.
 *
 * @param {*} raw - parsed JSON from the LLM (any shape, possibly malformed)
 * @returns {{profile: object, status: 'complete'|'partial', droppedFields: string[]}}
 */
export function validateEnrichedProfile(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const droppedFields = [];

    function field(key, coerce, extraCheck) {
        const coerced = coerce(input[key]);
        const hadRawValue = input[key] != null;
        if (hadRawValue && coerced == null) {
            droppedFields.push(key);
            return null;
        }
        if (coerced != null && extraCheck && !extraCheck(coerced)) {
            droppedFields.push(key);
            return null;
        }
        return coerced;
    }

    const profile = {
        target_roles: field('target_roles', toStringArrayOrNull),
        skills: field('skills', toStringArrayOrNull),
        tools_technologies: field('tools_technologies', toStringArrayOrNull),
        seniority_level: field('seniority_level', toStringOrNull, (v) => VALID_SENIORITY_LEVELS.includes(v)),
        years_of_experience: field('years_of_experience', toNumberOrNull, (v) => v >= 0 && v <= 80),
        preferred_industries: field('preferred_industries', toStringArrayOrNull),
        education: field('education', toEducationArrayOrNull),
        location: field('location', toStringOrNull),
        keywords: field('keywords', toStringArrayOrNull),
    };

    return {
        profile,
        status: droppedFields.length === 0 ? 'complete' : 'partial',
        droppedFields,
    };
}
