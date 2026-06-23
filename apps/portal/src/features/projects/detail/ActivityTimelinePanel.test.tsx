import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import type { ActivityTimeline, ActivityTimelineBucket } from '@/lib/api/schemas/activity';

// uPlot/canvas doesn't render in jsdom — stub the chart so we can read the
// densified values/labels and exercise the hover-tooltip render prop.
vi.mock('@/components/shared/charts/TrendArea', () => ({
  TrendArea: ({
    values,
    labels,
    tooltip,
    partialLastPoint,
  }: {
    values: number[];
    labels?: string[];
    tooltip?: (index: number) => React.ReactNode;
    partialLastPoint?: boolean;
  }) => (
    <div
      data-testid="trend-area"
      data-values={JSON.stringify(values)}
      data-labels={JSON.stringify(labels)}
      data-partial={String(partialLastPoint ?? false)}
    >
      <div data-testid="tip-current">{tooltip?.(7)}</div>
      <div data-testid="tip-prev">{tooltip?.(6)}</div>
    </div>
  ),
}));

import { ActivityTimelineView, buildActivityTrend } from './ActivityTimelinePanel';

const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

function bucket(
  ms: number,
  count: number,
  by_category: Record<string, number> = {},
  by_resource: Record<string, number> = {},
): ActivityTimelineBucket {
  return { bucket_start: new Date(ms).toISOString(), count, by_category, by_resource };
}

describe('buildActivityTrend', () => {
  it('returns 8 slots with only the last flagged as the current week', () => {
    const slots = buildActivityTrend([], Date.now());
    expect(slots).toHaveLength(8);
    expect(slots[7]?.isCurrentWeek).toBe(true);
    expect(slots.slice(0, 7).every((s) => !s.isCurrentWeek)).toBe(true);
    expect(slots.every((s) => s.value === 0)).toBe(true);
  });

  it('merges category + resource breakdowns from buckets landing in one slot', () => {
    // Fixed mid-week reference + two same-week (Tue/Wed) buckets so the
    // calendar-week slotting is deterministic across timezones.
    const wed = Date.parse('2026-06-24T12:00:00Z');
    const slots = buildActivityTrend(
      [
        bucket(Date.parse('2026-06-24T09:00:00Z'), 3, { create: 2, change: 1 }, { finding: 2, report: 1 }),
        bucket(Date.parse('2026-06-23T09:00:00Z'), 2, { create: 1, upload: 1 }, { finding: 1, model: 1 }),
      ],
      wed,
    );
    const current = slots[7];
    expect(current?.value).toBe(5);
    expect(current?.byCategory).toEqual({ create: 3, change: 1, upload: 1 });
    expect(current?.byResource).toEqual({ finding: 3, report: 1, model: 1 });
  });

  it('slots a one-week-old bucket into the previous slot', () => {
    const now = Date.now();
    const slots = buildActivityTrend([bucket(now - MS_WEEK, 4, { create: 4 }, { finding: 4 })], now);
    expect(slots[6]?.value).toBe(4);
    expect(slots[6]?.byCategory).toEqual({ create: 4 });
  });

  it('puts the current calendar week in the trailing slot (not one early)', () => {
    // Backend buckets on Monday-anchored UTC weeks. The current week's bucket
    // (this Monday) must land in slot 7, leaving no phantom 0 at the end.
    const now = Date.parse('2026-06-23T18:00:00Z'); // Tuesday
    const mondayThisWeek = '2026-06-22T00:00:00Z';
    const slots = buildActivityTrend([bucket(Date.parse(mondayThisWeek), 91, { change: 91 }, { finding: 91 })], now);
    expect(slots[7]?.value).toBe(91);
    expect(slots[7]?.isCurrentWeek).toBe(true);
    expect(slots[6]?.value).toBe(0);
  });
});

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

  it('densifies server buckets into a fixed 8-week axis and marks the partial week', () => {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - MS_WEEK);
    const timeline: ActivityTimeline = [
      bucket(lastWeek.getTime(), 3, { create: 2, change: 1 }, { finding: 2, report: 1 }),
      bucket(now.getTime(), 5, { upload: 5 }, { project_file: 5 }),
    ];

    render(
      <IntlWrapper locale="en">
        <ActivityTimelineView timeline={timeline} isLoading={false} />
      </IntlWrapper>,
    );

    const chart = screen.getByTestId('trend-area');
    const values = JSON.parse(chart.getAttribute('data-values') ?? '[]') as number[];
    const labels = JSON.parse(chart.getAttribute('data-labels') ?? '[]') as string[];

    // Fixed 8-week window, most recent week last, partial-week marker on.
    expect(values).toHaveLength(8);
    expect(labels).toHaveLength(8);
    expect(values[7]).toBe(5); // this week
    expect(values[6]).toBe(3); // one week ago
    expect(values.reduce((a, b) => a + b, 0)).toBe(8);
    expect(chart.getAttribute('data-partial')).toBe('true');
  });

  it('renders a breakdown tooltip per point, with the current week labelled in-progress', () => {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - MS_WEEK);
    const timeline: ActivityTimeline = [
      bucket(lastWeek.getTime(), 3, { create: 2, change: 1 }, { finding: 2, report: 1 }),
      bucket(now.getTime(), 5, { upload: 5 }, { project_file: 5 }),
    ];

    render(
      <IntlWrapper locale="en">
        <ActivityTimelineView timeline={timeline} isLoading={false} />
      </IntlWrapper>,
    );

    const current = within(screen.getByTestId('tip-current'));
    expect(current.getByText('This week so far')).toBeInTheDocument();
    expect(current.getByText('5 activities')).toBeInTheDocument();
    expect(current.getByText('Uploads')).toBeInTheDocument();
    expect(current.getByText('Files')).toBeInTheDocument(); // project_file -> Files label

    const prev = within(screen.getByTestId('tip-prev'));
    expect(prev.getByText('3 activities')).toBeInTheDocument();
    expect(prev.getByText('Created')).toBeInTheDocument();
    expect(prev.getByText('Changes')).toBeInTheDocument();
    expect(prev.getByText('By type')).toBeInTheDocument();
    expect(prev.getByText('Findings')).toBeInTheDocument();
    expect(prev.getByText('Reports')).toBeInTheDocument();
  });
});
