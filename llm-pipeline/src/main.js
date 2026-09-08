import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchLatestJobs } from './apify-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const TMP_DIR = path.join(__dirname, '..', '.tmp');
const ANALYZE_ONE_SCRIPT = path.join(__dirname, 'analyze-one.js');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID ?? 'WoIkcryaPU8xUSqP0';
const MAX_JOBS = process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : Infinity;
const JOB_TIMEOUT_MS = process.env.JOB_TIMEOUT_MS ? Number(process.env.JOB_TIMEOUT_MS) : 300000;

if (!APIFY_TOKEN) {
    throw new Error('Missing APIFY_TOKEN. Set it in the project root .env file.');
}

async function main() {
    console.log(`Fetching latest dataset from Actor ${APIFY_ACTOR_ID}...`);
    const jobs = await fetchLatestJobs({ token: APIFY_TOKEN, actorId: APIFY_ACTOR_ID });
    console.log(`Fetched ${jobs.length} job(s).`);

    await mkdir(OUTPUT_DIR, { recursive: true });
    await mkdir(TMP_DIR, { recursive: true });

    const toProcess = jobs.slice(0, MAX_JOBS);
    let succeeded = 0;
    let failed = 0;

    for (const [index, job] of toProcess.entries()) {
        const label = job.jobId ?? job.title ?? `job-${index}`;
        console.log(`[${index + 1}/${toProcess.length}] Analyzing: ${label}`);

        const jobFile = path.join(TMP_DIR, `${index}.json`);
        const outFile = path.join(OUTPUT_DIR, `${job.jobId ?? index}.json`);
        await writeFile(jobFile, JSON.stringify(job));

        try {
            // Each job runs in its own fresh Node process — spawning one long-lived
            // process and reusing it for sequential Ollama calls was observed to hang
            // intermittently after the first request (Windows/Node socket quirk).
            execFileSync(process.execPath, [ANALYZE_ONE_SCRIPT, jobFile, outFile], {
                stdio: 'inherit',
                timeout: JOB_TIMEOUT_MS,
            });
            succeeded += 1;
        } catch (err) {
            console.error(`Failed to analyze ${label}: ${err.message}`);
            failed += 1;
        }
    }

    await rm(TMP_DIR, { recursive: true, force: true });
    console.log(`Done. ${succeeded} succeeded, ${failed} failed. Output in ${OUTPUT_DIR}`);
}

await main();
