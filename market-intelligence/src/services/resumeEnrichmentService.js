// Task 7.7: thin cross-module boundary around profile-enrichment's existing
// resume pipeline (scripts/processResume.js) - extraction/Groq-enrichment/
// validation/persistence logic is not duplicated or reimplemented here.
// profile-enrichment/market-intelligence are independently deployable
// modules with no cross-imports (same convention as scraper-orchestration/
// llm-pipeline), so this invokes the existing CLI script as a child process,
// exactly like pipelineExecutionService.js does for the personalized
// pipeline in Task 7.6.
//
// Unlike Task 7.6's scraper pipeline (multi-minute, Apify polling), resume
// enrichment is a single Groq call - measured at ~2-3s for a real resume in
// this project's own investigation. That's well within acceptable
// synchronous HTTP request latency, so this is awaited directly in the
// route rather than spawned detached + polled. execFile (not execFileSync)
// is used so the event loop still serves other requests (e.g. Task 7.6's
// GET /api/pipeline-runs/:id polling) while this one awaits Groq.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PROFILE_ENRICHMENT_DIR = path.join(ROOT, 'profile-enrichment');
const PROCESS_RESUME_SCRIPT = path.join(PROFILE_ENRICHMENT_DIR, 'scripts', 'processResume.js');
const ENV_FLAGS = ['--env-file-if-exists=../.env', '--env-file-if-exists=.env'];

function parseLastJsonLine(stdout) {
    const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
    try {
        return JSON.parse(lastLine);
    } catch (err) {
        throw new Error(`Could not parse processResume.js's result JSON from its last output line: ${err.message}`);
    }
}

// Thrown for both a clean {error:true,...} result AND a hard process crash
// (non-zero exit with unparseable output) - callers only need `.stage` and
// `.detail` to build an honest HTTP response either way.
export class ResumeProcessingError extends Error {
    constructor(stage, detail, resumeId = null, profileId = null) {
        super(detail);
        this.stage = stage;
        this.resumeId = resumeId;
        this.profileId = profileId;
    }
}

export async function processResume(tempFilePath, originalFilename) {
    let stdout;
    try {
        ({ stdout } = await execFileAsync(
            process.execPath,
            [...ENV_FLAGS, PROCESS_RESUME_SCRIPT, tempFilePath, originalFilename],
            { cwd: PROFILE_ENRICHMENT_DIR },
        ));
    } catch (err) {
        // A non-zero exit still carries the structured JSON on stdout
        // (processResume.js's own catch block emits it before exiting 1) -
        // execFile's rejection error still has .stdout/.stderr attached.
        if (err.stdout) {
            const result = parseLastJsonLine(err.stdout);
            if (result?.error) {
                throw new ResumeProcessingError(result.stage, result.message, result.resumeId, result.profileId);
            }
        }
        throw new ResumeProcessingError('process', err.stderr?.trim() || err.message);
    }

    const result = parseLastJsonLine(stdout);
    if (result?.error) {
        throw new ResumeProcessingError(result.stage, result.message, result.resumeId, result.profileId);
    }
    return result;
}
