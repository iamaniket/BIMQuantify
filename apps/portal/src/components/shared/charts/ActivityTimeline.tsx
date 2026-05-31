'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  Area,
  ComposedChart,
  ReferenceLine,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { buildCompletionSeries } from '@/features/projects/detail/dossierTemplate';
import type { JurisdictionDossierRequirement } from '@/lib/api/jurisdictions';
import type { ProjectActivityEntry } from '@/lib/api/schemas/activity';
import type { Attachment } from '@/lib/api/schemas/attachments';
import type { Certificate } from '@/lib/api/schemas/certificates';
import type { Deadline } from '@/lib/api/schemas/deadlines';

type Props = {
  attachments: Attachment[];
  certificates?: Certificate[];
  template: JurisdictionDossierRequirement[];
  activityEntries: ProjectActivityEntry[];
  deadlines?: Deadline[];
  height?: number;
};

const EVENT_COLOR: Record<string, string> = {
  upload: 'var(--primary)',
  scan: 'var(--success)',
  change: 'var(--warning)',
};

const DAY = 86_400_000;

type EventPoint = {
  t: number;
  y: number;
  action: string;
  actor: string | null;
  category: string;
};

export function ActivityTimeline({
  attachments,
  certificates = [],
  template,
  activityEntries,
  deadlines = [],
  height = 96,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.chartsPanel');
  const locale = useLocale();

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    // The element can briefly report 0 width while the surrounding flex layout
    // settles; poll until it has a real size. setTimeout is used rather than
    // requestAnimationFrame so this still resolves in headless render targets
    // where rAF is throttled and never fires.
    let attempts = 0;
    const measure = (): void => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) {
        setWidth(w);
      } else if (attempts < 100) {
        attempts += 1;
        timer = setTimeout(measure, 50);
      }
    };
    measure();

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    [locale],
  );

  const { lineData, events, markers, domain, hasData } = useMemo(() => {
    const completion = buildCompletionSeries(template, attachments, certificates);
    const now = Date.now();

    const eventTimes = activityEntries.map((e) => new Date(e.created_at).getTime());
    const candidateMins = [
      ...completion.map((p) => p.t),
      ...eventTimes,
    ].filter((n) => Number.isFinite(n));
    const minT = candidateMins.length > 0 ? Math.min(...candidateMins) : now - 14 * DAY;
    const maxT = now;

    const pctAt = (time: number): number => {
      let pct = 0;
      for (const p of completion) {
        if (p.t <= time) pct = p.pct;
        else break;
      }
      return pct;
    };

    const lastPct = completion.length > 0 ? completion[completion.length - 1]!.pct : 0;
    const line = [
      { t: minT, pct: 0 },
      ...completion.map((p) => ({ t: p.t, pct: p.pct })),
      { t: maxT, pct: lastPct },
    ];

    const evts: EventPoint[] = activityEntries.map((e) => {
      const time = new Date(e.created_at).getTime();
      return {
        t: time,
        y: pctAt(time),
        action: e.action,
        actor: e.actor_name,
        category: e.category,
      };
    });

    const mks = deadlines
      .filter((d) => d.due_date)
      .map((d) => new Date(d.due_date as string).getTime())
      .filter((n) => Number.isFinite(n) && n >= minT && n <= maxT);

    return {
      lineData: line,
      events: evts,
      markers: mks,
      domain: [minT, maxT] as [number, number],
      hasData: completion.length > 0 || evts.length > 0,
    };
  }, [attachments, certificates, template, activityEntries, deadlines]);

  if (!hasData) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-caption text-foreground-tertiary">{t('noActivity')}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full" style={{ height }}>
      {width > 0 && (
        <ComposedChart
          width={width}
          height={height}
          margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
        >
          <defs>
            <linearGradient id="completionFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            type="number"
            dataKey="t"
            domain={domain}
            scale="time"
            tickFormatter={(v: number) => dateFmt.format(v)}
            tick={{ fontSize: 10, fill: 'var(--foreground-tertiary)' }}
            stroke="var(--border)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis type="number" domain={[0, 100]} hide />
          {markers.map((m, i) => (
            <ReferenceLine key={i} x={m} stroke="var(--border)" strokeDasharray="3 3" />
          ))}
          <Area
            data={lineData}
            type="stepAfter"
            dataKey="pct"
            stroke="var(--primary)"
            strokeWidth={1.5}
            fill="url(#completionFill)"
            dot={false}
            isAnimationActive={false}
          />
          <Scatter
            data={events}
            dataKey="y"
            isAnimationActive={false}
            shape={(props) => {
              const { cx, cy, payload } = props as {
                cx?: number;
                cy?: number;
                payload?: EventPoint;
              };
              if (cx === undefined || cy === undefined || payload === undefined) {
                return <g />;
              }
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={EVENT_COLOR[payload.category] ?? 'var(--foreground-tertiary)'}
                />
              );
            }}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const point = payload.find((p) => {
                const ep = p.payload as EventPoint | undefined;
                return ep !== undefined && typeof ep.action === 'string';
              });
              if (!point) return null;
              const e = point.payload as EventPoint;
              return (
                <div className="rounded-md border border-border bg-background px-2.5 py-1.5 shadow-md">
                  <div className="text-body3 font-medium text-foreground">{e.action}</div>
                  <div className="text-caption text-foreground-tertiary">
                    {dateFmt.format(e.t)}
                    {e.actor ? ` · ${e.actor}` : ''}
                  </div>
                </div>
              );
            }}
          />
        </ComposedChart>
      )}
    </div>
  );
}
