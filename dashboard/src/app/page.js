import { fetchDashboardData } from '@/lib/api';
import StatTile from '@/components/StatTile';
import MarketHealthTile from '@/components/MarketHealthTile';
import SectionCard from '@/components/SectionCard';
import RankedBarList from '@/components/RankedBarList';
import JobsTable from '@/components/JobsTable';

function formatChange(pct) {
    if (pct == null) return null;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}% vs 7d`;
}

export default async function Home() {
    const data = await fetchDashboardData();
    const { overview, skills, emergingSkills, capabilities, seniority, industries, jobs } = data;

    const emergingRows = emergingSkills
        .filter((s) => s.available)
        .map((s) => ({ name: s.skill, demand_percentage: s.emerging_score, job_count: s.job_count }));

    return (
        <main className="mx-auto max-w-5xl w-full px-6 py-10 flex flex-col gap-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold text-text-primary">Vektor Market Intelligence</h1>
                <p className="text-sm text-text-secondary">
                    AI/ML job market snapshot for {overview.date ?? 'today'}
                </p>
            </header>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MarketHealthTile score={overview.market_health.score} status={overview.market_health.status} />
                <StatTile
                    label="Total Jobs"
                    value={overview.jobs.total}
                    subtext={formatChange(overview.jobs.change_7d)}
                />
                <StatTile label="Unique Companies" value={overview.companies.unique} />
                <StatTile
                    label="Avg. Applicants"
                    value={overview.competition.average_applicants}
                    decimals={0}
                />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                <SectionCard title="Top Skills" description="Ranked by share of jobs mentioning each skill">
                    <RankedBarList items={skills.skills} emptyMessage="No skill data yet." />
                </SectionCard>

                <SectionCard title="Emerging Skills" description="Skills with sustained positive growth (needs 7+ days of history)">
                    <RankedBarList
                        items={emergingRows}
                        valueSuffix=""
                        emptyMessage="Not enough history yet to detect emerging skills — check back after a week of daily runs."
                    />
                </SectionCard>

                <SectionCard title="Capabilities" description="What employers expect candidates to be able to do">
                    <RankedBarList items={capabilities} emptyMessage="No capability data yet." />
                </SectionCard>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                <SectionCard title="Seniority">
                    <RankedBarList items={seniority} labelKey="seniority" maxRows={6} emptyMessage="No seniority data yet." />
                </SectionCard>

                <SectionCard title="Industries">
                    <RankedBarList items={industries} labelKey="industry" maxRows={6} emptyMessage="No industry data yet." />
                </SectionCard>
            </div>

            <SectionCard title="All Jobs" description={`${jobs.length} job${jobs.length === 1 ? '' : 's'} ingested`}>
                <JobsTable jobs={jobs} />
            </SectionCard>
        </main>
    );
}
