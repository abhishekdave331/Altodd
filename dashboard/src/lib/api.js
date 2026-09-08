const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3003';

async function getJson(path) {
    const res = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error(`API request failed: ${path} (${res.status})`);
    }
    return res.json();
}

export async function fetchDashboardData() {
    const [overview, skills, emergingSkillsRes, capabilitiesRes, seniorityRes, industriesRes, jobsRes] = await Promise.all([
        getJson('/api/dashboard/overview'),
        getJson('/api/dashboard/skills?range=30d'),
        getJson('/api/dashboard/emerging-skills'),
        getJson('/api/dashboard/capabilities'),
        getJson('/api/dashboard/seniority'),
        getJson('/api/dashboard/industries'),
        getJson('/api/dashboard/jobs'),
    ]);

    return {
        overview,
        skills,
        emergingSkills: emergingSkillsRes.emerging_skills,
        capabilities: capabilitiesRes.capabilities,
        seniority: seniorityRes.seniority,
        industries: industriesRes.industries,
        jobs: jobsRes.jobs,
    };
}
