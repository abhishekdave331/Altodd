/**
 * Multiple-query strategy (Task 7.3):
 *
 * - At most 2 actor runs per orchestration cycle: one "primary" (Task 7.2's
 *   primary_queries) and one "secondary" (Task 7.2's secondary_queries) -
 *   never one uncontrolled run combining every query, and never an unbounded
 *   number of runs.
 * - Secondary queries that duplicate a primary query (case-insensitive,
 *   trimmed) are dropped before planning a run, to avoid unnecessary
 *   duplicate searches.
 * - No secondary run is planned at all if nothing is left after dedup, or if
 *   secondary_queries was empty to begin with.
 * - No primary run is planned if primary_queries is empty (a genuinely
 *   low-signal profile) - an empty query list must never become a run with
 *   an empty/garbage `keywords` string.
 * - Execution ORDER matters beyond planning: the existing llm-pipeline
 *   ingestion path (fetchLatestJobs) reads "the actor's last run" - to keep
 *   that already-working, unmodified integration point pointing at the more
 *   relevant result set when both runs happen, this function returns the
 *   secondary run (if any) BEFORE the primary run, so callers that execute
 *   runs in the returned order naturally trigger primary last.
 *
 * @param {{primary_queries: string[], secondary_queries: string[]}} queries
 * @returns {Array<{queryType: 'primary'|'secondary', queries: string[]}>}
 */
export function planRuns({ primary_queries, secondary_queries }) {
    const primary = Array.isArray(primary_queries) ? primary_queries : [];
    const secondary = Array.isArray(secondary_queries) ? secondary_queries : [];

    const primaryKeys = new Set(primary.map((q) => q.toLowerCase().trim()));
    const dedupedSecondary = secondary.filter((q) => !primaryKeys.has(q.toLowerCase().trim()));

    const runs = [];
    if (dedupedSecondary.length > 0) {
        runs.push({ queryType: 'secondary', queries: dedupedSecondary });
    }
    if (primary.length > 0) {
        runs.push({ queryType: 'primary', queries: primary });
    }
    return runs;
}
