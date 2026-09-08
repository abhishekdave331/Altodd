import { getJobsTrend, getSkillTrend, getRoleTrend } from '../trends/trendCalculator.js';
import { bucketStatus } from '../trends/marketHealth.js';
import { detectEmergingSkills } from '../trends/emergingSkills.js';

const RANGE_TO_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

async function getLatestDate(pool, table) {
    // metric_date comes back as a plain "YYYY-MM-DD" string (see the DATE
    // type-parser override in config/database.js) — no conversion needed.
    const result = await pool.query(`SELECT MAX(metric_date) AS d FROM ${table}`);
    return result.rows[0].d ?? null;
}

export async function getOverview(pool, requestedDate) {
    const date = requestedDate ?? (await getLatestDate(pool, 'daily_market_metrics'));

    if (!date) {
        return {
            date: null,
            market_health: { score: null, status: 'Insufficient historical data' },
            jobs: { total: 0, change_1d: null, change_7d: null, change_30d: null },
            companies: { unique: 0 },
            competition: { average_applicants: null },
        };
    }

    const rowResult = await pool.query(
        'SELECT total_jobs, unique_companies, average_applicants, market_health_score FROM daily_market_metrics WHERE metric_date = $1',
        [date],
    );
    const row = rowResult.rows[0] ?? { total_jobs: 0, unique_companies: 0, average_applicants: null, market_health_score: null };

    const [change1d, change7d, change30d] = await Promise.all([
        getJobsTrend(pool, date, 1),
        getJobsTrend(pool, date, 7),
        getJobsTrend(pool, date, 30),
    ]);

    const healthStatus = row.market_health_score != null
        ? bucketStatus(row.market_health_score)
        : 'Insufficient historical data';

    return {
        date,
        market_health: { score: row.market_health_score, status: healthStatus },
        jobs: {
            total: row.total_jobs,
            change_1d: change1d.available ? change1d.trend_percentage : null,
            change_7d: change7d.available ? change7d.trend_percentage : null,
            change_30d: change30d.available ? change30d.trend_percentage : null,
        },
        companies: { unique: row.unique_companies },
        competition: { average_applicants: row.average_applicants },
    };
}

export async function getSkills(pool, range) {
    const days = RANGE_TO_DAYS[range] ?? RANGE_TO_DAYS['30d'];
    const date = await getLatestDate(pool, 'daily_skill_metrics');
    if (!date) return { range: range ?? '30d', skills: [] };

    const result = await pool.query(
        `SELECT sk.id AS skill_id, sk.name, dsm.job_count, dsm.demand_percentage
         FROM daily_skill_metrics dsm
         JOIN skills sk ON sk.id = dsm.skill_id
         WHERE dsm.metric_date = $1
         ORDER BY dsm.demand_percentage DESC`,
        [date],
    );

    const skills = await Promise.all(result.rows.map(async (row) => {
        const [change7d, change30d] = await Promise.all([
            getSkillTrend(pool, row.skill_id, date, 7),
            getSkillTrend(pool, row.skill_id, date, days === 7 ? 7 : 30),
        ]);
        return {
            name: row.name,
            job_count: row.job_count,
            demand_percentage: row.demand_percentage,
            change_7d: change7d.available ? change7d.trend_percentage : null,
            change_30d: change30d.available ? change30d.trend_percentage : null,
        };
    }));

    return { range: range ?? '30d', skills };
}

export async function getEmergingSkills(pool) {
    const date = await getLatestDate(pool, 'daily_skill_metrics');
    if (!date) return [];
    return detectEmergingSkills(pool, { metricDate: date });
}

export async function getRoles(pool) {
    const date = await getLatestDate(pool, 'daily_role_metrics');
    if (!date) return [];

    const result = await pool.query(
        'SELECT role, job_count, demand_percentage FROM daily_role_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );

    return Promise.all(result.rows.map(async (row) => {
        const trend = await getRoleTrend(pool, row.role, date, 7);
        return {
            role: row.role,
            job_count: row.job_count,
            demand_percentage: row.demand_percentage,
            trend: trend.available ? trend.trend_percentage : null,
        };
    }));
}

export async function getCapabilities(pool) {
    const date = await getLatestDate(pool, 'daily_capability_metrics');
    if (!date) return [];

    const result = await pool.query(
        `SELECT c.name, dcm.job_count, dcm.demand_percentage
         FROM daily_capability_metrics dcm
         JOIN capabilities c ON c.id = dcm.capability_id
         WHERE dcm.metric_date = $1
         ORDER BY dcm.demand_percentage DESC`,
        [date],
    );
    return result.rows;
}

export async function getSeniority(pool) {
    const date = await getLatestDate(pool, 'daily_seniority_metrics');
    if (!date) return [];

    const result = await pool.query(
        'SELECT seniority, job_count, demand_percentage FROM daily_seniority_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );
    return result.rows;
}

export async function getLocations(pool) {
    const date = await getLatestDate(pool, 'daily_location_metrics');
    if (!date) return [];

    const result = await pool.query(
        'SELECT city, job_count, demand_percentage FROM daily_location_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );
    return result.rows;
}

export async function getIndustries(pool) {
    const date = await getLatestDate(pool, 'daily_industry_metrics');
    if (!date) return [];

    const result = await pool.query(
        'SELECT industry, job_count, demand_percentage FROM daily_industry_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );
    return result.rows;
}

export async function getJobsList(pool) {
    const result = await pool.query(`
        SELECT j.external_job_id, j.title, j.company, j.location, j.employment_type,
               j.applicants, j.posted_at, j.job_url, j.first_seen_at,
               jr.actual_role, jr.seniority
        FROM jobs j
        LEFT JOIN job_roles jr ON jr.job_id = j.id
        ORDER BY j.posted_at DESC NULLS LAST, j.first_seen_at DESC
    `);
    return result.rows;
}
