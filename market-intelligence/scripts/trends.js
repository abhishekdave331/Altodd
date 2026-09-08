import { pool } from '../src/config/database.js';
import { todayISODate } from '../src/jobs/dailyPipeline.js';
import { getJobsTrend, getSkillTrend } from '../src/trends/trendCalculator.js';
import { detectEmergingSkills } from '../src/trends/emergingSkills.js';
import { computeMarketHealthScore } from '../src/trends/marketHealth.js';

const date = process.argv[2] ?? todayISODate();

const jobsTrend = {
    '1d': await getJobsTrend(pool, date, 1),
    '7d': await getJobsTrend(pool, date, 7),
    '30d': await getJobsTrend(pool, date, 30),
};

const topSkills = await pool.query(
    `SELECT sk.id, sk.name FROM daily_skill_metrics dsm
     JOIN skills sk ON sk.id = dsm.skill_id
     WHERE dsm.metric_date = $1
     ORDER BY dsm.demand_percentage DESC
     LIMIT 5`,
    [date],
);

const skillTrends = {};
for (const skill of topSkills.rows) {
    skillTrends[skill.name] = {
        '7d': await getSkillTrend(pool, skill.id, date, 7),
        '30d': await getSkillTrend(pool, skill.id, date, 30),
    };
}

const emergingSkills = await detectEmergingSkills(pool, { metricDate: date });
const marketHealth = await computeMarketHealthScore(pool, date);

console.log(JSON.stringify({ date, jobsTrend, skillTrends, emergingSkills, marketHealth }, null, 2));

await pool.end();
