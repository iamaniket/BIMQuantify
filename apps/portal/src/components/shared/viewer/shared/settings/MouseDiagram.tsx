'use client';

import { useState, type JSX } from 'react';

import { CATEGORY_STYLES } from './shortcutCategories';
import type { ShortcutCategory } from './types';

type MouseZone = {
  label: string;
  sublabel: string | undefined;
  category?: ShortcutCategory;
};

type Props = {
  leftButton: MouseZone;
  middleButton: MouseZone;
  rightButton: MouseZone;
  scrollWheel: string;
  selected?: string | null;
  onPick?: (id: string) => void;
};

type Slot = {
  id: string;
  label: string;
  side: 'L' | 'R';
  anchor: { x: number; y: number };
  callout: { x: number; y: number };
  zone: MouseZone;
};

const STAGE_W = 700;
const STAGE_H = 420;
const MOUSE_X = 280;
const MOUSE_Y = 20;
const MOUSE_W = 200;
const MOUSE_H = 340;
const CALLOUT_W = 170;
const CALLOUT_H = 52;

export function MouseDiagram({
  leftButton, middleButton, rightButton, scrollWheel,
  selected: selectedProp, onPick,
}: Props): JSX.Element {
  const [hovered, setHovered] = useState<string | null>(null);
  const selected = selectedProp ?? null;

  const slots: Slot[] = [
    { id: 'mouse-left', label: 'Left Click', side: 'L', anchor: { x: 345, y: 100 }, callout: { x: 15, y: 130 }, zone: leftButton },
    { id: 'mouse-middle', label: 'Scroll Wheel', side: 'R', anchor: { x: 385, y: 80 }, callout: { x: 515, y: 70 }, zone: middleButton },
    { id: 'mouse-right', label: 'Right Click', side: 'R', anchor: { x: 425, y: 100 }, callout: { x: 515, y: 220 }, zone: rightButton },
  ];

  function catFor(zone: MouseZone) {
    if (zone.category) return CATEGORY_STYLES[zone.category];
    return CATEGORY_STYLES.navigation;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-caption font-medium text-foreground-secondary">{scrollWheel}</span>

      <div className="overflow-x-auto">
        <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H }}>
          {/* Leader lines */}
          <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} width={STAGE_W} height={STAGE_H}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {slots.map((s) => {
              const cat = catFor(s.zone);
              const isActive = selected === s.id || hovered === s.id;
              const onRight = s.side === 'R';
              const calloutX = onRight ? s.callout.x : s.callout.x + CALLOUT_W;
              const calloutY = s.callout.y + CALLOUT_H / 2;
              const midX = (s.anchor.x + calloutX) / 2;
              return (
                <path
                  key={`line-${s.id}`}
                  d={`M ${calloutX} ${calloutY} C ${midX} ${calloutY}, ${midX} ${s.anchor.y}, ${s.anchor.x} ${s.anchor.y}`}
                  fill="none"
                  stroke={isActive ? cat.swatch : 'var(--border)'}
                  strokeWidth={isActive ? 1.5 : 1}
                  strokeDasharray={isActive ? '' : '3 3'}
                  style={{ transition: 'stroke 0.18s ease' }}
                />
              );
            })}
          </svg>

          {/* Mouse SVG */}
          <svg viewBox="0 0 200 340" width={MOUSE_W} height={MOUSE_H}
            style={{ position: 'absolute', left: MOUSE_X, top: MOUSE_Y, display: 'block', overflow: 'visible' }}>
            <defs>
              <linearGradient id="mouseShell" x1="0.5" y1="0" x2="0.5" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.55" stopColor="#f1f2f5" />
                <stop offset="1" stopColor="#d6d9df" />
              </linearGradient>
              <radialGradient id="mouseHilite" cx="0.5" cy="0.15" r="0.55">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.15" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="mousePalm" cx="0.5" cy="0.95" r="0.55">
                <stop offset="0" stopColor="#000000" stopOpacity="0.12" />
                <stop offset="1" stopColor="#000000" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="wheelGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#6b7280" />
                <stop offset="0.5" stopColor="#cbd1da" />
                <stop offset="1" stopColor="#6b7280" />
              </linearGradient>
              <filter id="mouseSh" x="-25%" y="-10%" width="150%" height="140%">
                <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#0f172a" floodOpacity="0.18" />
              </filter>
            </defs>

            <ellipse cx="100" cy="332" rx="80" ry="5" fill="rgba(15,23,42,0.10)" />

            <g filter="url(#mouseSh)">
              <path d="M 100 8 C 70 8, 47 18, 33 47 C 22 84, 15 135, 15 185 C 15 235, 30 287, 62 302 C 83 312, 117 312, 138 302 C 170 287, 185 235, 185 185 C 185 135, 178 84, 167 47 C 153 18, 130 8, 100 8 Z"
                fill="url(#mouseShell)" stroke="#c2c6cd" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M 100 8 C 70 8, 47 18, 33 47 C 22 84, 15 135, 15 185 C 15 235, 30 287, 62 302 C 83 312, 117 312, 138 302 C 170 287, 185 235, 185 185 C 185 135, 178 84, 167 47 C 153 18, 130 8, 100 8 Z"
                fill="url(#mouseHilite)" />
              <path d="M 100 8 C 70 8, 47 18, 33 47 C 22 84, 15 135, 15 185 C 15 235, 30 287, 62 302 C 83 312, 117 312, 138 302 C 170 287, 185 235, 185 185 C 185 135, 178 84, 167 47 C 153 18, 130 8, 100 8 Z"
                fill="url(#mousePalm)" />

              {/* Vertical seam */}
              <path d="M 100 10 L 100 35" fill="none" stroke="#b7bcc4" strokeWidth="1" strokeLinecap="round" />
              <path d="M 100 96 L 100 148" fill="none" stroke="#b7bcc4" strokeWidth="1" strokeLinecap="round" />

              {/* Horizontal seam */}
              <path d="M 30 130 C 55 148, 82 154, 100 154 C 118 154, 145 148, 170 130"
                fill="none" stroke="#c2c6cd" strokeWidth="1" />
              <path d="M 30 128 C 55 146, 82 152, 100 152 C 118 152, 145 146, 170 128"
                fill="none" stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.7" />

              {/* Scroll wheel */}
              <rect x="90" y="34" width="20" height="64" rx="10" fill="#9aa0aa" />
              <rect x="92" y="36" width="16" height="60" rx="8" fill="#3f4651" />
              <rect x="94" y="38" width="12" height="56" rx="6" fill="url(#wheelGrad)" />
              <g stroke="#2f3540" strokeWidth="0.5" opacity="0.5">
                {[42, 48, 54, 60, 66, 72, 78, 84, 90].map((y) => (
                  <line key={y} x1="94" y1={y} x2="106" y2={y} />
                ))}
              </g>
              <line x1="100" y1="40" x2="100" y2="92" stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.55" />

              {/* Wordmark */}
              <text x="100" y="240" textAnchor="middle"
                style={{ fontFamily: 'var(--font-sans, monospace)', fontSize: 6, fill: '#a7adb6', letterSpacing: 2, fontWeight: 600 }}>
                BIMDOSSIER
              </text>
            </g>
          </svg>

          {/* Anchor dots */}
          {slots.map((s) => {
            const cat = catFor(s.zone);
            const isActive = selected === s.id || hovered === s.id;
            return (
              <button
                key={`dot-${s.id}`}
                type="button"
                onMouseEnter={() => { setHovered(s.id); }}
                onMouseLeave={() => { setHovered(null); }}
                onClick={() => { onPick?.(s.id); }}
                aria-label={s.label}
                style={{
                  position: 'absolute',
                  left: s.anchor.x - 7, top: s.anchor.y - 7,
                  width: 14, height: 14, borderRadius: '50%', border: 'none',
                  cursor: 'pointer', transition: 'box-shadow 0.18s ease',
                  background: cat.swatch,
                  boxShadow: isActive
                    ? `0 0 0 4px ${cat.tint}, 0 0 0 5px ${cat.swatch}`
                    : '0 0 0 3px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.3)',
                }}
              />
            );
          })}

          {/* Callout cards */}
          {slots.map((s) => {
            const cat = catFor(s.zone);
            const isActive = selected === s.id;
            return (
              <div
                key={`card-${s.id}`}
                role="button"
                tabIndex={0}
                onMouseEnter={() => { setHovered(s.id); }}
                onMouseLeave={() => { setHovered(null); }}
                onClick={() => { onPick?.(s.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter') onPick?.(s.id); }}
                className="cursor-pointer rounded-lg border transition-all"
                style={{
                  position: 'absolute',
                  left: s.callout.x, top: s.callout.y,
                  width: CALLOUT_W, height: CALLOUT_H,
                  padding: '6px 12px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  textAlign: s.side === 'L' ? 'right' : 'left',
                  borderColor: isActive ? cat.swatch : 'var(--border)',
                  background: isActive ? cat.tint : 'var(--surface-main)',
                  boxShadow: isActive
                    ? '0 2px 8px rgba(0,0,0,0.08)'
                    : '0 1px 3px rgba(0,0,0,0.06)',
                }}
              >
                <div className="text-caption font-bold uppercase tracking-wider text-foreground-tertiary">
                  {s.label}
                </div>
                <div className="mt-0.5 text-body3 font-semibold leading-tight text-foreground">
                  {s.zone.sublabel ?? s.zone.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
