const INSUFFICIENT_DATA = { available: false, reason: 'Insufficient historical data' };

// Generic trend core: (current - previousPeriodAverage) / previousPeriodAverage * 100.
// Requires a FULL prior window of history before computing anything — on day 1
// this always returns "insufficient data" rather than fabricating a number.
export async function computeTrend(pool, { tableName, valueColumn, dateColumn = 'metric_date', dimensionColumn, dimensionValue, metricDate, windowDays }) {
    const dimensionClause = dimensionColumn ? `AND ${dimensionColumn} = $2` : '';
    const currentParams = dimensionColumn ? [metricDate, dimensionValue] : [metricDate];

    const currentResult = await pool.query(
        `SELECT ${valueColumn} AS value FROM ${tableName} WHERE ${dateColumn} = $1 ${dimensionClause}`,
        currentParams,
    );
    if (currentResult.rows.length === 0 || currentResult.rows[0].value == null) return INSUFFICIENT_DATA;
    const current = Number(currentResult.rows[0].value);

    const historyParams = dimensionColumn
        ? [metricDate, windowDays, dimensionValue]
        : [metricDate, windowDays];
    const historyDimensionClause = dimensionColumn ? `AND ${dimensionColumn} = $3` : '';

    const historyResult = await pool.query(
        `SELECT ${valueColumn} AS value FROM ${tableName}
         WHERE ${dateColumn} >= ($1::date - $2::int) AND ${dateColumn} < $1 ${historyDimensionClause}`,
        historyParams,
    );

    if (historyResult.rows.length < windowDays) return INSUFFICIENT_DATA;

    const values = historyResult.rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
    if (values.length === 0) return INSUFFICIENT_DATA;

    const previousPeriodAverage = values.reduce((sum, v) => sum + v, 0) / values.length;
    if (!Number.isFinite(previousPeriodAverage) || previousPeriodAverage === 0) return INSUFFICIENT_DATA;

    const trendPercentage = ((current - previousPeriodAverage) / previousPeriodAverage) * 100;

    return {
        available: true,
        current,
        previous_period_average: Math.round(previousPeriodAverage * 100) / 100,
        window: windowDays,
        trend_percentage: Math.round(trendPercentage * 100) / 100,
    };
}

export function getJobsTrend(pool, metricDate, windowDays) {
    return computeTrend(pool, {
        tableName: 'daily_market_metrics',
        valueColumn: 'total_jobs',
        metricDate,
        windowDays,
    });
}

export function getSkillTrend(pool, skillId, metricDate, windowDays) {
    return computeTrend(pool, {
        tableName: 'daily_skill_metrics',
        valueColumn: 'demand_percentage',
        dimensionColumn: 'skill_id',
        dimensionValue: skillId,
        metricDate,
        windowDays,
    });
}

export function getRoleTrend(pool, role, metricDate, windowDays) {
    return computeTrend(pool, {
        tableName: 'daily_role_metrics',
        valueColumn: 'demand_percentage',
        dimensionColumn: 'role',
        dimensionValue: role,
        metricDate,
        windowDays,
    });
}

// Maps a ±100% trend into a 0-100 scale: -100%->0, 0%->50, +100%->100.
export function rescaleTrendPct(pct) {
    const clamped = Math.max(-100, Math.min(100, pct));
    return (clamped + 100) / 2;
}
