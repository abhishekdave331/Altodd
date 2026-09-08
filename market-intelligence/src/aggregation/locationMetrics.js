import { getTotalJobCount } from './dailyMetrics.js';

// Task 6.8: pool is always the transaction client runAggregationOnly opens
// around all 7 aggregation calls - no internal transaction here anymore
// (see skillMetrics.js's comment for why an internal withTransaction()
// wouldn't have participated in that outer one anyway).
export async function computeDailyLocationMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool, metricDate);

    // Task 6.7: bounded by metricDate - see dailyMetrics.js's
    // getTotalJobCount comment for the proven defect this prevents.
    const result = await pool.query(`
        SELECT city, COUNT(*)::int AS job_count
        FROM jobs
        WHERE city IS NOT NULL AND first_seen_at < ($1::date + 1)
        GROUP BY city
    `, [metricDate]);

    // Task 6.7: delete-then-insert (not per-row upsert) - see
    // skillMetrics.js's comment for the proven stale-row defect this fixes.
    await pool.query('DELETE FROM daily_location_metrics WHERE metric_date = $1', [metricDate]);
    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_location_metrics (metric_date, city, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)`,
            [metricDate, row.city, row.job_count, demandPercentage],
        );
    }

    return { metricDate, citiesProcessed: result.rows.length };
}
