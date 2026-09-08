import http from 'node:http';
import { URL } from 'node:url';

function postJson(url, payload) {
    const body = JSON.stringify(payload);
    const { hostname, port, pathname } = new URL(url);

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname,
                port,
                path: pathname,
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(body),
                    connection: 'close',
                },
                agent: false,
                timeout: 0,
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

export async function analyzeJobWithOllama({ host, model, systemPrompt, userPrompt }) {
    let response;
    try {
        response = await postJson(`${host}/api/chat`, {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            format: 'json',
            stream: false,
            options: { temperature: 0.1, num_ctx: 4096, num_predict: 2048 },
        });
    } catch (err) {
        throw new Error(
            `Could not reach Ollama at ${host}. Is it installed and running ("ollama serve")? `
            + `Original error: ${err.message}`,
        );
    }

    if (response.status !== 200) {
        if (response.status === 404) {
            throw new Error(
                `Ollama returned 404 for model "${model}". Pull it first with: ollama pull ${model}`,
            );
        }
        throw new Error(`Ollama request failed (${response.status}): ${response.body}`);
    }

    const data = JSON.parse(response.body);
    const content = data.message?.content ?? '';

    try {
        return JSON.parse(content);
    } catch {
        throw new Error(`Ollama returned non-JSON content:\n${content.slice(0, 2000)}`);
    }
}
