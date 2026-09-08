import { Router } from 'express';
import { pool } from '../config/database.js';
import * as dashboardService from '../services/dashboardService.js';

export const dashboardRoutes = Router();

function asyncHandler(fn) {
    return (req, res, next) => fn(req, res, next).catch(next);
}

dashboardRoutes.get('/overview', asyncHandler(async (req, res) => {
    const result = await dashboardService.getOverview(pool, req.query.date ?? null);
    res.json(result);
}));

dashboardRoutes.get('/skills', asyncHandler(async (req, res) => {
    const result = await dashboardService.getSkills(pool, req.query.range);
    res.json(result);
}));

dashboardRoutes.get('/emerging-skills', asyncHandler(async (req, res) => {
    const result = await dashboardService.getEmergingSkills(pool);
    res.json({ emerging_skills: result });
}));

dashboardRoutes.get('/roles', asyncHandler(async (req, res) => {
    const result = await dashboardService.getRoles(pool);
    res.json({ roles: result });
}));

dashboardRoutes.get('/capabilities', asyncHandler(async (req, res) => {
    const result = await dashboardService.getCapabilities(pool);
    res.json({ capabilities: result });
}));

dashboardRoutes.get('/seniority', asyncHandler(async (req, res) => {
    const result = await dashboardService.getSeniority(pool);
    res.json({ seniority: result });
}));

dashboardRoutes.get('/locations', asyncHandler(async (req, res) => {
    const result = await dashboardService.getLocations(pool);
    res.json({ locations: result });
}));

dashboardRoutes.get('/industries', asyncHandler(async (req, res) => {
    const result = await dashboardService.getIndustries(pool);
    res.json({ industries: result });
}));

dashboardRoutes.get('/jobs', asyncHandler(async (req, res) => {
    const result = await dashboardService.getJobsList(pool);
    res.json({ jobs: result });
}));
