import { Router } from 'express';
import { pool } from '../config/database.js';
import * as dashboardService from '../services/dashboardService.js';

export const dashboardRoutes = Router();

function asyncHandler(fn) {
    return (req, res, next) => fn(req, res, next).catch(next);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Task 6.8 fix: the Task 6.6 shape-only check (DATE_RE) let a
// correctly-shaped but calendar-invalid date (e.g. "2020-13-45", or
// "2021-02-29" - 2021 is not a leap year) straight through to Postgres,
// which either raised its own "invalid input syntax for type date" (raw
// 500) or, worse, silently rolled a day-overflow date like 2021-02-29 over
// to 2021-03-01 with no indication to the caller. Verified directly: JS's
// own ISO date parser rejects an out-of-range month as NaN, but silently
// rolls over an out-of-range day-of-month instead of rejecting it - so a
// round-trip check (re-serialize and compare to the original string) is
// required to catch both failure modes, not just an isNaN check alone.
function isValidCalendarDate(str) {
    if (!DATE_RE.test(str)) return false;
    const d = new Date(`${str}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

dashboardRoutes.get('/overview', asyncHandler(async (req, res) => {
    const { date } = req.query;
    // Task 6.6/6.8 fix: an invalid date string previously reached the SQL
    // query as-is, producing a raw 500 (or a silently wrong date) instead
    // of a clean 400 - validate here, before it ever reaches the
    // service/database. A syntactically valid but nonexistent historical
    // date (e.g. ?date=2020-01-01 with no data, or a future date) is NOT
    // rejected here - that's a legitimate request that honestly returns
    // null/"Insufficient historical data" from getOverview, not an error.
    if (date !== undefined && !isValidCalendarDate(date)) {
        return res.status(400).json({ error: 'date must be a valid calendar date in YYYY-MM-DD format.' });
    }
    const result = await dashboardService.getOverview(pool, date ?? null);
    res.json(result);
}));

dashboardRoutes.get('/skills', asyncHandler(async (req, res) => {
    const result = await dashboardService.getSkills(pool, req.query.range);
    res.json(result);
}));

dashboardRoutes.get('/emerging-skills', asyncHandler(async (req, res) => {
    // Task 6.8: getEmergingSkills now returns {date, skills} (previously a
    // bare array) so the response includes which metric_date it's based on,
    // same as every other endpoint below - see dashboardService.js's Task
    // 6.8 comment. Field renamed to emerging_skills here to preserve the
    // existing response key for callers already reading it.
    const { date, skills } = await dashboardService.getEmergingSkills(pool);
    res.json({ date, emerging_skills: skills });
}));

dashboardRoutes.get('/roles', asyncHandler(async (req, res) => {
    const result = await dashboardService.getRoles(pool);
    res.json(result);
}));

dashboardRoutes.get('/capabilities', asyncHandler(async (req, res) => {
    const result = await dashboardService.getCapabilities(pool);
    res.json(result);
}));

dashboardRoutes.get('/seniority', asyncHandler(async (req, res) => {
    const result = await dashboardService.getSeniority(pool);
    res.json(result);
}));

dashboardRoutes.get('/locations', asyncHandler(async (req, res) => {
    const result = await dashboardService.getLocations(pool);
    res.json(result);
}));

dashboardRoutes.get('/industries', asyncHandler(async (req, res) => {
    const result = await dashboardService.getIndustries(pool);
    res.json(result);
}));

dashboardRoutes.get('/jobs', asyncHandler(async (req, res) => {
    const result = await dashboardService.getJobsList(pool);
    res.json({ jobs: result });
}));
