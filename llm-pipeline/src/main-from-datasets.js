import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchDatasetItems } from './apify-client.js';
import { processJobs } from './processJobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const TMP_DIR = path.join(__dirname, '..', '.tmp');
const ANALYZE_ONE_SCRIPT = path.join(__dirname, 'analyze-one.js');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const MAX_JOBS = process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : Infinity;
const JOB_TIMEOUT_MS = process.env.JOB_TIMEOUT_MS ? Number(process.env.JOB_TIMEOUT_MS) : 300000;

if (!APIFY_TOKEN) {
    throw new Error('Missing APIFY_TOKEN. Set it in the project root .env file.');
}

const datasetIdsArg = process.argv[2];
if (!datasetIdsArg) {
    throw new Error('Usage: node src/main-from-datasets.js <datasetId1,datasetId2,...>');
}
const datasetIds = [...new Set(datasetIdsArg.split(',').map((s) => s.trim()).filter(Boolean))];
if (datasetIds.length === 0) {
    throw new Error('No dataset IDs provided.');
}

async function main() {
    console.log(`Fetching ${datasetIds.length} dataset(s): ${datasetIds.join(', ')}`);

    // One dataset's fetch failing must not block the others (Task 7.4 rule:
    // "one failed scraper run should not block successful datasets" -
    // applies equally to a dataset that fails to FETCH here, not just to
    // runs that failed on the Apify side already).
    const allItems = [];
    const fetchFailures = [];
    for (const datasetId of datasetIds) {
        try {
            const items = await fetchDatasetItems({ token: APIFY_TOKEN, datasetId });
            console.log(`  dataset ${datasetId}: ${items.length} item(s)`);
            allItems.push(...items);
        } catch (err) {
            console.error(`  dataset ${datasetId}: FAILED to fetch - ${err.message}`);
            fetchFailures.push({ datasetId, error: err.message });
        }
    }

    if (fetchFailures.length > 0) {
        console.error(`WARNING: ${fetchFailures.length} dataset(s) could not be fetched and were skipped: ${fetchFailures.map((f) => f.datasetId).join(', ')}`);
    }

    // Dedup by jobId across datasets: the same job can legitimately appear
    // in both a primary and a secondary query's results (e.g. a broad and a
    // narrow title query both matching one posting) - analyze/ingest it
    // exactly once per cycle, not once per dataset it happened to appear in.
    const seenJobIds = new Set();
    const dedupedJobs = [];
    let duplicatesSkipped = 0;
    for (const job of allItems) {
        const jobId = job.jobId;
        if (jobId && seenJobIds.has(jobId)) {
            duplicatesSkipped += 1;
            continue;
        }
        if (jobId) seenJobIds.add(jobId);
        dedupedJobs.push(job);
    }
    console.log(`Total items across datasets: ${allItems.length}, duplicates skipped: ${duplicatesSkipped}, unique jobs to analyze: ${dedupedJobs.length}`);

    const { total, succeeded, failed } = await processJobs(dedupedJobs, {
        outputDir: OUTPUT_DIR,
        tmpDir: TMP_DIR,
        analyzeOneScript: ANALYZE_ONE_SCRIPT,
        maxJobs: MAX_JOBS,
        jobTimeoutMs: JOB_TIMEOUT_MS,
    });

    console.log(`Done. ${succeeded} succeeded, ${failed} failed. Output in ${OUTPUT_DIR}`);

    if (fetchFailures.length > 0) {
        console.error(`Note: ${fetchFailures.length} dataset(s) were never fetched - see WARNING above. This run did not silently treat them as empty/successful.`);
    }

    // Task 7.5: one final clean JSON line so scripts/run-personalized-pipeline.js
    // can record jobs_analyzed/jobs_processed_successfully on the pipeline_runs
    // row - printed last and parsed as the LAST line of captured stdout (the
    // same robust approach already used for scraper-orchestration's output,
    // which also has to tolerate npm's own banner text ahead of it). No
    // change to processJobs.js's own per-job logging, so main.js (the other,
    // untracked entry point) behaves exactly as before.
    console.log(JSON.stringify({ jobsAnalyzed: total, jobsProcessedSuccessfully: succeeded, jobsFailed: failed, datasetFetchFailures: fetchFailures.length }));
}

await main();
