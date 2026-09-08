import path from 'node:path';
import { pool } from '../src/config/database.js';
import { ingestDirectory } from '../src/ingestion/ingestAnalysis.js';

const sourceDir = path.resolve(import.meta.dirname, '../../llm-pipeline/output');

const summary = await ingestDirectory(pool, sourceDir);
console.log(JSON.stringify(summary, null, 2));

await pool.end();
