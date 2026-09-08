import path from 'node:path';
import { pool } from '../src/config/database.js';
import { runDailyPipeline, todayISODate } from '../src/jobs/dailyPipeline.js';

const sourceDir = path.resolve(import.meta.dirname, '../../llm-pipeline/output');
const date = process.argv[2] ?? todayISODate();

const result = await runDailyPipeline(pool, { date, sourceDir });
console.log(JSON.stringify(result, null, 2));

await pool.end();
