import { getTotalJobCount } from './dailyMetrics.js';

// Task 6.8: pool is always the transaction client runAggregationOnly opens
// around all 7 aggregation calls (see dailyPipeline.js) - no internal
// transaction needed here anymore (an internal withTransaction() would open
// a separate connection via the singleton pool, not participate in the
// caller's transaction at all).
export async function computeDailySkillMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool, metricDate);

    // Task 6.7: joined to jobs and bounded by metricDate for the same
    // historical-preservation reason as getTotalJobCount - without this, a
    // re-run for a past date would count skills from jobs ingested after
    // that date too.
    const result = await pool.query(`
        SELECT js.skill_id,
               COUNT(DISTINCT js.job_id)::int AS job_count,
               COUNT(DISTINCT js.job_id) FILTER (WHERE js.priority='critical')::int  AS critical_count,
               COUNT(DISTINCT js.job_id) FILTER (WHERE js.priority='important')::int AS important_count,
               COUNT(DISTINCT js.job_id) FILTER (WHERE js.priority='preferred')::int AS preferred_count
        FROM job_skills js
        JOIN jobs j ON j.id = js.job_id
        WHERE j.first_seen_at < ($1::date + 1)
        GROUP BY js.skill_id
    `, [metricDate]);

    // Task 6.7: delete-then-insert (not per-row upsert) for this date - a
    // skill that no longer qualifies under this date's job set (e.g. after
    // the metricDate-bounding fix above, or a taxonomy merge) must not
    // linger as a stale row that ON CONFLICT DO UPDATE would never revisit,
    // since it simply wouldn't appear in `result.rows` again. Proven live:
    // re-running aggregation for 2026-09-07 after the metricDate filter was
    // added still left 85 stale skill rows (286 instead of the correct 201)
    // until this delete-then-insert fix was also applied.
    await pool.query('DELETE FROM daily_skill_metrics WHERE metric_date = $1', [metricDate]);
    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_skill_metrics
               (metric_date, skill_id, job_count, demand_percentage, critical_count, important_count, preferred_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [metricDate, row.skill_id, row.job_count, demandPercentage, row.critical_count, row.important_count, row.preferred_count],
        );
    }

    return { metricDate, skillsProcessed: result.rows.length };
}
