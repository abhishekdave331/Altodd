'use client';

import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import EmptyState from './EmptyState';

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    // Fixed locale (not the runtime default) so server and client render the
    // same string - a locale mismatch between Node's SSR pass and the
    // browser is a classic source of hydration errors.
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function JobsTable({ jobs }) {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const rows = containerRef.current.querySelectorAll('[data-job-row]');
        animate(rows, {
            opacity: [0, 1],
            translateY: [6, 0],
            duration: 400,
            delay: stagger(25),
            ease: 'outQuad',
        });
    }, [jobs]);

    if (!jobs || jobs.length === 0) {
        return <EmptyState message="No jobs ingested yet." />;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                        <th className="py-2 pr-4 font-medium">Title</th>
                        <th className="py-2 pr-4 font-medium">Company</th>
                        <th className="py-2 pr-4 font-medium">Location</th>
                        <th className="py-2 pr-4 font-medium">Role</th>
                        <th className="py-2 pr-4 font-medium">Seniority</th>
                        <th className="py-2 pr-4 font-medium">Type</th>
                        <th className="py-2 pr-4 font-medium">Applicants</th>
                        <th className="py-2 pr-4 font-medium">Posted</th>
                    </tr>
                </thead>
                <tbody ref={containerRef}>
                    {jobs.map((job) => (
                        <tr
                            key={job.external_job_id}
                            data-job-row
                            className="border-b border-border last:border-0 opacity-0 hover:bg-surface transition-colors"
                        >
                            <td className="py-2.5 pr-4 max-w-xs">
                                {job.job_url ? (
                                    <a
                                        href={job.job_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-text-primary hover:text-accent truncate block"
                                        title={job.title}
                                    >
                                        {job.title}
                                    </a>
                                ) : (
                                    <span className="text-text-primary truncate block" title={job.title}>{job.title}</span>
                                )}
                            </td>
                            <td className="py-2.5 pr-4 text-text-secondary truncate max-w-[10rem]" title={job.company}>
                                {job.company ?? '—'}
                            </td>
                            <td className="py-2.5 pr-4 text-text-secondary truncate max-w-[10rem]" title={job.location}>
                                {job.location ?? '—'}
                            </td>
                            <td className="py-2.5 pr-4 text-text-secondary truncate max-w-[10rem]" title={job.actual_role}>
                                {job.actual_role ?? '—'}
                            </td>
                            <td className="py-2.5 pr-4 text-text-secondary whitespace-nowrap">{job.seniority ?? '—'}</td>
                            <td className="py-2.5 pr-4 text-text-secondary whitespace-nowrap">{job.employment_type ?? '—'}</td>
                            <td className="py-2.5 pr-4 text-text-muted tabular-nums whitespace-nowrap">{job.applicants ?? '—'}</td>
                            <td className="py-2.5 pr-4 text-text-muted whitespace-nowrap">{formatDate(job.posted_at)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
