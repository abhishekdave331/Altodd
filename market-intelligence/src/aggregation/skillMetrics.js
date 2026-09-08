import { getTotalJobCount } from './dailyMetrics.js';

export async function computeDailySkillMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool);

    const result = await pool.query(`
        SELECT js.skill_id,
               COUNT(DISTINCT js.job_id)::int AS job_count,
               COUNT(DISTINCT js.job_id) FILTER (WHERE js.priority='critical')::int  AS critical_count,
               COUNT(DISTINCT js.job_id) FILTER (WHERE js.priority='important')::int AS important_count,
               COUNT(DISTINCT js.job_id) FILTER (WHERE js.priority='preferred')::int AS preferred_count
        FROM job_skills js
        GROUP BY js.skill_id
    `);

    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_skill_metrics
               (metric_date, skill_id, job_count, demand_percentage, critical_count, important_count, preferred_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (metric_date, skill_id) DO UPDATE SET
               job_count=EXCLUDED.job_count, demand_percentage=EXCLUDED.demand_percentage,
               critical_count=EXCLUDED.critical_count, important_count=EXCLUDED.important_count,
               preferred_count=EXCLUDED.preferred_count`,
            [metricDate, row.skill_id, row.job_count, demandPercentage, row.critical_count, row.important_count, row.preferred_count],
        );
    }

    return { metricDate, skillsProcessed: result.rows.length };
}
