import { pool } from '../src/config/database.js';
import { callGroqJson } from '../src/llm/groqClient.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../src/searchConfig/searchQueryPrompt.js';
import { buildFiltersFromProfile } from '../src/searchConfig/buildFilters.js';
import { validateSearchQueries } from '../src/validation/validateSearchConfig.js';
import { persistSearchConfiguration } from '../src/ingestion/persistSearchConfig.js';

// Task 7.8: human progress goes to stderr, and exactly ONE line of machine-
// readable JSON goes to stdout at the very end - same convention already
// established for processResume.js/runOrchestration.js/main-from-datasets.js,
// so market-intelligence's new search-configuration API can invoke this
// script as a child process and reliably parse its result.
function log(message) {
    console.error(message);
}

function emitResult(result) {
    console.log(JSON.stringify(result));
}

const [, , userProfileId] = process.argv;
if (!userProfileId) {
    log('Usage: npm run generate-search-config -- <user_profiles.id>');
    process.exitCode = 1;
    process.exit();
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';

async function main() {
    // Tracks which stage failed so a caller (the CLI's own exit code, or the
    // HTTP API parsing this script's final JSON line) can tell "no such
    // profile" apart from "our infrastructure had a problem" rather than one
    // generic failure.
    let stage = 'lookup';
    let filters = null;

    try {
        const profileRow = await pool.query('SELECT id, enriched_profile FROM user_profiles WHERE id = $1', [userProfileId]);
        if (profileRow.rows.length === 0) {
            throw new Error(`No user_profiles row found with id "${userProfileId}".`);
        }
        const enrichedProfile = profileRow.rows[0].enriched_profile;

        log('[search-config] Building deterministic filters...');
        filters = buildFiltersFromProfile(enrichedProfile);
        log(`[search-config] Filters: ${JSON.stringify(filters)}`);

        stage = 'generation';
        log(`[search-config] Generating search queries via Groq (${GROQ_MODEL})...`);
        const rawLlmOutput = await callGroqJson({
            apiKey: GROQ_API_KEY,
            model: GROQ_MODEL,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: buildUserPrompt(enrichedProfile),
        });

        const { queries, status, droppedFields } = validateSearchQueries(rawLlmOutput);
        if (droppedFields.length > 0) {
            log(`[search-config] WARNING: coerced invalid fields: ${droppedFields.join(', ')}`);
        }

        stage = 'persistence';
        const config = await persistSearchConfiguration({ userProfileId, queries, filters, status });
        log(`[search-config] Search configuration persisted: ${config.id} (status=${status})`);
        emitResult(config);
    } catch (err) {
        if (stage === 'generation') {
            // The deterministic filters were already computed successfully
            // above (no Groq involved) - a Groq failure past this point must
            // never be silently dropped or reported as success, so it gets
            // its own honest search_configurations row using the 'failed'
            // status this table's CHECK constraint has always allowed (Task
            // 7.2/migration 007) and that loadSearchConfig.js already knows
            // to skip (WHERE generation_status != 'failed') - nothing had
            // actually produced a 'failed' row until now.
            try {
                const emptyQueries = { primary_queries: [], secondary_queries: [], keywords: [] };
                const failedConfig = await persistSearchConfiguration({
                    userProfileId,
                    queries: emptyQueries,
                    filters,
                    status: 'failed',
                });
                log(`[search-config] Configuration marked failed: ${failedConfig.id}`);
                emitResult({ error: true, stage, message: err.message, id: failedConfig.id });
            } catch (persistErr) {
                log(`[search-config] Additionally could not record the failed configuration: ${persistErr.message}`);
                emitResult({ error: true, stage, message: err.message });
            }
        } else {
            log(`[search-config] FAILED at stage "${stage}": ${err.message}`);
            emitResult({ error: true, stage, message: err.message });
        }
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

await main();
