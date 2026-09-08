// Ordered regex -> canonical label rules. First match wins. Extensible —
// add new rules above the fallback as new phrasing patterns show up.
const CAPABILITY_RULES = [
    { pattern: /\brag\b|retrieval.augmented|retrieval pipeline/i, canonical: 'Build RAG Systems' },
    { pattern: /\bagents?\b.*\b(build|design|develop)\b|\b(build|design|develop)\b.*\bagents?\b/i, canonical: 'Build AI Agents' },
    { pattern: /multi-agent|multi agent/i, canonical: 'Design Multi-Agent Systems' },
    { pattern: /\bmcp\b|model context protocol/i, canonical: 'Implement MCP Integrations' },
    { pattern: /observab/i, canonical: 'Implement AI Observability' },
    { pattern: /evaluat/i, canonical: 'Implement AI Evaluation' },
    { pattern: /deploy/i, canonical: 'Deploy AI Applications' },
    { pattern: /scalab|scalable ai system|design.*ai system/i, canonical: 'Design Scalable AI Systems' },
    { pattern: /production[- ]grade ai|production ai system/i, canonical: 'Develop Production AI Systems' },
    { pattern: /backend (api|service)|\bapi\b.*\bbackend\b/i, canonical: 'Build Backend APIs' },
];

function toNormalizedKey(text) {
    return String(text).toLowerCase().trim().replace(/\s+/g, ' ');
}

export function normalizeCapability(rawText) {
    const trimmed = String(rawText).trim();
    for (const rule of CAPABILITY_RULES) {
        if (rule.pattern.test(trimmed)) {
            return { name: rule.canonical, normalized_name: toNormalizedKey(rule.canonical) };
        }
    }
    return { name: trimmed, normalized_name: toNormalizedKey(trimmed) };
}

export async function upsertCapability(client, rawText) {
    const { name, normalized_name } = normalizeCapability(rawText);
    const result = await client.query(
        `INSERT INTO capabilities (name, normalized_name)
         VALUES ($1, $2)
         ON CONFLICT (normalized_name) DO UPDATE SET normalized_name = EXCLUDED.normalized_name
         RETURNING id`,
        [name, normalized_name],
    );
    return result.rows[0].id;
}
