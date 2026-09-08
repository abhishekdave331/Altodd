// Task 7.8: thin cross-module boundary around profile-enrichment's existing
// Task 7.2 search-configuration pipeline (scripts/generateSearchConfig.js) -
// deterministic-filter/Groq-query-generation/validation/persistence logic is
// not duplicated or reimplemented here. Same pattern as
// resumeEnrichmentService.js (Task 7.7) and pipelineExecutionService.js
// (Task 7.6): invoke the existing CLI script as a child process across the
// module boundary, since profile-enrichment/market-intelligence have no
// cross-imports.
//
// Like resume enrichment, this is a single Groq call (no multi-minute Apify
// polling), so it's awaited directly in the route rather than spawned
// detached + polled. execFile (not execFileSync) keeps the event loop free
// to serve other requests while this one awaits Groq.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PROFILE_ENRICHMENT_DIR = path.join(ROOT, 'profile-enrichment');
const GENERATE_SCRIPT = path.join(PROFILE_ENRICHMENT_DIR, 'scripts', 'generateSearchConfig.js');
const ENV_FLAGS = ['--env-file-if-exists=../.env', '--env-file-if-exists=.env'];

function parseLastJsonLine(stdout) {
    const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
    try {
        return JSON.parse(lastLine);
    } catch (err) {
        throw new Error(`Could not parse generateSearchConfig.js's result JSON from its last output line: ${err.message}`);
    }
}

export class SearchConfigGenerationError extends Error {
    constructor(stage, detail, configId = null) {
        super(detail);
        this.stage = stage;
        this.configId = configId;
    }
}

export async function generateSearchConfiguration(userProfileId) {
    let stdout;
    try {
        ({ stdout } = await execFileAsync(
            process.execPath,
            [...ENV_FLAGS, GENERATE_SCRIPT, userProfileId],
            { cwd: PROFILE_ENRICHMENT_DIR },
        ));
    } catch (err) {
        // A non-zero exit still carries the structured JSON on stdout
        // (generateSearchConfig.js's own catch block emits it before
        // exiting 1) - execFile's rejection error still has .stdout attached.
        if (err.stdout) {
            const result = parseLastJsonLine(err.stdout);
            if (result?.error) {
                throw new SearchConfigGenerationError(result.stage, result.message, result.id);
            }
        }
        throw new SearchConfigGenerationError('process', err.stderr?.trim() || err.message);
    }

    const result = parseLastJsonLine(stdout);
    if (result?.error) {
        throw new SearchConfigGenerationError(result.stage, result.message, result.id);
    }
    return result;
}
