import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/config/database.js';
import { ensureMigrationsTable, runMigrations } from '../src/database/migrationRunner.js';

const schemaPath = path.resolve(import.meta.dirname, '../src/database/schema.sql');
const migrationsDir = path.resolve(import.meta.dirname, '../src/database/migrations');

try {
    console.log('[DB] Applying baseline schema...');
    const schema = await readFile(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('[DB] Baseline schema ready.');

    await ensureMigrationsTable(pool);
    await runMigrations(pool, migrationsDir);

    console.log('[DB] Database setup complete.');
} catch (err) {
    console.error(`[DB] Setup failed: ${err.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
