import { ingestDirectory } from '../ingestion/ingestAnalysis.js';
import { withTransaction } from '../config/database.js';
import { computeDailyMarketMetrics } from '../aggregation/dailyMetrics.js';
import { computeDailySkillMetrics } from '../aggregation/skillMetrics.js';
import { computeDailyRoleMetrics } from '../aggregation/roleMetrics.js';
import { computeDailyCapabilityMetrics } from '../aggregation/capabilityMetrics.js';
import { computeDailySeniorityMetrics } from '../aggregation/seniorityMetrics.js';
import { computeDailyLocationMetrics } from '../aggregation/locationMetrics.js';
import { computeDailyIndustryMetrics } from '../aggregation/industryMetrics.js';
import { storeMarketHealthScore } from '../trends/marketHealth.js';

export function todayISODate() {
    return new Date().toISOString().slice(0, 10);
}

// Task 6.8: all 7 metric tables for one date are now computed inside a
// SINGLE transaction, making the whole snapshot atomic - either every table
// ends up with a fully up-to-date row for `date`, or (if any stage throws)
// none of them are updated at all, leaving the previous state for that date
// untouched rather than a half-updated mix.
//
// Proven defect this fixes: previously these 7 calls ran as bare sequential
// awaits with no enclosing transaction or try/catch. A controlled isolated
// test confirmed that if e.g. computeDailyRoleMetrics threw (a real,
// reachable code path - its own integrity check on a data-consistency
// violation), daily_market_metrics/daily_skill_metrics for that date had
// ALREADY committed and stayed committed, while daily_role_metrics and
// every stage after it silently had no row for that date at all. Since
// every dashboard endpoint independently picks its own table's
// MAX(metric_date) (see dashboardService.js), that partial state could
// silently surface as different dashboard endpoints reporting different
// "latest" dates with no indication anything was wrong.
//
// The 6 aggregation modules that used their own internal withTransaction()
// call (Task 6.7's delete-then-insert fix) now just use the `client` passed
// in here directly - withTransaction() opens its own separate connection/
// transaction via the singleton pool, which would NOT have been part of
// this outer transaction, so nesting it here would not have helped.
export async function runAggregationOnly(pool, date = todayISODate()) {
    await withTransaction(async (client) => {
        await computeDailyMarketMetrics(client, date);
        await computeDailySkillMetrics(client, date);
        await computeDailyRoleMetrics(client, date);
        await computeDailyCapabilityMetrics(client, date);
        await computeDailySeniorityMetrics(client, date);
        await computeDailyLocationMetrics(client, date);
        await computeDailyIndustryMetrics(client, date);
    });
    // Reads the now-fully-committed snapshot via the real pool - kept
    // outside the transaction above since it only reads already-durable
    // data and writes a derived score, not a peer of the 7 raw aggregations.
    const health = await storeMarketHealthScore(pool, date);
    return { date, health };
}

export async function runDailyPipeline(pool, { date = todayISODate(), sourceDir }) {
    const ingestSummary = await ingestDirectory(pool, sourceDir);
    const aggregationResult = await runAggregationOnly(pool, date);
    return { date, ingestSummary, aggregationResult };
}
