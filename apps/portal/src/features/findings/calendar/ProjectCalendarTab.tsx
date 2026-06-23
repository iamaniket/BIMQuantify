'use client';

import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  useState, type JSX, type ReactNode,
} from 'react';

import { CalendarEventChip } from '@/components/shared/calendar/CalendarEventChip';
import { MonthCalendar } from '@/components/shared/calendar/MonthCalendar';
import { WeekCalendar } from '@/components/shared/calendar/WeekCalendar';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { FindingDetailPanel } from '@/features/projects/detail/FindingDetailPanel';
import { FilingDialog } from '@/features/projects/detail/deadlines/FilingDialog';
import type { Finding } from '@/lib/api/schemas';

import {
  KIND_ICON,
  type CalendarEvent,
} from './calendarEvents';
import {
  DroppableDay,
} from './dnd/calendarDnd';
import { CalendarEventRow, renderChip } from './CalendarEventRow';
import { ProjectCalendarDayPanel } from './ProjectCalendarDayPanel';
import { ProjectCalendarDayView } from './ProjectCalendarDayView';
import { ProjectCalendarToolbar } from './ProjectCalendarToolbar';
import { ProjectCalendarUnscheduled } from './ProjectCalendarUnscheduled';
import { useProjectCalendarData } from './useProjectCalendarData';

type Props = {
  projectId: string;
  findings: Finding[];
};

export function ProjectCalendarTab({ projectId, findings }: Props): JSX.Element {
  const {
    t,
    locale,
    view,
    viewDate,
    setViewDate,
    kindFilters,
    selectedDay,
    setSelectedDay,
    unscheduledOpen,
    setUnscheduledOpen,
    selectedFinding,
    setSelectedFinding,
    filingDeadline,
    setFilingDeadline,
    activeEvent,
    today,
    events,
    kindCounts,
    itemsByDay,
    overdueDays,
    unscheduled,
    selectedDate,
    dayEvents,
    weekDays,
    dayKey,
    dayViewEvents,
    dayHoliday,
    holidaysByDay,
    isLoading,
    isCurrentPeriod,
    periodLabel,
    navLabels,
    draggingDatedFinding,
    toggleKind,
    changeView,
    stepBy,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  } = useProjectCalendarData(projectId, findings);

  // 'panel' = right-rail; 'dialog' = expanded into the centered modal. Only the
  // expand button flips it to 'dialog'; closing the dialog resets it to 'panel'.
  const [detailMode, setDetailMode] = useState<'panel' | 'dialog'>('panel');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const renderRow = (event: CalendarEvent, draggable = false): ReactNode => (
    <CalendarEventRow
      event={event}
      draggable={draggable}
      t={t}
      locale={locale}
      projectId={projectId}
      onSelectFinding={setSelectedFinding}
      onSelectFilingDeadline={setFilingDeadline}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: view switcher + period navigation + kind filters + legend */}
      <ProjectCalendarToolbar
        t={t}
        view={view}
        changeView={changeView}
        navLabels={navLabels}
        stepBy={stepBy}
        periodLabel={periodLabel}
        isCurrentPeriod={isCurrentPeriod}
        onToday={() => { setViewDate(today); }}
        kindFilters={kindFilters}
        kindCounts={kindCounts}
        toggleKind={toggleKind}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Body: active view (month grid / week columns / day agenda) + panel */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-5">
            {view === 'month' && events.length === 0 && !isLoading && (
              <p className="mb-3 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center text-body3 text-foreground-tertiary">
                {t('empty')}
              </p>
            )}

            {view === 'month' && (
              <MonthCalendar<CalendarEvent>
                className="min-h-0 flex-1"
                viewDate={viewDate}
                today={today}
                locale={locale}
                itemsByDay={itemsByDay}
                getItemId={(event) => event.id}
                renderChip={renderChip}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                moreLabel={(count) => t('moreCount', { count })}
                holidaysByDay={holidaysByDay}
                overdueDays={overdueDays}
                wrapDay={(iso, cell) => <DroppableDay iso={iso}>{cell}</DroppableDay>}
              />
            )}

            {view === 'week' && (
              <WeekCalendar<CalendarEvent>
                className="flex-1"
                days={weekDays}
                locale={locale}
                itemsByDay={itemsByDay}
                getItemId={(event) => event.id}
                renderItem={(event) => renderRow(event, true)}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                holidaysByDay={holidaysByDay}
                overdueDays={overdueDays}
                wrapDay={(iso, column) => <DroppableDay iso={iso}>{column}</DroppableDay>}
              />
            )}

            {view === 'day' && (
              <ProjectCalendarDayView
                t={t}
                locale={locale}
                viewDate={viewDate}
                dayKey={dayKey}
                dayViewEvents={dayViewEvents}
                dayHoliday={dayHoliday}
                renderRow={(event) => renderRow(event, true)}
              />
            )}
          </div>

          {view === 'month' && selectedDay !== null && selectedDate !== null && selectedFinding === null && (
            <ProjectCalendarDayPanel
              t={t}
              locale={locale}
              selectedDate={selectedDate}
              dayEvents={dayEvents}
              onClose={() => { setSelectedDay(null); }}
              renderRow={(event) => renderRow(event, true)}
            />
          )}

          {detailMode === 'panel' && (
            <FindingDetailPanel
              projectId={projectId}
              finding={selectedFinding}
              onClose={() => { setSelectedFinding(null); }}
              onExpand={() => { setDetailMode('dialog'); }}
            />
          )}
        </div>

        {/* Unscheduled: items with no date (mostly findings without a deadline).
            Drop a calendar item here to clear its date. Stays mounted while a
            dated finding is being dragged so it can act as the drop target. */}
        {(unscheduled.length > 0 || draggingDatedFinding) && (
          <ProjectCalendarUnscheduled
            t={t}
            unscheduled={unscheduled}
            draggingDatedFinding={draggingDatedFinding}
            unscheduledOpen={unscheduledOpen}
            onToggleOpen={() => { setUnscheduledOpen((v) => !v); }}
            renderRow={(event) => renderRow(event, true)}
          />
        )}

        <DragOverlay dropAnimation={null}>
          {activeEvent !== null && (
            <div className="rounded-md border border-primary bg-background px-2 py-1 shadow-lg ring-2 ring-primary/30">
              <CalendarEventChip
                tone={activeEvent.tone}
                icon={KIND_ICON[activeEvent.kind]}
                title={activeEvent.title}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {filingDeadline !== null && (
        <FilingDialog
          open
          onOpenChange={(open) => { if (!open) setFilingDeadline(null); }}
          projectId={projectId}
          deadline={filingDeadline.deadline}
          label={filingDeadline.label}
        />
      )}

      <FindingDetailModal
        projectId={projectId}
        finding={detailMode === 'dialog' ? selectedFinding : null}
        open={detailMode === 'dialog' && selectedFinding !== null}
        onOpenChange={(o) => { if (!o) { setSelectedFinding(null); setDetailMode('panel'); } }}
      />
    </div>
  );
}
