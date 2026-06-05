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
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Field({ label, children }: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex cursor-pointer items-center justify-between gap-3 text-body3 text-foreground-secondary">
      <span>{label}</span>
      <Switch
        checked={checked}
        onChange={(e) => { onChange(e.target.checked); }}
      />
    </div>
  );
}

export function RangeField({ label, value, min, max, step, format, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary">
      <span className="shrink-0">{label}</span>
      <span className="flex items-center gap-2">
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => { onChange(Number(e.target.value)); }}
          className="w-24"
        />
        <span className="w-10 text-right tabular-nums">{format(value)}</span>
      </span>
    </label>
  );
}

export function ColorField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}): JSX.Element {
  return (
    <Field label={label}>
      <ColorInput
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
      />
    </Field>
  );
}
