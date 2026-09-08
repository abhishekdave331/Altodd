import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/config/database.js';

const schemaPath = path.resolve(import.meta.dirname, '../src/database/schema.sql');
const schema = await readFile(schemaPath, 'utf8');

await pool.query(schema);
console.log('Database schema created (or already up to date).');

await pool.end();
