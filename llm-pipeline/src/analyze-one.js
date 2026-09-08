import { readFile, writeFile } from 'node:fs/promises';
import { analyzeJobWithOllama } from './ollama-client.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

const [, , jobPath, outputPath] = process.argv;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

const job = JSON.parse(await readFile(jobPath, 'utf8'));

const analysis = await analyzeJobWithOllama({
    host: OLLAMA_HOST,
    model: OLLAMA_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(job),
});

await writeFile(outputPath, JSON.stringify(analysis, null, 2));
