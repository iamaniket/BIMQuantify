import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import type { ActivityTimeline } from '@/lib/api/schemas/activity';

// uPlot/canvas doesn't render in jsdom — stub the chart so we can read the
// densified values/labels it would receive.
vi.mock('@/components/shared/charts/TrendArea', () => ({
  TrendArea: ({ values, labels }: { values: number[]; labels?: string[] }) => (
    <div
      data-testid="trend-area"
      data-values={JSON.stringify(values)}
      data-labels={JSON.stringify(labels)}
    />
  ),
}));

import { ActivityTimelineView } from './ActivityTimelinePanel';

const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

describe('ActivityTimelineView', () => {
  it('renders the empty state in English when there is no activity', () => {
    render(
      <IntlWrapper locale="en">
        <ActivityTimelineView timeline={[]} isLoading={false} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Activity over time')).toBeInTheDocument();
    expect(screen.getByText('No activity in this period.')).toBeInTheDocument();
    expect(screen.queryByTestId('trend-area')).not.toBeInTheDocument();
  });

  it('renders the empty state in Dutch', () => {
    render(
      <IntlWrapper locale="nl">
        <ActivityTimelineView timeline={[]} isLoading={false} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Activiteit in de tijd')).toBeInTheDocument();
    expect(screen.getByText('Geen activiteit in deze periode.')).toBeInTheDocument();
  });

  it('shows a skeleton (no chart) while loading', () => {
    render(
      <IntlWrapper locale="en">
        <ActivityTimelineView timeline={undefined} isLoading />
      </IntlWrapper>,
    );

    expect(screen.queryByTestId('trend-area')).not.toBeInTheDocument();
    expect(screen.queryByText('No activity in this period.')).not.toBeInTheDocument();
  });

  it('densifies server buckets into a fixed 8-week axis', () => {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - MS_WEEK);
    const timeline: ActivityTimeline = [
      { bucket_start: lastWeek.toISOString(), count: 3 },
      { bucket_start: now.toISOString(), count: 5 },
    ];

    render(
      <IntlWrapper locale="en">
        <ActivityTimelineView timeline={timeline} isLoading={false} />
      </IntlWrapper>,
    );

    const chart = screen.getByTestId('trend-area');
    const values = JSON.parse(chart.getAttribute('data-values') ?? '[]') as number[];
    const labels = JSON.parse(chart.getAttribute('data-labels') ?? '[]') as string[];

    // Fixed 8-week window, most recent week last.
    expect(values).toHaveLength(8);
    expect(labels).toHaveLength(8);
    expect(values[7]).toBe(5); // this week
    expect(values[6]).toBe(3); // one week ago
    expect(values.reduce((a, b) => a + b, 0)).toBe(8);
  });
});
