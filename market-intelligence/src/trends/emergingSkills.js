import { getSkillTrend, rescaleTrendPct } from './trendCalculator.js';

function average(values) {
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function daysBefore(metricDate, days) {
    const d = new Date(`${metricDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

export async function detectEmergingSkills(pool, { metricDate, minJobs = 5, minDemandShare = 2, historyWindowDays = 14 }) {
    const candidates = await pool.query(
        `SELECT sk.id AS skill_id, sk.name, dsm.job_count, dsm.demand_percentage
         FROM daily_skill_metrics dsm
         JOIN skills sk ON sk.id = dsm.skill_id
         WHERE dsm.metric_date = $1 AND dsm.job_count >= $2 AND dsm.demand_percentage >= $3`,
        [metricDate, minJobs, minDemandShare],
    );

    const results = [];
    const fetchWindow = Math.max(historyWindowDays, 30);

    for (const candidate of candidates.rows) {
        const historyResult = await pool.query(
            `SELECT metric_date, demand_percentage, job_count
             FROM daily_skill_metrics
             WHERE skill_id = $1 AND metric_date <= $2 AND metric_date > $3
             ORDER BY metric_date`,
            [candidate.skill_id, metricDate, daysBefore(metricDate, fetchWindow)],
        );

        const recentHistory = historyResult.rows.filter((r) => r.metric_date >= daysBefore(metricDate, historyWindowDays));
        if (recentHistory.length < 7) {
            results.push({
                skill: candidate.name,
                available: false,
                reason: 'Insufficient historical data',
            });
            continue;
        }

        const sevenDayCutoff = daysBefore(metricDate, 7);
        const thirtyDayCutoff = daysBefore(metricDate, 30);
        const last7 = historyResult.rows.filter((r) => r.metric_date >= sevenDayCutoff).map((r) => r.demand_percentage);
        const last30 = historyResult.rows.filter((r) => r.metric_date >= thirtyDayCutoff).map((r) => r.demand_percentage);

        const avg7 = average(last7);
        const avg30 = average(last30);
        const today = candidate.demand_percentage;

        const growthTrend = await getSkillTrend(pool, candidate.skill_id, metricDate, 7);
        const growth30Trend = await getSkillTrend(pool, candidate.skill_id, metricDate, 30);
        const growth7d = growthTrend.available ? growthTrend.trend_percentage : null;
        const growth30d = growth30Trend.available ? growth30Trend.trend_percentage : null;

        // Must have positive growth to qualify as "emerging" — a skill that
        // isn't growing is excluded from the list entirely, not shown as
        // unavailable (this is a qualification filter, not a data gap).
        if (growth7d == null || growth7d <= 0) continue;

        const growthScore = avg30 > 0 ? rescaleTrendPct(((avg7 - avg30) / avg30) * 100) : 50;
        const accelerationScore = avg7 > 0 ? rescaleTrendPct(((today - avg7) / avg7) * 100) : 50;
        const currentDemandScore = clamp(today * 5, 0, 100);
        const daysAppeared = recentHistory.filter((r) => r.job_count > 0).length;
        const consistencyScore = (daysAppeared / historyWindowDays) * 100;

        const emergingScore = Math.round(
            (0.4 * growthScore + 0.3 * accelerationScore + 0.2 * currentDemandScore + 0.1 * consistencyScore) * 100,
        ) / 100;

        results.push({
            skill: candidate.name,
            job_count: candidate.job_count,
            demand_percentage: today,
            growth_7d: growth7d,
            growth_30d: growth30d,
            emerging_score: emergingScore,
            available: true,
        });
    }

    return results.sort((a, b) => (b.emerging_score ?? -1) - (a.emerging_score ?? -1));
}
