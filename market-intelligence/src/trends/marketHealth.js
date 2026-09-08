import { getJobsTrend, rescaleTrendPct } from './trendCalculator.js';
import { ENTRY_MID_SENIORITY_LABELS } from '../ingestion/normalizeRoles.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function minMaxNormalize(value, series) {
    const nums = series.filter((v) => v != null).map(Number);
    if (nums.length === 0 || value == null) return 50;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (max === min) return 50;
    return ((value - min) / (max - min)) * 100;
}

export function bucketStatus(score) {
    if (score >= 70) return 'Strong';
    if (score >= 40) return 'Moderate';
    return 'Weak';
}

export async function computeMarketHealthScore(pool, metricDate) {
    const historyCount = await pool.query(
        'SELECT COUNT(*)::int AS n FROM daily_market_metrics WHERE metric_date <= $1',
        [metricDate],
    );
    if (historyCount.rows[0].n < 7) {
        return { score: null, status: 'Insufficient historical data' };
    }

    const todayResult = await pool.query(
        'SELECT total_jobs, unique_companies, average_applicants FROM daily_market_metrics WHERE metric_date = $1',
        [metricDate],
    );
    if (todayResult.rows.length === 0) {
        return { score: null, status: 'Insufficient historical data' };
    }
    const today = todayResult.rows[0];

    const historySeries = await pool.query(
        'SELECT total_jobs, unique_companies FROM daily_market_metrics WHERE metric_date <= $1',
        [metricDate],
    );

    const jobVolumeScore = minMaxNormalize(today.total_jobs, historySeries.rows.map((r) => r.total_jobs));
    const uniqueCompaniesScore = minMaxNormalize(today.unique_companies, historySeries.rows.map((r) => r.unique_companies));

    const hiringGrowth = await getJobsTrend(pool, metricDate, 7);
    const hiringGrowthScore = hiringGrowth.available ? rescaleTrendPct(hiringGrowth.trend_percentage) : 50;

    const avgApplicantsSeries = await pool.query(
        'SELECT average_applicants FROM daily_market_metrics WHERE metric_date <= $1 AND average_applicants IS NOT NULL',
        [metricDate],
    );
    const competitionOpportunityScore = today.average_applicants != null
        ? 100 - minMaxNormalize(today.average_applicants, avgApplicantsSeries.rows.map((r) => r.average_applicants))
        : 50;

    const roleDiversitySeries = await pool.query(
        'SELECT metric_date, COUNT(*)::int AS n FROM daily_role_metrics WHERE metric_date <= $1 GROUP BY metric_date',
        [metricDate],
    );
    const todayDiversityRow = roleDiversitySeries.rows.find((r) => r.metric_date === metricDate);
    const todayRoleDiversity = todayDiversityRow ? todayDiversityRow.n : 0;
    const roleDiversityScore = minMaxNormalize(todayRoleDiversity, roleDiversitySeries.rows.map((r) => r.n));

    const accessibleResult = await pool.query(
        `SELECT
           (COUNT(*) FILTER (WHERE seniority = ANY($1)))::numeric
           / NULLIF(COUNT(*), 0) * 100 AS accessible_pct
         FROM job_roles
         WHERE seniority IS NOT NULL`,
        [ENTRY_MID_SENIORITY_LABELS],
    );
    const accessiblePct = accessibleResult.rows[0].accessible_pct;
    const entryMidAccessibilityScore = clamp(accessiblePct ?? 50, 0, 100);

    const score = Math.round(
        (0.30 * jobVolumeScore
            + 0.20 * hiringGrowthScore
            + 0.15 * uniqueCompaniesScore
            + 0.15 * competitionOpportunityScore
            + 0.10 * roleDiversityScore
            + 0.10 * entryMidAccessibilityScore) * 100,
    ) / 100;

    return { score, status: bucketStatus(score) };
}

export async function storeMarketHealthScore(pool, metricDate) {
    const { score, status } = await computeMarketHealthScore(pool, metricDate);
    if (score != null) {
        await pool.query(
            'UPDATE daily_market_metrics SET market_health_score = $1 WHERE metric_date = $2',
            [score, metricDate],
        );
    }
    return { score, status };
}
