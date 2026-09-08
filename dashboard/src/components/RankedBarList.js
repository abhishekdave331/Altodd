'use client';

import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import EmptyState from './EmptyState';

export default function RankedBarList({
    items,
    labelKey = 'name',
    valueKey = 'demand_percentage',
    countKey = 'job_count',
    valueSuffix = '%',
    maxRows = 12,
    emptyMessage,
}) {
    const containerRef = useRef(null);

    const rows = (items ?? []).slice(0, maxRows);
    const max = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 1);

    useEffect(() => {
        if (!containerRef.current || rows.length === 0) return;
        const bars = containerRef.current.querySelectorAll('[data-bar-fill]');
        animate(bars, {
            width: (el) => `${el.dataset.targetWidth}%`,
            duration: 700,
            delay: stagger(40),
            ease: 'outQuad',
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    if (rows.length === 0) {
        return <EmptyState message={emptyMessage} />;
    }

    return (
        <div ref={containerRef} className="flex flex-col gap-2.5">
            {rows.map((row, index) => {
                const value = Number(row[valueKey]) || 0;
                const barPct = (value / max) * 100;
                const label = row[labelKey] ?? 'Unknown';
                const count = row[countKey];

                return (
                    <div key={`${label}-${index}`} className="flex items-center gap-3 text-sm">
                        <span className="w-44 shrink-0 truncate text-text-secondary" title={label}>
                            {label}
                        </span>
                        <div
                            className="relative flex-1 h-2 rounded-full bg-border overflow-hidden"
                            title={`${label}: ${value.toFixed(1)}${valueSuffix}${count != null ? ` · ${count} jobs` : ''}`}
                        >
                            <div
                                data-bar-fill
                                data-target-width={barPct}
                                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                                style={{ width: '0%' }}
                            />
                        </div>
                        <span className="w-16 shrink-0 text-right text-text-muted tabular-nums">
                            {value.toFixed(1)}{valueSuffix}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
