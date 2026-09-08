import { getJobsTrend, getSkillTrend, getRoleTrend } from '../trends/trendCalculator.js';
import { bucketStatus } from '../trends/marketHealth.js';
import { detectEmergingSkills } from '../trends/emergingSkills.js';

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
            jobs: { total: null, change_1d: null, change_7d: null, change_30d: null },
            companies: { unique: null },
            competition: { average_applicants: null },
        };
    }

    const rowResult = await pool.query(
        'SELECT total_jobs, unique_companies, average_applicants, market_health_score FROM daily_market_metrics WHERE metric_date = $1',
        [date],
    );
    // No hardcoded 0 fallback here (matching average_applicants/market_health_score
    // below) - a genuinely computed 0 must stay distinguishable from "no row for
    // this date exists at all." StatTile/MarketHealthTile already render null as
    // "-", so null is the correct "no data" signal, not a fabricated zero.
    const row = rowResult.rows[0] ?? { total_jobs: null, unique_companies: null, average_applicants: null, market_health_score: null };

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

    // Task 6.6 fix: change_30d must always reflect an actual 30-day window.
    // Previously this used `days === 7 ? 7 : 30` (days derived from the
    // `range` query param) - passing ?range=7d silently made change_30d
    // compute the SAME 7-day window as change_7d, contradicting its own
    // field name. `range` has no other effect on this endpoint's data (the
    // skill list itself is never scoped by it, only echoed back in the
    // response) - it does not warrant a real 90-day trend calculation
    // either, so range's only remaining role here is the response's own
    // `range` label, unchanged from before.
    const skills = await Promise.all(result.rows.map(async (row) => {
        const [change7d, change30d] = await Promise.all([
            getSkillTrend(pool, row.skill_id, date, 7),
            getSkillTrend(pool, row.skill_id, date, 30),
        ]);
        return {
            name: row.name,
            job_count: row.job_count,
            demand_percentage: row.demand_percentage,
            change_7d: change7d.available ? change7d.trend_percentage : null,
            change_30d: change30d.available ? change30d.trend_percentage : null,
        };
    }));

    return { date, range: range ?? '30d', skills };
}

// Task 6.8: every endpoint below now returns its own `date` alongside its
// data. Investigation found that each endpoint independently picks its own
// table's MAX(metric_date) with no cross-check against the others (see
// getLatestDate calls throughout this file) - if aggregation ever partially
// fails for a date (see dailyPipeline.js's now-atomic runAggregationOnly,
// Task 6.8), a caller comparing two endpoints' `date` fields can now detect
// a mismatch instead of silently receiving mixed-snapshot intelligence with
// no way to tell. This does not change what date each endpoint selects
// (still its own table's latest, preserving existing "show me your freshest
// data" semantics) - it only makes that choice visible.
export async function getEmergingSkills(pool) {
    const date = await getLatestDate(pool, 'daily_skill_metrics');
    if (!date) return { date: null, skills: [] };
    const skills = await detectEmergingSkills(pool, { metricDate: date });
    return { date, skills };
}

export async function getRoles(pool) {
    const date = await getLatestDate(pool, 'daily_role_metrics');
    if (!date) return { date: null, roles: [] };

    const result = await pool.query(
        'SELECT role, job_count, demand_percentage FROM daily_role_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );

    const roles = await Promise.all(result.rows.map(async (row) => {
        const trend = await getRoleTrend(pool, row.role, date, 7);
        return {
            role: row.role,
            job_count: row.job_count,
            demand_percentage: row.demand_percentage,
            trend: trend.available ? trend.trend_percentage : null,
        };
    }));
    return { date, roles };
}

export async function getCapabilities(pool) {
    const date = await getLatestDate(pool, 'daily_capability_metrics');
    if (!date) return { date: null, capabilities: [] };

    const result = await pool.query(
        `SELECT c.name, dcm.job_count, dcm.demand_percentage
         FROM daily_capability_metrics dcm
         JOIN capabilities c ON c.id = dcm.capability_id
         WHERE dcm.metric_date = $1
         ORDER BY dcm.demand_percentage DESC`,
        [date],
    );
    return { date, capabilities: result.rows };
}

export async function getSeniority(pool) {
    const date = await getLatestDate(pool, 'daily_seniority_metrics');
    if (!date) return { date: null, seniority: [] };

    const result = await pool.query(
        'SELECT seniority, job_count, demand_percentage FROM daily_seniority_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );
    return { date, seniority: result.rows };
}

export async function getLocations(pool) {
    const date = await getLatestDate(pool, 'daily_location_metrics');
    if (!date) return { date: null, locations: [] };

    const result = await pool.query(
        'SELECT city, job_count, demand_percentage FROM daily_location_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );
    return { date, locations: result.rows };
}

export async function getIndustries(pool) {
    const date = await getLatestDate(pool, 'daily_industry_metrics');
    if (!date) return { date: null, industries: [] };

    const result = await pool.query(
        'SELECT industry, job_count, demand_percentage FROM daily_industry_metrics WHERE metric_date = $1 ORDER BY demand_percentage DESC',
        [date],
    );
    return { date, industries: result.rows };
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
