'use client';

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import type { JSX } from 'react';

type Props = {
  value: number;
  label?: string;
  size?: number;
};

export function DossierGauge({ value, label, size = 140 }: Props): JSX.Element {
  const clamped = Math.max(0, Math.min(100, value));
  const data = [
    { value: clamped },
    { value: 100 - clamped },
  ];
  const fillColor =
    clamped >= 85 ? 'var(--success)' : clamped >= 70 ? 'var(--warning)' : 'var(--error)';

  return (
    <div className="relative" style={{ width: size, height: size * 0.6 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="90%"
            startAngle={180}
            endAngle={0}
            innerRadius="60%"
            outerRadius="100%"
            dataKey="value"
            stroke="none"
          >
            <Cell fill={fillColor} />
            <Cell fill="var(--background-tertiary)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="text-h5 font-semibold leading-none text-foreground">
          {clamped}
          <span className="text-title3 text-foreground-tertiary">%</span>
        </span>
        {label !== undefined && (
          <span className="mt-0.5 text-caption uppercase tracking-widest text-foreground-tertiary">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
