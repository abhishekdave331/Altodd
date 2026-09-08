// Only obvious aliases within the GenAI/Generative AI/LLM Engineer family are
// merged. Genuinely distinct roles (MLOps Engineer, Data Scientist, etc.) are
// intentionally left as-is — the dashboard's analytics should reflect real
// distinctions in the market, not an over-aggressive rollup.
const ROLE_ALIASES = {
    'genai engineer': 'Generative AI Engineer',
    'gen ai engineer': 'Generative AI Engineer',
    'llm engineer': 'Generative AI Engineer',
};

function toKey(value) {
    return String(value).toLowerCase().trim().replace(/\s+/g, ' ');
}

export function normalizeRole(rawRole) {
    if (!rawRole) return null;
    const trimmed = String(rawRole).trim();
    if (!trimmed) return null;
    return ROLE_ALIASES[toKey(trimmed)] ?? trimmed;
}

// Real seniority_inferred values are inconsistently formatted across files
// ("Mid-Senior level", "Mid-Senior", "Entry level", "Senior", "Junior").
// The market-health formula needs to match these against canonical buckets,
// so this normalizes to a consistent label set without changing the column
// type/name in job_roles.seniority (still a plain VARCHAR(50)).
const SENIORITY_ALIASES = {
    intern: 'Internship',
    internship: 'Internship',
    'entry level': 'Entry-Level',
    'entry-level': 'Entry-Level',
    junior: 'Junior',
    associate: 'Associate',
    'mid level': 'Mid-Level',
    'mid-level': 'Mid-Level',
    'mid-senior': 'Mid-Level',
    'mid-senior level': 'Mid-Level',
    senior: 'Senior',
    staff: 'Staff',
    principal: 'Principal',
    lead: 'Lead',
    manager: 'Manager',
};

export const ENTRY_MID_SENIORITY_LABELS = ['Entry-Level', 'Junior', 'Mid-Level', 'Associate', 'Internship'];

export function normalizeSeniority(rawSeniority) {
    if (!rawSeniority) return null;
    const trimmed = String(rawSeniority).trim();
    if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;
    const mapped = SENIORITY_ALIASES[toKey(trimmed)];
    if (mapped) return mapped;
    return trimmed;
}
