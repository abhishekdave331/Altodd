import { getTotalJobCount } from './dailyMetrics.js';

// Task 6.8: pool is always the transaction client runAggregationOnly opens
// around all 7 aggregation calls - no internal transaction here anymore
// (see skillMetrics.js's comment for why an internal withTransaction()
// wouldn't have participated in that outer one anyway).
export async function computeDailySeniorityMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool, metricDate);

    // Task 6.7: joined to jobs and bounded by metricDate - see
    // dailyMetrics.js's getTotalJobCount comment for the proven defect this
    // prevents.
    const result = await pool.query(`
        SELECT jr.seniority, COUNT(*)::int AS job_count
        FROM job_roles jr
        JOIN jobs j ON j.id = jr.job_id
        WHERE jr.seniority IS NOT NULL AND j.first_seen_at < ($1::date + 1)
        GROUP BY jr.seniority
    `, [metricDate]);

    // Task 6.7: delete-then-insert (not per-row upsert) - see
    // skillMetrics.js's comment for the proven stale-row defect this fixes.
    await pool.query('DELETE FROM daily_seniority_metrics WHERE metric_date = $1', [metricDate]);
    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_seniority_metrics (metric_date, seniority, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)`,
            [metricDate, row.seniority, row.job_count, demandPercentage],
        );
    }

    return { metricDate, seniorityLevelsProcessed: result.rows.length };
}
