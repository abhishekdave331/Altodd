// Job-posting analysis now uses Groq's hosted API instead of local Ollama
// (explicit instruction during Task 7.4 - Ollama is no longer used anywhere
// in this project; profile-enrichment already made this same switch in Task
// 7.1). Same shape as profile-enrichment/src/llm/groqClient.js - kept as its
// own copy rather than a cross-module import, matching this project's
// established convention of each top-level module staying self-contained.
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_RATE_LIMIT_RETRIES = 3;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Groq's on-demand tier has a real, observed tokens-per-minute limit that a
// sequential batch of job analyses (each a few thousand tokens, run one per
// process) can hit in practice - this is not a hypothetical failure mode.
// A 429 response includes the exact wait time in its error message
// (e.g. "Please try again in 15.66s"); parse it when present and wait that
// long plus a small buffer, otherwise fall back to a fixed delay.
function parseRetryAfterSeconds(bodyText) {
    const match = bodyText.match(/try again in ([\d.]+)s/i);
    return match ? Number(match[1]) : null;
}

export async function analyzeJobWithGroq({ apiKey, model, systemPrompt, userPrompt }) {
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not set - required to call Groq for job analysis.');
    }

    for (let attempt = 0; ; attempt += 1) {
        let response;
        try {
            response = await fetch(GROQ_CHAT_URL, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.1,
                }),
            });
        } catch (err) {
            throw new Error(`Could not reach Groq API. Original error: ${err.message}`);
        }

        const bodyText = await response.text();

        if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
            const waitSeconds = parseRetryAfterSeconds(bodyText) ?? 5;
            console.log(`Groq rate limit hit, retrying in ${waitSeconds.toFixed(1)}s (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})...`);
            await sleep((waitSeconds + 0.5) * 1000);
            continue;
        }

        if (!response.ok) {
            throw new Error(`Groq request failed (${response.status}): ${bodyText.slice(0, 2000)}`);
        }

        const data = JSON.parse(bodyText);
        const content = data.choices?.[0]?.message?.content ?? '';

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch {
            throw new Error(`Groq returned non-JSON content:\n${content.slice(0, 2000)}`);
        }

        // response_format: {type: 'json_object'} does not always guarantee a
        // bare object at the top level in practice - observed real Groq
        // output for this open-weight model occasionally wraps the single
        // analysis object in a one-element array. Unwrap defensively here
        // (in llm-pipeline, at the source) rather than loosening
        // market-intelligence's isValidAnalysis() check, which is correct to
        // reject anything else as malformed.
        if (Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === 'object') {
            return parsed[0];
        }
        return parsed;
    }
}
