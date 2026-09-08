import { normalizeSkillArrayOrNull } from './validateAnalysis.js';

// Extensible: add more entries as new phrasing variants show up in real data.
// Keys are lowercase/trimmed forms; values are the canonical display name.
export const SKILL_ALIASES = {
    'lang chain': 'LangChain',
    langchain: 'LangChain',
    'langchain framework': 'LangChain',

    'lang graph': 'LangGraph',
    langgraph: 'LangGraph',

    postgres: 'PostgreSQL',
    postgresql: 'PostgreSQL',
    'postgresql database': 'PostgreSQL',

    aws: 'AWS',
    'aws cloud': 'AWS',

    rag: 'RAG',
    'retrieval augmented generation': 'RAG',
    'retrieval-augmented generation': 'RAG',

    'vector db': 'Vector Databases',
    'vector database': 'Vector Databases',
    'vector databases': 'Vector Databases',

    'ci/cd': 'CI/CD',
    'ci/cd pipeline': 'CI/CD',
    cicd: 'CI/CD',
};

function toNormalizedKey(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

export function normalizeSkillName(rawName) {
    const trimmed = String(rawName).trim();
    const key = toNormalizedKey(trimmed);
    const canonical = SKILL_ALIASES[key] ?? trimmed;
    return {
        name: canonical,
        normalized_name: toNormalizedKey(canonical),
    };
}

// Flattens skills.<category> arrays into a deduped list of
// {name, normalized_name, category}, treating a null category value the
// same as an empty array (both mean "no skills in this category").
export function flattenJobSkills(skillsObj) {
    if (!skillsObj || typeof skillsObj !== 'object') return [];

    const seen = new Map();
    for (const [category, rawList] of Object.entries(skillsObj)) {
        for (const rawName of normalizeSkillArrayOrNull(rawList)) {
            if (!rawName || typeof rawName !== 'string') continue;
            const { name, normalized_name } = normalizeSkillName(rawName);
            if (!seen.has(normalized_name)) {
                seen.set(normalized_name, { name, normalized_name, category });
            }
        }
    }
    return [...seen.values()];
}

// Cross-references the flattened per-job skill list against
// skill_priority.critical/important/preferred by normalized name.
// Some files list category-level labels here (e.g. "Machine Learning")
// rather than individual skills — those simply won't match anything and
// are silently ignored (see README "Known data-quality behaviors").
export function assignPriority(flattenedSkills, skillPriority) {
    const buckets = ['critical', 'important', 'preferred'];
    const priorityByNormalizedName = new Map();

    for (const bucket of buckets) {
        for (const rawEntry of normalizeSkillArrayOrNull(skillPriority?.[bucket])) {
            if (!rawEntry || typeof rawEntry !== 'string') continue;
            const { normalized_name } = normalizeSkillName(rawEntry);
            if (!priorityByNormalizedName.has(normalized_name)) {
                priorityByNormalizedName.set(normalized_name, bucket);
            }
        }
    }

    return flattenedSkills.map((skill) => ({
        ...skill,
        priority: priorityByNormalizedName.get(skill.normalized_name) ?? null,
    }));
}

export async function upsertSkill(client, name, normalizedName, category) {
    const result = await client.query(
        `INSERT INTO skills (name, normalized_name, category)
         VALUES ($1, $2, $3)
         ON CONFLICT (normalized_name) DO UPDATE SET category = COALESCE(skills.category, EXCLUDED.category)
         RETURNING id`,
        [name, normalizedName, category ?? null],
    );
    return result.rows[0].id;
}
