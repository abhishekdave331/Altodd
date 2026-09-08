import pg from 'pg';

const { Pool, types } = pg;

// NUMERIC (OID 1700) comes back from node-postgres as a string by default.
// Every trend/aggregation calculation in this app does arithmetic on NUMERIC
// columns (demand_percentage, average_applicants, market_health_score,
// experience years) — without this, that arithmetic silently becomes string
// concatenation instead of math.
types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)));

// DATE (OID 1082) defaults to a JS Date constructed in local time. Every
// metric_date in this app is compared/formatted as a plain "YYYY-MM-DD"
// string (see todayISODate()); letting pg hand back Date objects causes
// silent off-by-one-day bugs the moment the local timezone isn't UTC
// (toISOString() re-renders a local-midnight Date in UTC, shifting it back
// a day east of Greenwich). Keep it as the raw string everywhere instead.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

export async function query(text, params) {
    return pool.query(text, params);
}

export async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
