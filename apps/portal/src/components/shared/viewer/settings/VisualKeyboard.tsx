'use client';

import { type CSSProperties, type JSX } from 'react';

import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@bimstitch/ui';

import {
  CATEGORY_STYLES,
  UNBOUND_STYLE,
  type CategoryStyle,
} from './shortcutCategories';
import { FROW_GAP, KEYBOARD_ROWS, KEY_GAP, KEY_UNIT, codeToComboKey, type KeyDef } from './keyboardLayout';
import type { NormalizedBinding } from './types';

type Props = {
  bindings: NormalizedBinding[];
  capturing: string | null;
  onCaptureStart: (command: string) => void;
  selectedCode: string | null;
  onPick: (code: string) => void;
};

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock',
]);

function unitPx(u: number): number {
  return KEY_UNIT * u + (u - 1) * KEY_GAP;
}

function findBindingForKey(
  key: KeyDef,
  bindings: NormalizedBinding[],
): NormalizedBinding | null {
  if (key.isSpacer || !key.code) return null;
  const comboKey = codeToComboKey(key.code);
  return bindings.find((b) => {
    const parts = b.combo.split('+');
    const mainKey = parts[parts.length - 1];
    return mainKey === comboKey && parts.length === 1;
  }) ?? null;
}

function getStyle(key: KeyDef, binding: NormalizedBinding | null): CategoryStyle {
  if (key.isModifier) return CATEGORY_STYLES.modifier;
  if (!binding) return UNBOUND_STYLE;
  return CATEGORY_STYLES[binding.category];
}

function Led({ on }: { on: boolean }): JSX.Element {
  return (
    <span style={{
      width: 5, height: 5, borderRadius: '50%',
      background: on ? '#e83e34' : '#3a3530',
      boxShadow: on ? '0 0 5px rgba(232,62,52,0.9)' : 'inset 0 0 2px #000',
    }} />
  );
}

function TopPanel(): JSX.Element {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '6px 12px',
      background: '#1c1a16',
      borderRadius: 6,
      border: '1px solid #0d0c0a',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.4)',
      marginBottom: 8,
    }}>
      <div style={{
        fontSize: 16, fontWeight: 800, letterSpacing: -0.5,
        fontFamily: 'var(--font-sans)',
        color: '#f4eee0', lineHeight: 1, fontStyle: 'italic',
      }}>
        BimStitch<span style={{ position: 'relative', top: -6, fontSize: 10 }}>&deg;</span>
      </div>
      <div style={{
        fontSize: 9, letterSpacing: 2, color: '#f4eee0',
        fontFamily: 'var(--font-sans)', fontWeight: 700, opacity: 0.5,
      }}>
        KEYBOARD
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 140, height: 24,
          backgroundImage: 'repeating-linear-gradient(90deg, #4a4640 0, #4a4640 3px, #1c1a16 3px, #1c1a16 6px)',
          borderRadius: 2,
          opacity: 0.7,
        }} />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Led on={false} /><Led on /><Led on={false} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 9, letterSpacing: 1.6, fontWeight: 700, color: '#e3dccb' }}>
          POWER
        </span>
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, #ff8a82, #e83e34 60%, #8a1a14 100%)',
          boxShadow: '0 0 6px #e83e34, 0 0 14px rgba(232,62,52,0.6)',
        }} />
      </div>
    </div>
  );
}

function Keycap({
  code, label, widthU, isMod, binding, isSelected, cat, onPick,
}: {
  code: string;
  label: string;
  widthU: number;
  isMod: boolean;
  binding: NormalizedBinding | null;
  isSelected: boolean;
  cat: CategoryStyle;
  onPick: (code: string) => void;
}): JSX.Element {
  const w = unitPx(widthU);
  const isLong = label.length >= 4;
  const isMedium = label.length >= 2 && label.length <= 3;
  const hasBind = binding !== null || isMod;

  let faceTop: string, faceBot: string, skirtTop: string, skirtBot: string, legendCol: string;
  if (isMod || MODIFIER_CODES.has(code)) {
    faceTop = '#4a4a4a'; faceBot = '#3a3a3a';
    skirtTop = '#2a2a2a'; skirtBot = '#1c1c1c';
    legendCol = '#e8e8e8';
  } else {
    faceTop = '#5a5a5a'; faceBot = '#484848';
    skirtTop = '#333333'; skirtBot = '#222222';
    legendCol = '#f0f0f0';
  }

  const ringCol = isSelected && hasBind ? cat.swatch : 'transparent';

  const btnStyle: CSSProperties = {
    position: 'relative',
    width: w, height: 37,
    padding: 0, border: 'none', background: 'transparent',
    cursor: hasBind ? 'pointer' : 'default',
    outline: 'none', flexShrink: 0,
    fontFamily: 'var(--font-sans)',
  };

  return (
    <button type="button" onClick={() => { onPick(code); }} title={binding ? binding.label : label} style={btnStyle}>
      {/* Skirt */}
      <span style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, ${skirtTop} 0%, ${skirtBot} 100%)`,
        borderRadius: '6px 6px 5px 5px',
        boxShadow: `
          inset 0 1px 0 rgba(255,255,255,0.22),
          inset 0 -1px 0 rgba(0,0,0,0.30),
          0 2px 0 rgba(0,0,0,0.18),
          0 3px 5px rgba(28,26,22,0.20)
        `,
      }} />

      {/* Category stripe */}
      {binding && (
        <span style={{
          position: 'absolute', left: 4, right: 4, bottom: 1, height: 2,
          background: cat.swatch, borderRadius: 2, opacity: 0.95,
          boxShadow: `0 0 4px ${cat.swatch}`,
        }} />
      )}

      {/* Face */}
      <span className="keycap-face" style={{
        position: 'absolute', left: 2, right: 2, top: 1, bottom: 6,
        background: `linear-gradient(180deg, ${faceTop} 0%, ${faceBot} 100%)`,
        borderRadius: '5px 5px 3px 3px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(0,0,0,0.10)',
        transition: 'transform 0.12s ease',
      }} />

      {/* Dish highlight */}
      <span style={{
        position: 'absolute', left: 4, right: 4, top: 2, height: 4,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0))',
        borderRadius: '4px 4px 0 0',
        pointerEvents: 'none',
      }} />

      {/* Legend */}
      <span style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 0 5px',
        color: legendCol, fontWeight: 700,
        fontSize: isLong ? 8 : isMedium ? 10 : 12,
        letterSpacing: isLong ? 0.4 : 0.5,
        lineHeight: 1, pointerEvents: 'none', textTransform: 'uppercase',
        textShadow: 'none',
      }}>
        {label}
      </span>

      {/* Selected ring */}
      {isSelected && hasBind && (
        <span className="kbd-pulse-ring" style={{
          position: 'absolute', inset: -4,
          borderRadius: 9,
          border: `2px dashed ${ringCol}`,
          pointerEvents: 'none',
        }} />
      )}
    </button>
  );
}

function Spacer({ widthU }: { widthU: number }): JSX.Element {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: unitPx(widthU), height: 37, flexShrink: 0 }} />;
}

export function VisualKeyboard({
  bindings, capturing, onCaptureStart, selectedCode, onPick,
}: Props): JSX.Element {
  // Keep onCaptureStart accessible — it is used by the parent via keyboard pick + rebind button.
  void capturing;
  void onCaptureStart;

  return (
    <TooltipProvider delayDuration={200}>
      <style>{`
        @keyframes kbd-pulse-anim {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 0.3; }
        }
        .kbd-pulse-ring { animation: kbd-pulse-anim 1.6s ease-out infinite; }
        button:hover .keycap-face { transform: translateY(-0.5px); }
      `}</style>

      <div style={{
        position: 'relative',
        padding: '10px 12px 14px',
        borderRadius: 10,
        background: 'linear-gradient(180deg, #d8d8d8 0%, #c4c4c4 100%)',
        boxShadow: `
          inset 0 1px 0 rgba(255,255,255,0.85),
          inset 0 -1px 0 rgba(0,0,0,0.20),
          inset 2px 0 0 rgba(0,0,0,0.06),
          inset -2px 0 0 rgba(0,0,0,0.06),
          0 18px 36px -12px rgba(28,26,22,0.45),
          0 6px 14px -4px rgba(28,26,22,0.25),
          0 0 0 1px rgba(0,0,0,0.18)
        `,
        width: 'max-content',
      }}>
        <TopPanel />
        <div style={{ display: 'flex', flexDirection: 'column', gap: KEY_GAP }}>
          {KEYBOARD_ROWS.map((row, ri) => (
            <div key={String(ri)} style={{ display: 'flex', gap: KEY_GAP, marginTop: ri === 1 ? FROW_GAP : 0 }}>
              {row.map((keyDef, ki) => {
                if (keyDef.isSpacer) {
                  return <Spacer key={`sp-${String(ri)}-${String(ki)}`} widthU={keyDef.width ?? 1} />;
                }

                const binding = findBindingForKey(keyDef, bindings);
                const cat = getStyle(keyDef, binding);
                const isSel = selectedCode === keyDef.code;

                const cap = (
                  <Keycap
                    key={keyDef.code || `k-${String(ri)}-${String(ki)}`}
                    code={keyDef.code}
                    label={keyDef.label}
                    widthU={keyDef.width ?? 1}
                    isMod={keyDef.isModifier === true}
                    binding={binding}
                    isSelected={isSel}
                    cat={cat}
                    onPick={onPick}
                  />
                );

                if (binding) {
                  return (
                    <Tooltip key={keyDef.code}>
                      <TooltipTrigger asChild>{cap}</TooltipTrigger>
                      <TooltipContent side="top">{binding.label}</TooltipContent>
                    </Tooltip>
                  );
                }

                return cap;
              })}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
