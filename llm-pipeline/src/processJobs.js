import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Extracted unchanged from main.js (Task 7.4) so both the original
// "latest run" entry point (main.js) and the new explicit-dataset entry
// point (main-from-datasets.js) share exactly one job-analysis loop -
// prompt.js and analyze-one.js are untouched, and this function's own
// behavior is byte-identical to what main.js did inline before this
// extraction.
export async function processJobs(jobs, { outputDir, tmpDir, analyzeOneScript, maxJobs, jobTimeoutMs }) {
    await mkdir(outputDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });

    const toProcess = jobs.slice(0, maxJobs);
    let succeeded = 0;
    let failed = 0;

    for (const [index, job] of toProcess.entries()) {
        const label = job.jobId ?? job.title ?? `job-${index}`;
        console.log(`[${index + 1}/${toProcess.length}] Analyzing: ${label}`);

        const jobFile = path.join(tmpDir, `${index}.json`);
        const outFile = path.join(outputDir, `${job.jobId ?? index}.json`);
        await writeFile(jobFile, JSON.stringify(job));

        try {
            // Each job runs in its own fresh Node process, isolating one job's
            // failure/timeout from the rest of the batch.
            execFileSync(process.execPath, [analyzeOneScript, jobFile, outFile], {
                stdio: 'inherit',
                timeout: jobTimeoutMs,
            });
            succeeded += 1;
        } catch (err) {
            console.error(`Failed to analyze ${label}: ${err.message}`);
            failed += 1;
        }
    }

    await rm(tmpDir, { recursive: true, force: true });
    return { total: toProcess.length, succeeded, failed };
}
