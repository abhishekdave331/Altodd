// Task 7.4/7.5: end-to-end personalized pipeline sequencer, now recording
// one pipeline_runs row per execution (Task 7.5) that ties together the
// scraper-orchestration / llm-pipeline / market-intelligence steps below.
//
//   scraper-orchestration (runOrchestration.js)   -> status: scraping
//       -> llm-pipeline   (main-from-datasets.js) -> status: analyzing
//       -> market-intelligence (runDaily.js)      -> status: ingesting
//                                                  -> status: completed / completed_with_errors / failed
//
// Each step is a genuinely separate Node project (own package.json/
// node_modules), invoked as a direct `node <script>` child process - the
// same cross-module pattern scripts/run-daily-pipeline.ps1 already used for
// scrape -> LLM -> ingest/aggregate, just from Node instead of PowerShell.
//
// Every step is invoked as `node <flags> <script> <args>` directly (NOT
// `npm run ...`) so no shell is ever needed: npm's Windows shim (npm.cmd)
// only resolves through a shell, which then concatenates rather than
// escapes argument arrays - a real injection risk once arbitrary error-
// message text needs to reach a child process (Task 7.5's tracker calls).
// Calling node.exe directly with an argv array is safe on every platform
// without shell:true, so that whole risk category is removed outright
// rather than mitigated.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const ENV_FLAGS = ['--env-file-if-exists=../.env', '--env-file-if-exists=.env'];

const args = process.argv.slice(2);
const profileFlagIndex = args.indexOf('--profile');
const userProfileId = profileFlagIndex !== -1 ? args[profileFlagIndex + 1] : null;

// Task 7.6: optional - present only when market-intelligence's HTTP API
// (POST /api/pipeline-runs) already created the pipeline_runs row itself
// (so it can return the row in its response before this process even
// starts) and is handing this sequencer its id rather than letting it
// create a second one. Manual/cron invocation without this flag is
// unchanged from Task 7.5: this script still creates its own row.
const pipelineRunIdFlagIndex = args.indexOf('--pipeline-run-id');
const preCreatedPipelineRunId = pipelineRunIdFlagIndex !== -1 ? args[pipelineRunIdFlagIndex + 1] : null;

if (!userProfileId) {
    console.error('Usage: node scripts/run-personalized-pipeline.js --profile <user_profiles.id> [--pipeline-run-id <existing pipeline_runs.id>]');
    process.exit(1);
}

// Task 7.10: on failure, execFileSync's own thrown error message is always
// the generic "Command failed: <full command line>" - it never mentions
// *why* (Node populates err.signal/err.status on the same error object, but
// nothing previously read them). Investigation into the intermittent
// orchestration-step failures observed in Tasks 7.6/7.9 found real cases
// where the child produced ZERO stderr output before dying, meaning the
// existing generic message was the ONLY diagnostic signal available - and
// it discarded the one piece of information (signal vs. plain exit code)
// that would tell a future investigation whether the process was killed
// externally (err.signal set - e.g. by the OS/antivirus/resource limits)
// or exited abnormally on its own (err.signal null, err.status the code).
// This is an observability improvement only: it does not change control
// flow, stdio wiring, or retry behavior, and could not be tied to a
// specific proven root cause during this investigation (see Task 7.10's
// report) - extensive reproduction attempts (41 trials: sequential,
// concurrent, standalone, and full-API-chain) did not reproduce the
// original failure, so no behavioral fix was justified.
function runNode(cwd, scriptPath, scriptArgs, { captureStdout = false } = {}) {
    const fullArgs = [...ENV_FLAGS, scriptPath, ...scriptArgs];
    try {
        if (captureStdout) {
            return execFileSync(NODE, fullArgs, { cwd, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
        }
        execFileSync(NODE, fullArgs, { cwd, stdio: 'inherit' });
        return null;
    } catch (err) {
        const diagnostic = err.signal
            ? `process was terminated by signal ${err.signal} (likely killed externally - OS, resource limit, or antivirus - rather than a normal JS error)`
            : `process exited with code ${err.status}`;
        err.message = `${err.message} [${diagnostic}]`;
        throw err;
    }
}

// Parses the LAST non-empty line of captured stdout as JSON - robust to any
// human-readable progress lines a step also prints to stdout ahead of its
// final structured result (the same tolerant parsing already proven
// necessary for scraper-orchestration's output in Task 7.4).
function parseLastJsonLine(stdout, label) {
    const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
    try {
        return JSON.parse(lastLine);
    } catch (err) {
        throw new Error(`Could not parse ${label}'s result JSON from its last output line: ${err.message}`);
    }
}

const MARKET_INTELLIGENCE_DIR = path.join(ROOT, 'market-intelligence');

function trackerCreate() {
    const out = runNode(MARKET_INTELLIGENCE_DIR, 'scripts/pipelineRunTracker.js', ['create', userProfileId], { captureStdout: true });
    return parseLastJsonLine(out, 'pipelineRunTracker create').id;
}

function trackerUpdate(pipelineRunId, fields) {
    const flagArgs = [];
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;
        flagArgs.push(`--${key}`, String(value));
    }
    if (flagArgs.length === 0) return;
    runNode(MARKET_INTELLIGENCE_DIR, 'scripts/pipelineRunTracker.js', ['update', pipelineRunId, ...flagArgs]);
}

const pipelineRunId = preCreatedPipelineRunId ?? trackerCreate();
if (preCreatedPipelineRunId) {
    console.log(`\n[pipeline] Using pre-created pipeline_runs.id = ${pipelineRunId} for profile ${userProfileId}`);
} else {
    console.log(`\n[pipeline] Created pipeline_runs.id = ${pipelineRunId} for profile ${userProfileId}`);
}

let hadPartialFailure = false;

try {
    // --- Stage 1: scraping ---
    trackerUpdate(pipelineRunId, { status: 'scraping' });
    console.log('\n=== [pipeline] Step 1/3: scraper orchestration ===');

    const orchestrationStdout = runNode(
        path.join(ROOT, 'scraper-orchestration'),
        'scripts/runOrchestration.js',
        [userProfileId, pipelineRunId],
        { captureStdout: true },
    );
    process.stdout.write(`${orchestrationStdout.trim()}\n`);
    const orchestrationResult = parseLastJsonLine(orchestrationStdout, 'scraper-orchestration');
    const { searchConfigurationId, successfulDatasetIds, runs, reason } = orchestrationResult;

    if (searchConfigurationId) {
        trackerUpdate(pipelineRunId, { 'search-configuration-id': searchConfigurationId });
    }

    const jobsScraped = (runs ?? [])
        .filter((r) => r.status === 'succeeded')
        .reduce((sum, r) => sum + (r.resultCount ?? 0), 0);
    trackerUpdate(pipelineRunId, { 'jobs-scraped': jobsScraped });

    // Honest partial-failure tracking (Task 7.5 requirement): a scraper run
    // failing while another succeeds must not be silently absorbed into a
    // plain "completed" status later.
    if ((runs ?? []).some((r) => r.status !== 'succeeded')) {
        hadPartialFailure = true;
    }

    if (!searchConfigurationId) {
        trackerUpdate(pipelineRunId, {
            status: 'completed',
            'error-message': `No search configuration available for this profile (${reason}).`,
            completed: 'true',
        });
        console.log(`[pipeline] Stopping: ${reason}. Nothing to scrape.`);
        process.exit();
    }
    if (!successfulDatasetIds || successfulDatasetIds.length === 0) {
        trackerUpdate(pipelineRunId, {
            status: hadPartialFailure ? 'completed_with_errors' : 'completed',
            'error-message': `No successful Apify datasets this cycle (${reason ?? 'all scraper runs failed or returned no dataset'}).`,
            completed: 'true',
        });
        console.log('[pipeline] Stopping: no successful datasets - nothing to analyze.');
        process.exit();
    }

    // --- Stage 2: analyzing ---
    trackerUpdate(pipelineRunId, { status: 'analyzing' });
    console.log(`\n=== [pipeline] Step 2/3: LLM analysis for ${successfulDatasetIds.length} dataset(s) ===`);

    const analysisStdout = runNode(
        path.join(ROOT, 'llm-pipeline'),
        'src/main-from-datasets.js',
        [successfulDatasetIds.join(',')],
        { captureStdout: true },
    );
    process.stdout.write(analysisStdout);
    const analysisResult = parseLastJsonLine(analysisStdout, 'llm-pipeline');
    const { jobsAnalyzed, jobsProcessedSuccessfully, jobsFailed, datasetFetchFailures } = analysisResult;

    trackerUpdate(pipelineRunId, {
        'jobs-analyzed': jobsAnalyzed,
        'jobs-processed-successfully': jobsProcessedSuccessfully,
    });

    if (jobsFailed > 0 || datasetFetchFailures > 0) {
        hadPartialFailure = true;
    }
    if (jobsAnalyzed > 0 && jobsProcessedSuccessfully === 0) {
        // The entire analysis stage produced nothing usable - this is a real
        // stage failure, not a partial one, even though nothing crashed.
        trackerUpdate(pipelineRunId, {
            status: 'failed',
            'error-message': `All ${jobsAnalyzed} job(s) failed LLM analysis.`,
            completed: 'true',
        });
        console.error('[pipeline] FAILED: analysis stage produced zero successfully processed jobs.');
        process.exit(1);
    }

    // --- Stage 3: ingesting (covers ingest + aggregate) ---
    // "aggregating" is intentionally not a separate observed status here:
    // market-intelligence's daily script (dailyPipeline.js) runs ingest and
    // aggregate as one atomic call, so there is no real midpoint for this
    // sequencer to honestly report.
    trackerUpdate(pipelineRunId, { status: 'ingesting' });
    console.log('\n=== [pipeline] Step 3/3: market-intelligence ingest + aggregate ===');
    runNode(MARKET_INTELLIGENCE_DIR, 'scripts/runDaily.js', []);

    const finalStatus = hadPartialFailure ? 'completed_with_errors' : 'completed';
    trackerUpdate(pipelineRunId, { status: finalStatus, completed: 'true' });
    console.log(`\n=== [pipeline] Personalized pipeline ${finalStatus}. ===`);
} catch (err) {
    console.error(`\n[pipeline] FAILED: ${err.message}`);
    try {
        trackerUpdate(pipelineRunId, { status: 'failed', 'error-message': err.message, completed: 'true' });
    } catch (trackerErr) {
        console.error(`[pipeline] Additionally could not record the failure in pipeline_runs: ${trackerErr.message}`);
    }
    process.exitCode = 1;
}
