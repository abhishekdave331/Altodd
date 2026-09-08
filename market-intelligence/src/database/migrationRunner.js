import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureMigrationsTable(pool) {
    const sqlPath = path.resolve(import.meta.dirname, 'schema_migrations.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await pool.query(sql);
}

async function getAppliedMigrations(pool) {
    const result = await pool.query('SELECT filename FROM schema_migrations');
    return new Set(result.rows.map((row) => row.filename));
}

// Missing directory is treated as "no migrations yet" rather than an error -
// this repo already ships the directory, so this is only a defensive fallback,
// not a reason to build directory-creation logic around it.
async function discoverMigrationFiles(migrationsDir) {
    let entries;
    try {
        entries = await readdir(migrationsDir);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    return entries.filter((name) => name.endsWith('.sql')).sort();
}

async function applyMigration(pool, migrationsDir, filename) {
    const filePath = path.join(migrationsDir, filename);
    let sql;
    try {
        sql = await readFile(filePath, 'utf8');
    } catch (err) {
        throw new Error(`Could not read migration file "${filename}": ${err.message}`);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration "${filename}" failed and was rolled back: ${err.message}`);
    } finally {
        client.release();
    }
}

// Applies pending .sql files from migrationsDir in filename-sorted order.
// Stops immediately on the first failure - earlier, already-committed
// migrations in this run are NOT rolled back; each migration is its own
// independent transaction, by design.
export async function runMigrations(pool, migrationsDir) {
    console.log('[DB] Checking migrations...');

    const files = await discoverMigrationFiles(migrationsDir);
    if (files.length === 0) {
        console.log('[DB] No migration files found.');
        return;
    }

    const applied = await getAppliedMigrations(pool);

    for (const filename of files) {
        if (applied.has(filename)) {
            console.log(`[DB] Skipping applied migration: ${filename}`);
            continue;
        }

        console.log(`[DB] Applying migration: ${filename}`);
        await applyMigration(pool, migrationsDir, filename);
        console.log(`[DB] Migration applied: ${filename}`);
    }
}
