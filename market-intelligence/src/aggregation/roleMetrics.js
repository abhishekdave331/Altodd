import { getTotalJobCount } from './dailyMetrics.js';

export async function computeDailyRoleMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool);

    const result = await pool.query(`
        SELECT actual_role AS role, COUNT(*)::int AS job_count
        FROM job_roles
        WHERE actual_role IS NOT NULL
        GROUP BY actual_role
    `);

    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_role_metrics (metric_date, role, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (metric_date, role) DO UPDATE SET
               job_count=EXCLUDED.job_count, demand_percentage=EXCLUDED.demand_percentage`,
            [metricDate, row.role, row.job_count, demandPercentage],
        );
    }

    return { metricDate, rolesProcessed: result.rows.length };
}
