// Task 7.5: tiny CLI utility for scripts/run-personalized-pipeline.js (the
// root cross-module sequencer) to create/update pipeline_runs rows, using
// market-intelligence's existing pool/config - matching this project's
// established "small CLI script wrapping one concern" pattern (ingest.js,
// aggregate.js, runDaily.js). Lives here (not at the project root) because
// market-intelligence already owns every migration touching this shared
// database, regardless of which module's application code performs the
// writes (see migrations 006-009).
//
// Task 7.6: the actual INSERT/UPDATE logic now lives in
// src/services/pipelineRunService.js so the new HTTP API (which creates the
// initial row itself, before spawning this pipeline) and this CLI share one
// implementation instead of two copies of the same SQL. This file is now
// just the argv-parsing/output-formatting shell around that service.
import { pool } from '../src/config/database.js';
import { createPipelineRun, updatePipelineRun } from '../src/services/pipelineRunService.js';

function parseFlags(args) {
    const flags = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace(/^--/, '');
        if (!key) continue;
        flags[key] = args[i + 1];
    }
    return flags;
}

const [, , command, ...rest] = process.argv;

try {
    if (command === 'create') {
        const [userProfileId] = rest;
        if (!userProfileId) throw new Error('Usage: create <userProfileId>');
        const run = await createPipelineRun(pool, userProfileId);
        console.log(JSON.stringify({ id: run.id }));
    } else if (command === 'update') {
        const [pipelineRunId, ...flagArgs] = rest;
        if (!pipelineRunId) throw new Error('Usage: update <pipelineRunId> --status <status> [--search-configuration-id <id>] [--jobs-scraped <n>] [--jobs-analyzed <n>] [--jobs-processed-successfully <n>] [--error-message <msg>] [--completed true]');
        const flags = parseFlags(flagArgs);

        await updatePipelineRun(pool, pipelineRunId, {
            status: flags.status,
            searchConfigurationId: flags['search-configuration-id'],
            jobsScraped: flags['jobs-scraped'],
            jobsAnalyzed: flags['jobs-analyzed'],
            jobsProcessedSuccessfully: flags['jobs-processed-successfully'],
            errorMessage: flags['error-message'],
            completed: flags.completed === 'true',
        });
        console.log(JSON.stringify({ id: pipelineRunId, updated: true }));
    } else {
        throw new Error(`Unknown command "${command}". Use "create" or "update".`);
    }
} finally {
    await pool.end();
}
