// Task 7.6: thin HTTP boundary around the existing pipeline_runs table and
// the existing personalized-pipeline sequencer (scripts/run-personalized-
// pipeline.js) - no pipeline/scraper/LLM/taxonomy logic lives here, only
// input validation, calls into pipelineRunService, and handing off to
// pipelineExecutionService to spawn the real work.
import { Router } from 'express';
import { pool } from '../config/database.js';
import {
    createPipelineRun,
    getPipelineRunById,
    listPipelineRunsForProfile,
    getActivePipelineRunForProfile,
    userProfileExists,
} from '../services/pipelineRunService.js';
import { spawnPersonalizedPipeline } from '../services/pipelineExecutionService.js';

export const pipelineRoutes = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres error code for a unique_violation - the actual correctness
// backstop against two near-simultaneous POSTs for the same profile racing
// past the pre-check below (see migration 010's partial unique index).
const UNIQUE_VIOLATION = '23505';

function asyncHandler(fn) {
    return (req, res, next) => fn(req, res, next).catch(next);
}

pipelineRoutes.post('/', asyncHandler(async (req, res) => {
    const userProfileId = req.body?.user_profile_id;

    if (!userProfileId || typeof userProfileId !== 'string' || !UUID_RE.test(userProfileId)) {
        return res.status(400).json({ error: 'user_profile_id is required and must be a valid UUID.' });
    }

    const exists = await userProfileExists(pool, userProfileId);
    if (!exists) {
        return res.status(404).json({ error: `No user profile found with id "${userProfileId}".` });
    }

    const activeRun = await getActivePipelineRunForProfile(pool, userProfileId);
    if (activeRun) {
        return res.status(409).json({
            error: 'A pipeline run is already in progress for this profile.',
            pipeline_run: activeRun,
        });
    }

    let run;
    try {
        run = await createPipelineRun(pool, userProfileId);
    } catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
            // Lost the race against another request that inserted between
            // our pre-check and this insert - report it the same honest way
            // as the pre-check branch above, not as a generic 500.
            const raceWinner = await getActivePipelineRunForProfile(pool, userProfileId);
            return res.status(409).json({
                error: 'A pipeline run is already in progress for this profile.',
                pipeline_run: raceWinner,
            });
        }
        throw err;
    }

    spawnPersonalizedPipeline({ userProfileId, pipelineRunId: run.id });

    res.status(202).json({ pipeline_run: run });
}));

pipelineRoutes.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid pipeline run id format.' });
    }

    const run = await getPipelineRunById(pool, id);
    if (!run) {
        return res.status(404).json({ error: `No pipeline run found with id "${id}".` });
    }

    res.json({ pipeline_run: run });
}));

// Recent-runs listing for a profile - needed so a frontend can show pipeline
// history/status without already knowing a specific pipeline_runs id (the
// POST response only hands back the one it just created).
pipelineRoutes.get('/', asyncHandler(async (req, res) => {
    const userProfileId = req.query.user_profile_id;
    if (!userProfileId || typeof userProfileId !== 'string' || !UUID_RE.test(userProfileId)) {
        return res.status(400).json({ error: 'user_profile_id query parameter is required and must be a valid UUID.' });
    }

    const rawLimit = Number(req.query.limit ?? 20);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

    const runs = await listPipelineRunsForProfile(pool, userProfileId, limit);
    res.json({ pipeline_runs: runs });
}));
