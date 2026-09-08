import pg from 'pg';

const { Pool } = pg;

// Independent Pool, same convention as profile-enrichment/market-intelligence
// - each top-level module stays self-contained with no cross-module imports.
export const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});
