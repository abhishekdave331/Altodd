import { getTotalJobCount } from './dailyMetrics.js';

// Normalization formula matching resolveTaxonomyValue.js's toNormalizedKey()
// and normalizeRoles.js's toKey() exactly (lowercase, trim, collapse
// whitespace) - same convention already established in SQL form by
// migration 002/003's seed/backfill statements.
const NORMALIZE_SQL = `LOWER(TRIM(REGEXP_REPLACE(jr.actual_role, '\\s+', ' ', 'g')))`;

/**
 * Aggregates job_roles.actual_role into canonical, merge-resolved role
 * counts (Task 6.2). Every non-null actual_role text is expected to already
 * have its own exact-match roles row, because upsertRole() (Task 5.12) runs
 * unconditionally for every actual_role value at ingestion time - this means
 * taxonomy_aliases can never actually apply to this specific text (it would
 * always be intercepted by its own exact-match row first, same finding as
 * Task 5.13), so a single normalized_name join followed by one
 * merged_into_id hop reproduces resolveTaxonomyValue()'s
 * exact_match+followRoleMerge() behavior exactly, without calling the
 * resolver once per row. Task 5.14's single-hop invariant (a merge target
 * is always active) means one LEFT JOIN hop is sufficient - not a shortcut,
 * but the same guarantee followRoleMerge() itself relies on.
 *
 * Both integrity conditions below are defensive, not expected to ever fire
 * against real data - they exist so a violation of either guarantee is
 * surfaced loudly instead of silently mis-aggregated.
 */
export async function computeDailyRoleMetrics(pool, metricDate) {
    const totalJobs = await getTotalJobCount(pool, metricDate);

    const unmatched = await pool.query(`
        SELECT DISTINCT jr.actual_role
        FROM job_roles jr
        LEFT JOIN roles r ON r.normalized_name = ${NORMALIZE_SQL}
        WHERE jr.actual_role IS NOT NULL AND r.id IS NULL
    `);
    if (unmatched.rows.length > 0) {
        throw new Error(
            `computeDailyRoleMetrics: ${unmatched.rows.length} distinct actual_role value(s) have no matching roles ` +
            `row (e.g. "${unmatched.rows[0].actual_role}") - this should be impossible given upsertRole() runs for ` +
            `every actual_role at ingestion time. Data may have been modified outside the normal ingestion path.`,
        );
    }

    // Task 6.7: joined to jobs and bounded by metricDate - see
    // dailyMetrics.js's getTotalJobCount comment for the proven defect this
    // prevents (a re-run for a past date silently pulling in jobs ingested
    // after that date).
    const result = await pool.query(`
        SELECT
            final.id AS role_id,
            final.name AS role,
            final.merged_into_id AS final_merged_into_id,
            COUNT(*)::int AS job_count
        FROM job_roles jr
        JOIN jobs j ON j.id = jr.job_id
        JOIN roles source ON source.normalized_name = ${NORMALIZE_SQL}
        JOIN roles final ON final.id = COALESCE(source.merged_into_id, source.id)
        WHERE jr.actual_role IS NOT NULL AND j.first_seen_at < ($1::date + 1)
        GROUP BY final.id, final.name, final.merged_into_id
    `, [metricDate]);

    for (const row of result.rows) {
        if (row.final_merged_into_id) {
            throw new Error(
                `computeDailyRoleMetrics: role "${row.role}" (id=${row.role_id}) resolved as a final aggregation ` +
                `target but is itself merged into another role (id=${row.final_merged_into_id}) - this indicates a ` +
                `multi-hop merge chain, which mergeRole() should never produce. Refusing to silently aggregate ` +
                `against a tombstoned role.`,
            );
        }
    }

    // Delete-then-insert (not per-row upsert) for this date: a role that no
    // longer contributes any jobs under canonical grouping (e.g. a merged
    // role's old text, now folded into its survivor) must not linger as a
    // stale row that ON CONFLICT DO UPDATE would never touch again. This
    // also transparently corrects any historical rows computed before this
    // fix existed, simply by re-running aggregation for that date.
    //
    // Task 6.8: pool is always the transaction client runAggregationOnly
    // opens around all 7 aggregation calls - no internal transaction here
    // anymore (see skillMetrics.js's comment for why an internal
    // withTransaction() wouldn't have participated in that outer one anyway).
    await pool.query('DELETE FROM daily_role_metrics WHERE metric_date = $1', [metricDate]);
    for (const row of result.rows) {
        const demandPercentage = totalJobs > 0 ? (row.job_count / totalJobs) * 100 : 0;
        await pool.query(
            `INSERT INTO daily_role_metrics (metric_date, role, job_count, demand_percentage)
             VALUES ($1,$2,$3,$4)`,
            [metricDate, row.role, row.job_count, demandPercentage],
        );
    }

    return { metricDate, rolesProcessed: result.rows.length };
}
