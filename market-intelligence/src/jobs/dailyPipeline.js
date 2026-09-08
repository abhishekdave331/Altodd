import { ingestDirectory } from '../ingestion/ingestAnalysis.js';
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

export async function runAggregationOnly(pool, date = todayISODate()) {
    await computeDailyMarketMetrics(pool, date);
    await computeDailySkillMetrics(pool, date);
    await computeDailyRoleMetrics(pool, date);
    await computeDailyCapabilityMetrics(pool, date);
    await computeDailySeniorityMetrics(pool, date);
    await computeDailyLocationMetrics(pool, date);
    await computeDailyIndustryMetrics(pool, date);
    const health = await storeMarketHealthScore(pool, date);
    return { date, health };
}

export async function runDailyPipeline(pool, { date = todayISODate(), sourceDir }) {
    const ingestSummary = await ingestDirectory(pool, sourceDir);
    const aggregationResult = await runAggregationOnly(pool, date);
    return { date, ingestSummary, aggregationResult };
}
