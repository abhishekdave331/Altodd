export function parseJsonSafe(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

export function isValidAnalysis(analysis) {
    return Boolean(analysis?.job_metadata?.job_id);
}

// A couple of source files store an absent value as the literal string "null"
// instead of real null (seen in description/job_overview/advertised_role).
export function nullifyLiteralNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim().toLowerCase() === 'null') return null;
    return value;
}

// Tries each key in order, treating literal-"null" strings and empty strings
// as absent, returning the first real value found.
export function getFirstDefined(obj, keys) {
    if (!obj) return undefined;
    for (const key of keys) {
        const value = nullifyLiteralNull(obj[key]);
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return undefined;
}

// Real values seen: 69 (number), "44" (numeral string), "Over 200 applicants" (phrase).
export function parseApplicants(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : null;
    if (typeof raw === 'string') {
        const match = raw.match(/\d[\d,]*/);
        if (!match) return null;
        return parseInt(match[0].replace(/,/g, ''), 10);
    }
    return null;
}

// Real values seen: 7 (number), "3-5" (range), "8+" (plus), "10" (numeral string).
export function parseYearsField(raw) {
    if (raw == null) return { min: null, max: null };
    if (typeof raw === 'number') return { min: raw, max: raw };

    const str = String(raw).trim();
    let match;
    if ((match = str.match(/^(\d+)\s*-\s*(\d+)$/))) {
        return { min: Number(match[1]), max: Number(match[2]) };
    }
    if ((match = str.match(/^(\d+)\s*\+$/))) {
        return { min: Number(match[1]), max: null };
    }
    if ((match = str.match(/^(\d+)$/))) {
        return { min: Number(match[1]), max: Number(match[1]) };
    }
    return { min: null, max: null };
}

// The DDL only has minimum/maximum_experience, but real data spreads the
// signal across minimum_years/maximum_years/preferred_years, and often only
// one of the three is actually populated.
export function combineExperience(minimumYears, maximumYears, preferredYears) {
    const m = parseYearsField(minimumYears);
    const x = parseYearsField(maximumYears);
    const p = parseYearsField(preferredYears);

    return {
        minimum_experience: m.min ?? p.min ?? x.min ?? null,
        maximum_experience: x.max ?? m.max ?? p.max ?? null,
    };
}

// Single rule covering every null / "implied" / true / false / array field:
// ai_lifecycle_coverage.*, production_requirements.*, engineering_requirements.*,
// domain_analysis.domain_expertise_required.
export function coerceTriState(raw) {
    if (raw === true) return true;
    if (raw === false) return false;
    if (typeof raw === 'string' && raw.trim().toLowerCase() === 'implied') return true;
    if (Array.isArray(raw)) return raw.length > 0;
    if (raw == null) return null;
    return null;
}

// One source file has ai_lifecycle_coverage as a flat string[] (old prompt
// version) instead of the keyed object every other file uses.
export function isFlatArrayAiLifecycle(raw) {
    return Array.isArray(raw);
}

export function normalizeSkillArrayOrNull(arr) {
    return Array.isArray(arr) ? arr : [];
}

// Every real location value is "City, State, Country" (exactly 2 commas),
// even in files lacking separate city/state/country keys.
export function parseLocation(jobMetadata) {
    const location = nullifyLiteralNull(jobMetadata?.location) ?? null;
    const city = nullifyLiteralNull(jobMetadata?.city);
    const state = nullifyLiteralNull(jobMetadata?.state);
    const country = nullifyLiteralNull(jobMetadata?.country);

    if (city || state || country) {
        return { location, city: city ?? null, state: state ?? null, country: country ?? null };
    }

    if (typeof location === 'string' && location.split(',').length === 3) {
        const [c, s, co] = location.split(',').map((part) => part.trim());
        return { location, city: c || null, state: s || null, country: co || null };
    }

    return { location, city: null, state: null, country: null };
}
