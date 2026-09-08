export async function getTotalJobCount(pool) {
    const result = await pool.query('SELECT COUNT(*)::int AS total FROM jobs');
    return result.rows[0].total;
}

export async function computeDailyMarketMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool);

    const companies = await pool.query(
        'SELECT COUNT(DISTINCT company)::int AS unique_companies FROM jobs WHERE company IS NOT NULL',
    );
    const applicants = await pool.query(
        'SELECT AVG(applicants) AS average_applicants FROM jobs WHERE applicants IS NOT NULL',
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
