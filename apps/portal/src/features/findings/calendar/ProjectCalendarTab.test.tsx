import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';
import type { Borgingsmoment, Finding } from '@/lib/api/schemas';
import type { Deadline } from '@/lib/api/schemas/deadlines';

import { ProjectCalendarTab } from './ProjectCalendarTab';
import {
  buildCalendarEvents, daysFromToday, deadlineTone, isFindingOverdue, momentTone,
} from './calendarEvents';

// --- Mocks ------------------------------------------------------------------
// Stub the design-system controls used in the toolbar; aria-labels / children
// text are asserted on.
vi.mock('@bimstitch/ui', () => ({
  IconButton: ({ 'aria-label': label, onClick }: { 'aria-label': string; onClick?: () => void }) => (
    <button type="button" aria-label={label} onClick={onClick} />
  ),
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
  CountChip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

// next-intl navigation pulls next/navigation, which isn't resolvable here.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock('@/features/projects/detail/FindingDetailModal', () => ({ FindingDetailModal: () => null }));
vi.mock('@/features/projects/detail/deadlines/FilingDialog', () => ({ FilingDialog: () => null }));

// Holiday fetch + project country + date mutations aren't under test here.
vi.mock('@/features/projects/useProject', () => ({ useProject: () => ({ data: { country: 'NL' } }) }));
vi.mock('@/features/jurisdictions/useHolidays', () => ({ useHolidays: () => new Map() }));
vi.mock('@/features/findings/useUpdateFinding', () => ({ useUpdateFinding: () => ({ mutate: vi.fn() }) }));
vi.mock('@/features/borgingsplan/useMomentMutations', () => ({ useUpdateMoment: () => ({ mutate: vi.fn() }) }));

const mockUseDeadlines = vi.fn();
const mockUseSettings = vi.fn();
const mockUsePlan = vi.fn();

vi.mock('@/features/projects/detail/deadlines/useDeadlines', () => ({
  useDeadlines: () => mockUseDeadlines(),
}));
vi.mock('@/features/projects/detail/deadlines/useDeadlineNotificationSettings', () => ({
  useProjectDeadlineSettings: () => mockUseSettings(),
}));
vi.mock('@/features/borgingsplan/useBorgingsplan', () => ({
  useBorgingsplan: () => mockUsePlan(),
}));

// --- Fixtures ---------------------------------------------------------------
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    project_id: 'p1',
    title: 'Fire stop missing',
    description: 'x',
    severity: 'high',
    status: 'open',
    assignee_user_id: null,
    deadline_date: '2026-06-15',
    bbl_article_ref: null,
    created_by_user_id: '33333333-3333-3333-3333-333333333333',
    source_checklist_item_id: null,
    borgingsmoment_id: null,
    linked_model_id: null,
    linked_file_id: null,
    linked_element_global_id: null,
    linked_file_type: null,
    anchor_x: null,
    anchor_y: null,
    anchor_z: null,
    anchor_page: null,
    photo_ids: null,
    resolution_note: null,
    resolution_evidence_ids: null,
    reference_attachment_ids: null,
    template_id: null,
    custom_values: null,
    created_at: '2026-05-29T10:00:00Z',
    updated_at: '2026-05-29T10:00:00Z',
    ...overrides,
  };
}

function makeDeadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: 'd-1',
    project_id: 'p1',
    deadline_type: 'construction_notification',
    due_date: '2026-06-20',
    status: 'pending',
    met_at: null,
    met_by_user_id: null,
    reference_number: null,
    filing_notes: null,
    filed_at: null,
    is_overdue: false,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makeMoment(overrides: Partial<Borgingsmoment> = {}): Borgingsmoment {
  return {
    id: 'm-1',
    borgingsplan_id: 'bp-1',
    project_id: 'p1',
    phase: 'shell',
    name: 'Shell inspection',
    planned_date: '2026-06-25',
    actual_date: null,
    responsible_user_id: null,
    status: 'planned',
    sequence_in_phase: 0,
    notes: null,
    checklist_items: [],
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

const SETTINGS = [{ deadline_type: 'construction_notification', label: 'Permit deadline', legal_reference: null }];

function setData(opts: { findings?: Finding[]; deadlines?: Deadline[]; moments?: Borgingsmoment[] } = {}): Finding[] {
  mockUseDeadlines.mockReturnValue({ data: opts.deadlines ?? [], isLoading: false });
  mockUseSettings.mockReturnValue({ data: SETTINGS, isLoading: false });
  mockUsePlan.mockReturnValue({ data: { moments: opts.moments ?? [] }, isLoading: false });
  return opts.findings ?? [];
}

// --- Pure mapping -----------------------------------------------------------
describe('calendarEvents', () => {
  const today = new Date(2026, 5, 15);

  it('flags overdue only for active findings past their deadline', () => {
    expect(isFindingOverdue(makeFinding({ deadline_date: '2026-06-10', status: 'open' }), today)).toBe(true);
    expect(isFindingOverdue(makeFinding({ deadline_date: '2026-06-10', status: 'resolved' }), today)).toBe(false);
    expect(isFindingOverdue(makeFinding({ deadline_date: '2026-06-20', status: 'open' }), today)).toBe(false);
    expect(isFindingOverdue(makeFinding({ deadline_date: null, status: 'open' }), today)).toBe(false);
  });

  it('maps deadline status to a tone', () => {
    expect(deadlineTone(makeDeadline({ status: 'met' }), today)).toBe('success');
    expect(deadlineTone(makeDeadline({ status: 'not_applicable' }), today)).toBe('neutral');
    expect(deadlineTone(makeDeadline({ is_overdue: true }), today)).toBe('error');
    expect(deadlineTone(makeDeadline({ due_date: '2026-06-18' }), today)).toBe('warning'); // ≤7d
    expect(deadlineTone(makeDeadline({ due_date: '2026-09-01' }), today)).toBe('info');
  });

  it('maps moment status to a tone', () => {
    expect(momentTone(makeMoment({ status: 'passed' }))).toBe('success');
    expect(momentTone(makeMoment({ status: 'failed' }))).toBe('error');
    expect(momentTone(makeMoment({ status: 'skipped' }))).toBe('warning');
    expect(momentTone(makeMoment({ status: 'in_progress' }))).toBe('info');
    expect(momentTone(makeMoment({ status: 'planned' }))).toBe('neutral');
  });

  it('computes whole-day offsets from today', () => {
    expect(daysFromToday('2026-06-15', today)).toBe(0);
    expect(daysFromToday('2026-06-18', today)).toBe(3);
    expect(daysFromToday(null, today)).toBeNull();
  });

  it('buckets each source onto its date key, null when undated', () => {
    const labels = {
      findingStatus: (s: string) => s,
      deadlineName: (d: Deadline) => d.deadline_type,
      deadlineStatus: () => 'status',
      momentStatus: (s: string) => s,
    };
    const events = buildCalendarEvents(
      { findings: [makeFinding(), makeFinding({ id: 'f-2', deadline_date: null })], deadlines: [makeDeadline()], moments: [makeMoment()] },
      today,
      labels,
    );
    expect(events).toHaveLength(4);
    expect(events.find((e) => e.id === 'finding:f-1')?.isoDay).toBe('2026-06-15');
    expect(events.find((e) => e.id === 'finding:f-2')?.isoDay).toBeNull();
    expect(events.find((e) => e.id === 'deadline:d-1')?.isoDay).toBe('2026-06-20');
    expect(events.find((e) => e.id === 'moment:m-1')?.isoDay).toBe('2026-06-25');
  });
});

// --- Rendering --------------------------------------------------------------
describe('ProjectCalendarTab', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)); // today = 15 Jun 2026
  });
  afterAll(() => { vi.useRealTimers(); });

  it('places all three item kinds on the current month grid', () => {
    const findings = setData({
      findings: [makeFinding()],
      deadlines: [makeDeadline()],
      moments: [makeMoment()],
    });

    render(<IntlWrapper locale="en"><ProjectCalendarTab projectId="p1" findings={findings} /></IntlWrapper>);

    expect(screen.getByText('Fire stop missing')).toBeInTheDocument();
    expect(screen.getByText('Permit deadline')).toBeInTheDocument();
    expect(screen.getByText('Shell inspection')).toBeInTheDocument();
  });

  it('collapses a busy day to "+N more"', () => {
    const bulk = Array.from({ length: 4 }, (_, i) => makeFinding({ id: `b-${i}`, title: `Bulk ${i}`, deadline_date: '2026-06-10' }));
    const findings = setData({ findings: bulk });

    render(<IntlWrapper locale="en"><ProjectCalendarTab projectId="p1" findings={findings} /></IntlWrapper>);

    expect(screen.getByText('1 more')).toBeInTheDocument();
  });

  it('hides a layer when its kind filter is toggled off', () => {
    const findings = setData({ deadlines: [makeDeadline()], findings: [makeFinding()] });

    render(<IntlWrapper locale="en"><ProjectCalendarTab projectId="p1" findings={findings} /></IntlWrapper>);
    expect(screen.getByText('Permit deadline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Deadlines/ }));
    expect(screen.queryByText('Permit deadline')).not.toBeInTheDocument();
  });

  it('lists undated findings under Unscheduled once expanded', () => {
    const findings = setData({ findings: [makeFinding({ id: 'u-1', title: 'No deadline finding', deadline_date: null })] });

    render(<IntlWrapper locale="en"><ProjectCalendarTab projectId="p1" findings={findings} /></IntlWrapper>);
    expect(screen.queryByText('No deadline finding')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Unscheduled/ }));
    expect(screen.getByText('No deadline finding')).toBeInTheDocument();
  });

  it('opens the day side panel when a populated day is clicked', () => {
    const findings = setData({ findings: [makeFinding()] });

    render(<IntlWrapper locale="en"><ProjectCalendarTab projectId="p1" findings={findings} /></IntlWrapper>);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Fire stop missing'));
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders Dutch chrome when locale is nl', () => {
    const findings = setData({ findings: [makeFinding()] });

    render(<IntlWrapper locale="nl"><ProjectCalendarTab projectId="p1" findings={findings} /></IntlWrapper>);

    expect(screen.getByText('Vandaag')).toBeInTheDocument();
    expect(screen.getByText(/juni/i)).toBeInTheDocument();
  });
});
