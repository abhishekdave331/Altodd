// Task 6.7: metricDate bounds every count to jobs that actually existed in
// the system as of that date (first_seen_at < the day after metricDate).
// Proven defect this fixes: since `jobs` only ever grows and nothing here
// used to filter by date at all, re-running aggregation for a PAST date
// (e.g. `npm run aggregate -- 2026-09-07` after more jobs were ingested)
// silently overwrote that date's historical snapshot with figures computed
// from the CURRENT full jobs table - confirmed live (total_jobs for
// 2026-09-07 changed from a real 14 to 26 after a same-day re-run). For the
// normal "run once, for today" workflow this filter is a no-op (a job can't
// have first_seen_at in the future), so today's own aggregation is
// unaffected - it only changes the (previously broken) re-run-for-a-past-
// date case.
export async function getTotalJobCount(pool, metricDate) {
    const result = await pool.query(
        `SELECT COUNT(*)::int AS total FROM jobs WHERE first_seen_at < ($1::date + 1)`,
        [metricDate],
    );
    return result.rows[0].total;
}

export async function computeDailyMarketMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool, metricDate);

    const companies = await pool.query(
        `SELECT COUNT(DISTINCT company)::int AS unique_companies FROM jobs
         WHERE company IS NOT NULL AND first_seen_at < ($1::date + 1)`,
        [metricDate],
    );
    const applicants = await pool.query(
        `SELECT AVG(applicants) AS average_applicants FROM jobs
         WHERE applicants IS NOT NULL AND first_seen_at < ($1::date + 1)`,
        [metricDate],
    );

    const uniqueCompanies = companies.rows[0].unique_companies;
    const averageApplicants = applicants.rows[0].average_applicants;

    await pool.query(
        `INSERT INTO daily_market_metrics (metric_date, total_jobs, unique_companies, average_applicants)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (metric_date) DO UPDATE SET
           total_jobs=EXCLUDED.total_jobs, unique_companies=EXCLUDED.unique_companies,
           average_applicants=EXCLUDED.average_applicants`,
        [metricDate, totalJobs, uniqueCompanies, averageApplicants],
    );

    return { metricDate, totalJobs, uniqueCompanies, averageApplicants };
}
