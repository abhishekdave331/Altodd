'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'animejs';

const STATUS_STYLES = {
    Strong: { color: 'var(--status-good)', label: 'Strong' },
    Moderate: { color: 'var(--status-warning)', label: 'Moderate' },
    Weak: { color: 'var(--status-serious)', label: 'Weak' },
};

export default function MarketHealthTile({ score, status }) {
    const valueRef = useRef(null);
    const style = STATUS_STYLES[status];

    useEffect(() => {
        if (!valueRef.current) return;
        if (score == null) {
            valueRef.current.textContent = '—';
            return;
        }
        const counter = { current: 0 };
        animate(counter, {
            current: score,
            duration: 900,
            ease: 'outExpo',
            onUpdate: () => {
                if (valueRef.current) valueRef.current.textContent = counter.current.toFixed(0);
            },
        });
    }, [score]);

    return (
        <div className="rounded-xl border border-border bg-surface-raised p-5 flex flex-col gap-2">
            <span className="text-sm text-text-secondary">Market Health</span>
            <div className="flex items-baseline gap-3">
                <span ref={valueRef} className="text-3xl font-semibold text-text-primary tabular-nums">
                    {score == null ? '—' : '0'}
                </span>
                {style ? (
                    <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: style.color }}>
                        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: style.color }} />
                        {style.label}
                    </span>
                ) : (
                    <span className="text-sm text-text-muted">{status}</span>
                )}
            </div>
        </div>
    );
}
