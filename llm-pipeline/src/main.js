import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchLatestJobs } from './apify-client.js';
import { processJobs } from './processJobs.js';

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

    const { succeeded, failed } = await processJobs(jobs, {
        outputDir: OUTPUT_DIR,
        tmpDir: TMP_DIR,
        analyzeOneScript: ANALYZE_ONE_SCRIPT,
        maxJobs: MAX_JOBS,
        jobTimeoutMs: JOB_TIMEOUT_MS,
    });

    console.log(`Done. ${succeeded} succeeded, ${failed} failed. Output in ${OUTPUT_DIR}`);
}

await main();
