'use client';

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import type { JSX } from 'react';

export type DonutSegment = {
  value: number;
  color: string;
};

type Props = {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel?: string;
  centerSub?: string;
  size?: number;
};

export function ComplianceDonut({
  segments,
  centerValue,
  centerLabel,
  centerSub,
  size = 200,
}: Props): JSX.Element {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={segments}
            cx="50%"
            cy="50%"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            {segments.map((seg, i) => (
              <Cell key={i} fill={seg.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-h4 font-semibold leading-none text-foreground">
          {centerValue}
        </span>
        {centerLabel !== undefined && (
          <span className="mt-1 text-caption uppercase tracking-widest text-foreground-tertiary">
            {centerLabel}
          </span>
        )}
        {centerSub !== undefined && (
          <span className="mt-0.5 text-caption text-foreground-tertiary">
            {centerSub}
          </span>
        )}
      </div>
    </div>
  );
}
