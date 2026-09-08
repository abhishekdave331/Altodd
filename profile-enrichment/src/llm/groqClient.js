// Resume parsing uses Groq's hosted API (OpenAI-compatible chat completions).
// llm-pipeline's job-posting analysis also moved to Groq (originally used
// local Ollama) - Ollama is no longer used anywhere in this project.
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function callGroqJson({ apiKey, model, systemPrompt, userPrompt }) {
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not set - required to call Groq for resume enrichment.');
    }

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
    // bare object at the top level in practice - observed real Groq output
    // for job-posting analysis (same API/model family) occasionally wraps
    // the object in a one-element array. Unwrap defensively here rather than
    // letting validateEnrichedProfile() silently null out real, valid data
    // just because of the wrapping.
    if (Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === 'object') {
        return parsed[0];
    }
    return parsed;
}
