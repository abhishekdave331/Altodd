// Task 7.6: launches the existing cross-module personalized pipeline
// (scripts/run-personalized-pipeline.js at the repo root, unchanged in its
// core logic - see Task 7.5) as a detached background child process from
// the HTTP API, so a POST /api/pipeline-runs request can return immediately
// instead of blocking the Express event loop for the pipeline's full
// multi-minute runtime (Apify actor polling + Groq analysis + ingestion).
//
// This does not duplicate any pipeline logic: the route only creates the
// pipeline_runs row (via pipelineRunService, shared with the CLI tracker)
// and hands its id to the exact same sequencer script the CLI/cron path
// already uses, via --pipeline-run-id so it doesn't create a second row.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../config/database.js';
import { updatePipelineRun } from './pipelineRunService.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SEQUENCER_SCRIPT = path.join(ROOT, 'scripts', 'run-personalized-pipeline.js');
const LOG_DIR = path.join(ROOT, 'logs');

export function spawnPersonalizedPipeline({ userProfileId, pipelineRunId }) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logPath = path.join(LOG_DIR, `pipeline-run-${pipelineRunId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    // No --env-file-if-exists flags needed here: spawn() inherits the
    // parent's process.env by default, and the market-intelligence server
    // itself is started via `node --env-file-if-exists=../.env
    // --env-file-if-exists=.env src/app.js` (see package.json), so
    // APIFY_TOKEN/GROQ_* (root .env) and DB_* (market-intelligence/.env)
    // are already present in this process's env and flow straight through.
    // detached:true + unref() lets this child keep running (and this
    // request return) independently of whether the API request that
    // started it is still open.
    const child = spawn(
        process.execPath,
        [SEQUENCER_SCRIPT, '--profile', userProfileId, '--pipeline-run-id', pipelineRunId],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.on('error', (err) => {
        // A spawn-level failure (e.g. node binary not found) means the
        // sequencer never ran at all, so nothing will ever move this row out
        // of 'pending' on its own - record the failure directly here rather
        // than leaving a permanently-stuck row, and do not let this throw
        // out of an unawaited background process into an unhandled
        // rejection that could crash the API server.
        logStream.write(`\n[pipeline-execution] Failed to spawn pipeline process: ${err.message}\n`);
        updatePipelineRun(pool, pipelineRunId, {
            status: 'failed',
            errorMessage: `Failed to start pipeline process: ${err.message}`,
            completed: true,
        }).catch((updateErr) => {
            logStream.write(`[pipeline-execution] Additionally could not record the failure in pipeline_runs: ${updateErr.message}\n`);
        });
    });
    child.unref();

    return { logPath };
}
