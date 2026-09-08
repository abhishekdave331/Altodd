import pg from 'pg';

const { Pool } = pg;

// This module and market-intelligence both connect to the same altodd_market
// database, but each keeps its own independent Pool/config rather than
// importing across module boundaries - the two are meant to stay separately
// deployable, matching how llm-pipeline/market-intelligence already never
// import each other's code (see market-intelligence/src/config/database.js
// for the sibling copy of this same small setup).
export const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});
