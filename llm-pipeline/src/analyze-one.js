import { readFile, writeFile } from 'node:fs/promises';
import { analyzeJobWithGroq } from './groq-client.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

const [, , jobPath, outputPath] = process.argv;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';

const job = JSON.parse(await readFile(jobPath, 'utf8'));

const analysis = await analyzeJobWithGroq({
    apiKey: GROQ_API_KEY,
    model: GROQ_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(job),
});

await writeFile(outputPath, JSON.stringify(analysis, null, 2));
