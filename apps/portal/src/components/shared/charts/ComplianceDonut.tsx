'use client';

import type { JSX } from 'react';

import { DonutChart, type DonutSegment } from './DonutChart';

export type { DonutSegment };

type Props = {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel?: string;
  centerSub?: string;
  size?: number;
};

/** Compliance score ring. Thin wrapper over the generic SVG {@link DonutChart}
 * (was recharts; now lib-free). Public API unchanged. */
export function ComplianceDonut(props: Props): JSX.Element {
  return <DonutChart {...props} />;
}
