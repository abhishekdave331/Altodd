'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'animejs';

export default function StatTile({ label, value, suffix = '', decimals = 0, subtext }) {
    const valueRef = useRef(null);

    useEffect(() => {
        if (!valueRef.current) return;
        if (value == null) {
            valueRef.current.textContent = '—';
            return;
        }

        const counter = { current: 0 };
        animate(counter, {
            current: value,
            duration: 900,
            ease: 'outExpo',
            onUpdate: () => {
                if (valueRef.current) {
                    valueRef.current.textContent = counter.current.toFixed(decimals) + suffix;
                }
            },
        });
    }, [value, decimals, suffix]);

    return (
        <div className="rounded-xl border border-border bg-surface-raised p-5 flex flex-col gap-1">
            <span className="text-sm text-text-secondary">{label}</span>
            <span ref={valueRef} className="text-3xl font-semibold text-text-primary tabular-nums">
                {value == null ? '—' : `0${suffix}`}
            </span>
            {subtext && <span className="text-xs text-text-muted">{subtext}</span>}
        </div>
    );
}
