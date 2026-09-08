import { getTotalJobCount } from './dailyMetrics.js';

export async function computeDailyIndustryMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool);

    const result = await pool.query(`
        SELECT industry, COUNT(*)::int AS job_count
        FROM jobs
        WHERE industry IS NOT NULL
        GROUP BY industry
    `);

    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_industry_metrics (metric_date, industry, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (metric_date, industry) DO UPDATE SET
               job_count=EXCLUDED.job_count, demand_percentage=EXCLUDED.demand_percentage`,
            [metricDate, row.industry, row.job_count, demandPercentage],
        );
    }

    return { metricDate, industriesProcessed: result.rows.length };
}
