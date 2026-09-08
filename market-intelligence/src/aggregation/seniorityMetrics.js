import { getTotalJobCount } from './dailyMetrics.js';

export async function computeDailySeniorityMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool);

    const result = await pool.query(`
        SELECT seniority, COUNT(*)::int AS job_count
        FROM job_roles
        WHERE seniority IS NOT NULL
        GROUP BY seniority
    `);

    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_seniority_metrics (metric_date, seniority, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (metric_date, seniority) DO UPDATE SET
               job_count=EXCLUDED.job_count, demand_percentage=EXCLUDED.demand_percentage`,
            [metricDate, row.seniority, row.job_count, demandPercentage],
        );
    }

    return { metricDate, seniorityLevelsProcessed: result.rows.length };
}
