import path from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/config/database.js';
import { extractResumeText, SUPPORTED_FORMATS } from '../src/extraction/extractResumeText.js';
import { callGroqJson } from '../src/llm/groqClient.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../src/llm/profilePrompt.js';
import { validateEnrichedProfile } from '../src/validation/validateProfile.js';
import { persistResume, persistUserProfile } from '../src/ingestion/persistProfile.js';

// Task 7.7: human progress goes to stderr, and exactly ONE line of machine-
// readable JSON goes to stdout at the very end - same convention already
// established for runOrchestration.js/main-from-datasets.js, so
// market-intelligence's new resume-upload API can invoke this script as a
// child process and reliably parse its result from the last stdout line.
function log(message) {
    console.error(message);
}

function emitResult(result) {
    console.log(JSON.stringify(result));
}

// Task 7.7: optional second arg - the API's multer upload gives this script
// a randomly-named temp file path, so the user's real filename (what a
// human/frontend actually cares about, e.g. in resumes.original_filename)
// has to be passed through explicitly rather than derived from inputPath's
// own basename. CLI usage without it is unchanged - falls back to the input
// path's basename exactly as before.
const [, , inputPath, originalFilenameArg] = process.argv;
if (!inputPath) {
    log('Usage: npm run process-resume -- <path-to-resume.pdf> [original-filename]');
    process.exitCode = 1;
    process.exit();
}

const ext = path.extname(inputPath).toLowerCase().replace(/^\./, '');
if (!SUPPORTED_FORMATS.includes(ext)) {
    log(`Unsupported resume format ".${ext}" - only ${SUPPORTED_FORMATS.join(', ')} is currently supported.`);
    process.exitCode = 1;
    process.exit();
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';

async function main() {
    // Tracks which stage failed so a caller (the CLI's own exit code, or the
    // HTTP API parsing this script's final JSON line) can tell "bad input
    // file" (extraction) apart from "our infrastructure had a problem"
    // (enrichment/persistence) rather than one generic failure.
    let stage = 'storage';
    let resumeId = null;

    try {
        const uploadsDir = path.resolve(import.meta.dirname, '../uploads');
        await mkdir(uploadsDir, { recursive: true });
        const storagePath = path.join(uploadsDir, `${randomUUID()}.${ext}`);
        await copyFile(inputPath, storagePath);
        log(`[profile-enrichment] Stored upload at ${storagePath}`);

        stage = 'extraction';
        log('[profile-enrichment] Extracting text...');
        const rawText = await extractResumeText(storagePath);
        log(`[profile-enrichment] Extracted ${rawText.length} characters.`);

        stage = 'persistence';
        resumeId = await persistResume({
            originalFilename: originalFilenameArg ?? path.basename(inputPath),
            fileFormat: ext,
            storagePath,
            rawText,
        });
        log(`[profile-enrichment] Resume persisted: ${resumeId}`);

        stage = 'enrichment';
        log(`[profile-enrichment] Enriching profile via Groq (${GROQ_MODEL})...`);
        const rawLlmOutput = await callGroqJson({
            apiKey: GROQ_API_KEY,
            model: GROQ_MODEL,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: buildUserPrompt(rawText),
        });

        const { profile, status, droppedFields } = validateEnrichedProfile(rawLlmOutput);
        if (droppedFields.length > 0) {
            log(`[profile-enrichment] WARNING: coerced invalid/out-of-range fields to null: ${droppedFields.join(', ')}`);
        }

        stage = 'persistence';
        const persistedProfile = await persistUserProfile({ resumeId, profile, status });
        log(`[profile-enrichment] Profile persisted: ${persistedProfile.id} (status=${status})`);
        emitResult({ resumeId, profileId: persistedProfile.id, status, profile, createdAt: persistedProfile.created_at });
    } catch (err) {
        if (stage === 'enrichment' && resumeId) {
            // The resume itself was already successfully captured and
            // stored (its raw text is preserved for a future retry) - a
            // Groq failure past this point must never be silently dropped
            // or reported as success, so it gets its own honest
            // user_profiles row using the 'failed' status this table's
            // CHECK constraint has always allowed (Task 7.1/migration 006)
            // but nothing had produced until now.
            try {
                const failedProfile = await persistUserProfile({ resumeId, profile: {}, status: 'failed' });
                log(`[profile-enrichment] Profile marked failed: ${failedProfile.id}`);
                emitResult({ error: true, stage, message: err.message, resumeId, profileId: failedProfile.id });
            } catch (persistErr) {
                log(`[profile-enrichment] Additionally could not record the failed profile: ${persistErr.message}`);
                emitResult({ error: true, stage, message: err.message, resumeId });
            }
        } else {
            log(`[profile-enrichment] FAILED at stage "${stage}": ${err.message}`);
            emitResult({ error: true, stage, message: err.message, resumeId });
        }
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

await main();
