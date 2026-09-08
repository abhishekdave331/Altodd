import { getTotalJobCount } from './dailyMetrics.js';

export async function computeDailyLocationMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool);

    const result = await pool.query(`
        SELECT city, COUNT(*)::int AS job_count
        FROM jobs
        WHERE city IS NOT NULL
        GROUP BY city
    `);

    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_location_metrics (metric_date, city, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (metric_date, city) DO UPDATE SET
               job_count=EXCLUDED.job_count, demand_percentage=EXCLUDED.demand_percentage`,
            [metricDate, row.city, row.job_count, demandPercentage],
        );
    }

    return { metricDate, citiesProcessed: result.rows.length };
}
