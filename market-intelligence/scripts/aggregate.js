import { pool } from '../src/config/database.js';
import { runAggregationOnly, todayISODate } from '../src/jobs/dailyPipeline.js';

const date = process.argv[2] ?? todayISODate();

const result = await runAggregationOnly(pool, date);
console.log(JSON.stringify(result, null, 2));

await pool.end();
