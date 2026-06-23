import type { JSX, ReactNode } from 'react';

import { ColorInput, Slider, Switch } from '@bimstitch/ui';

export function Section({ title, note, children }: {
  title: string;
  note?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between">
        <h3 className="text-caption font-medium text-foreground">{title}</h3>
        {note !== undefined && <span className="text-caption text-foreground-secondary">{note}</span>}
      </header>
      {/* Two columns pack the wide dialog; `[&>p]:col-span-2` lets description
          paragraphs span the full width with no per-call-site edit. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 [&>p]:col-span-2">{children}</div>
    </section>
  );
}

export function Field({ label, children, fullWidth = false }: {
  label: string;
  children: ReactNode;
  fullWidth?: boolean;
}): JSX.Element {
  return (
    <label className={`flex items-center justify-between gap-3 text-body3 text-foreground-secondary${fullWidth ? ' col-span-2' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Toggle({ label, checked, onChange, fullWidth = false }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  fullWidth?: boolean;
}): JSX.Element {
  return (
    <div className={`flex cursor-pointer items-center justify-between gap-3 text-body3 text-foreground-secondary${fullWidth ? ' col-span-2' : ''}`}>
      <span>{label}</span>
      <Switch
        checked={checked}
        onChange={(e) => { onChange(e.target.checked); }}
      />
    </div>
  );
}

export function RangeField({ label, value, min, max, step, format, onChange, fullWidth = false }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  fullWidth?: boolean;
}): JSX.Element {
  return (
    <label className={`flex items-center justify-between gap-3 text-body3 text-foreground-secondary${fullWidth ? ' col-span-2' : ''}`}>
      <span className="shrink-0">{label}</span>
      <span className="flex items-center gap-2">
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={format(value)}
          onChange={(e) => { onChange(Number(e.target.value)); }}
          className="w-24"
        />
        <span className="w-10 text-right tabular-nums">{format(value)}</span>
      </span>
    </label>
  );
}

export function ColorField({ label, value, onChange, fullWidth = false }: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  fullWidth?: boolean;
}): JSX.Element {
  return (
    <Field label={label} fullWidth={fullWidth}>
      <ColorInput
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
      />
    </Field>
  );
}
