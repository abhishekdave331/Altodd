// Plain fetch() against Apify's REST API v2, matching the existing pattern
// already used in llm-pipeline/src/apify-client.js - no new SDK dependency
// added for this.
const API_BASE = 'https://api.apify.com/v2';

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

async function apifyFetch(url, options) {
    const response = await fetch(url, options);
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Apify API request failed (${response.status}): ${bodyText.slice(0, 2000)}`);
    }
    return JSON.parse(bodyText).data;
}

/**
 * Starts a new run of the given actor with the supplied input. Does not
 * wait for completion - see pollRunUntilFinished().
 */
export async function startActorRun({ token, actorId, input }) {
    return apifyFetch(`${API_BASE}/acts/${actorId}/runs?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
    });
}

export async function getRunStatus({ token, runId }) {
    return apifyFetch(`${API_BASE}/actor-runs/${runId}?token=${token}`);
}

export async function getDatasetInfo({ token, datasetId }) {
    return apifyFetch(`${API_BASE}/datasets/${datasetId}?token=${token}`);
}

/**
 * Polls a run until it reaches a terminal state or the timeout elapses.
 * Never throws on a failed/aborted/timed-out run - that is a normal,
 * expected outcome the caller must handle explicitly (see
 * runOrchestration.js), not an exceptional one. Only throws if polling
 * itself cannot determine an outcome within maxWaitMs (network issue or a
 * run that's still active after the deadline).
 *
 * @returns {Promise<object>} the final run object (status, defaultDatasetId, stats, ...)
 */
export async function pollRunUntilFinished({ token, runId, maxWaitMs = 10 * 60 * 1000, pollIntervalMs = 5000 }) {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
        const run = await getRunStatus({ token, runId });
        if (TERMINAL_STATUSES.has(run.status)) {
            return run;
        }
        if (Date.now() >= deadline) {
            throw new Error(`Run ${runId} did not reach a terminal state within ${maxWaitMs}ms (last status: ${run.status}).`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}
