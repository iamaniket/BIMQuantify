'use client';

import { CalendarDays, LayoutGrid } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { TabsContent } from '@bimstitch/ui';

import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { CalendarHero } from '@/features/calendar/CalendarHero';
import { CalendarOverviewTab } from '@/features/calendar/CalendarOverviewTab';
import { OrgCalendarTab } from '@/features/calendar/OrgCalendarTab';

export default function CalendarPage(): JSX.Element {
  const t = useTranslations('calendar');
  const [tab, setTab] = useState('overview');

  const panelHeading = {
    overview: { eyebrow: t('panel.overviewEyebrow'), title: t('panel.overviewTitle') },
    calendar: { eyebrow: t('panel.calendarEyebrow'), title: t('panel.calendarTitle') },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<CalendarHero />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        { value: 'calendar', label: t('tabs.calendar'), icon: <CalendarDays className="h-4 w-4" /> },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'calendar'}
    >
      <TabsContent value="overview" className="mt-0">
        <CalendarOverviewTab />
      </TabsContent>

      <TabsContent value="calendar" className="mt-0 h-full">
        <OrgCalendarTab />
      </TabsContent>
    </TabbedPageShell>
  );
}
