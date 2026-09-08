import { getTotalJobCount } from './dailyMetrics.js';

export async function computeDailyCapabilityMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool);

    const result = await pool.query(`
        SELECT capability_id, COUNT(DISTINCT job_id)::int AS job_count
        FROM job_capabilities
        GROUP BY capability_id
    `);

    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_capability_metrics (metric_date, capability_id, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (metric_date, capability_id) DO UPDATE SET
               job_count=EXCLUDED.job_count, demand_percentage=EXCLUDED.demand_percentage`,
            [metricDate, row.capability_id, row.job_count, demandPercentage],
        );
    }

    return { metricDate, capabilitiesProcessed: result.rows.length };
}
