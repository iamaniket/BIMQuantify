'use client';

import { Building2, Globe2, GraduationCap, Mail, User } from '@bimstitch/ui/icons';
import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react';

import { Button, Checkbox, FormField, Input, Select, Textarea } from '@bimstitch/ui';

/** Domains the design and the API agree should be rejected as free email. */
const FREE_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.nl', 'outlook.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'protonmail.com', 'proton.me', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net',
  'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'fastmail.com',
  'tutanota.com', 'tutanota.de', 'hey.com', 'ymail.com', 'rocketmail.com',
  'web.de', 't-online.de', 'orange.fr', 'wanadoo.fr', 'free.fr',
  'ziggo.nl', 'kpnmail.nl', 'planet.nl', 'home.nl', 'xs4all.nl',
]);

const ROLES = [
  'Wet kwaliteitsborging voor het bouwen (Wkb)-inspecteur (kwaliteitsborger)',
  'BIM Manager / BIM-coördinator',
  'Project Manager / Werkvoorbereider',
  'Architect',
  'Constructeur',
  'Aannemer / Hoofdaannemer',
  'Opdrachtgever / Ontwikkelaar',
  'Other',
] as const;

const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const;

const COUNTRIES: ReadonlyArray<readonly [string, string]> = [
  ['NL', 'Netherlands'],
  ['BE', 'Belgium'],
  ['DE', 'Germany'],
  ['LU', 'Luxembourg'],
  ['FR', 'France'],
  ['DK', 'Denmark'],
  ['SE', 'Sweden'],
  ['NO', 'Norway'],
  ['UK', 'United Kingdom'],
  ['IE', 'Ireland'],
  ['OT', 'Other / EU'],
];

/**
 * Optional pilot-qualification questions. Each entry carries the UI `label`
 * and a short `notesLabel` used when folding the answer into the access
 * request's free-text `notes` (see `composeAccessRequestNotes`).
 */
const TIMELINE_OPTIONS = [
  { value: 'asap', label: 'As soon as possible', notesLabel: 'As soon as possible' },
  { value: '1-3m', label: 'Within 1–3 months', notesLabel: 'Within 1–3 months' },
  { value: '3-6m', label: 'In 3–6 months', notesLabel: 'In 3–6 months' },
  { value: 'exploring', label: 'Just exploring', notesLabel: 'Just exploring' },
] as const;

const VOLUME_OPTIONS = [
  { value: '1-5', label: '1–5', notesLabel: '1–5' },
  { value: '6-20', label: '6–20', notesLabel: '6–20' },
  { value: '21-50', label: '21–50', notesLabel: '21–50' },
  { value: '50+', label: '50+', notesLabel: '50+' },
] as const;

const COMMITMENT_OPTIONS = [
  { value: 'yes', label: 'Yes, ready to go', notesLabel: 'Yes, ready to go' },
  { value: 'maybe', label: 'Maybe', notesLabel: 'Maybe' },
  { value: 'no', label: 'Not yet', notesLabel: 'Not yet' },
] as const;

export interface RequestAccessValues {
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  country: string;
  /** When they'd want to start the pilot — optional. */
  timeline: string;
  /** Projects per year — optional. */
  project_volume: string;
  /** Whether a live project is ready for the pilot — optional. */
  live_commitment: string;
  notes: string;
  terms_accepted: boolean;
}

/**
 * Folds the optional pilot answers and the free-text goal into a single
 * `notes` blob for the access-request API — storage is unstructured by
 * design (no dedicated columns). Returns `undefined` when nothing was filled
 * in, preserving the prior "empty notes → omit" behaviour.
 */
export function composeAccessRequestNotes(
  values: RequestAccessValues,
): string | undefined {
  const labelFor = (
    opts: ReadonlyArray<{ value: string; notesLabel: string }>,
    selected: string,
  ): string | undefined => opts.find((o) => o.value === selected)?.notesLabel;

  const lines: string[] = [];
  const timeline = labelFor(TIMELINE_OPTIONS, values.timeline);
  if (timeline !== undefined) lines.push(`Start: ${timeline}`);
  const volume = labelFor(VOLUME_OPTIONS, values.project_volume);
  if (volume !== undefined) lines.push(`Projects/year: ${volume}`);
  const commitment = labelFor(COMMITMENT_OPTIONS, values.live_commitment);
  if (commitment !== undefined) lines.push(`Live project: ${commitment}`);

  const goal = values.notes.trim();
  const structured = lines.length > 0 ? `— Pilot questions —\n${lines.join('\n')}` : '';
  const composed = [structured, goal].filter((s) => s !== '').join('\n\n');
  return composed === '' ? undefined : composed;
}

export interface RequestAccessFormProps {
  onSubmit: (values: RequestAccessValues) => Promise<void>;
  defaultCountry?: string | undefined;
  submitError?: string | undefined;
  signInHref?: string | undefined;
}

type Errors = Partial<Record<keyof RequestAccessValues, string>>;

function validate(values: RequestAccessValues): Errors {
  const errs: Errors = {};
  const name = values.name.trim();
  if (!name) errs.name = 'Required';
  else if (!/^[\p{L} '\-.]{2,}( +[\p{L} '\-.]{2,})+$/u.test(name)) {
    errs.name = 'Use your full name (first and last).';
  }

  const email = values.work_email.trim().toLowerCase();
  if (!email) errs.work_email = 'Required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errs.work_email = "That doesn't look like a valid email.";
  else {
    const parts = email.split('@');
    const domain = parts[1];
    if (domain !== undefined && FREE_DOMAINS.has(domain)) {
      errs.work_email = 'Please use your work email, not a personal address.';
    }
  }

  if (!values.company.trim()) errs.company = 'Required';
  else if (values.company.trim().length < 2) errs.company = 'Company name is too short.';

  if (!values.role) errs.role = 'Pick the closest match.';
  if (!values.company_size) errs.company_size = 'Required';
  if (!values.country) errs.country = 'Required';
  if (!values.terms_accepted) errs.terms_accepted = 'You must agree to continue.';

  return errs;
}

const INITIAL: RequestAccessValues = {
  name: '',
  work_email: '',
  company: '',
  role: '',
  company_size: '',
  country: 'NL',
  timeline: '',
  project_volume: '',
  live_commitment: '',
  notes: '',
  terms_accepted: false,
};

export function RequestAccessForm({
  onSubmit,
  defaultCountry = 'NL',
  submitError,
  signInHref = '/login',
}: RequestAccessFormProps): JSX.Element {
  const [values, setValues] = useState<RequestAccessValues>({ ...INITIAL, country: defaultCountry });
  const [touched, setTouched] = useState<Partial<Record<keyof RequestAccessValues, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);

  const errors = validate(values);
  const errFor = (k: keyof RequestAccessValues): string | undefined =>
    touched[k] ? errors[k] : undefined;

  const update = <K extends keyof RequestAccessValues>(key: K, value: RequestAccessValues[K]): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const blur = (key: keyof RequestAccessValues): void => {
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const onSubmitForm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const all: Partial<Record<keyof RequestAccessValues, boolean>> = {};
    (Object.keys(INITIAL) as Array<keyof RequestAccessValues>).forEach((k) => {
      all[k] = true;
    });
    setTouched(all);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmitForm} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Full name" required error={errFor('name')} className="col-span-2">
          <Input
            value={values.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('name', e.target.value)}
            onBlur={() => blur('name')}
            placeholder="Lieke Beumer"
            leading={<User size={14} />}
            invalid={errFor('name') !== undefined}
            autoComplete="name"
          />
        </FormField>

        <FormField
          label="Work email"
          required
          error={errFor('work_email')}
          hint={errFor('work_email') === undefined
            ? 'We send your pilot invite here. Free providers (gmail, hotmail, …) are blocked.'
            : undefined}
          className="col-span-2"
        >
          <Input
            type="email"
            value={values.work_email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('work_email', e.target.value)}
            onBlur={() => blur('work_email')}
            placeholder="you@company.nl"
            leading={<Mail size={14} />}
            invalid={errFor('work_email') !== undefined}
            autoComplete="email"
          />
        </FormField>

        <FormField label="Company" required error={errFor('company')} className="col-span-2">
          <Input
            value={values.company}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('company', e.target.value)}
            onBlur={() => blur('company')}
            placeholder="Heijmans Bouw N.V."
            leading={<Building2 size={14} />}
            invalid={errFor('company') !== undefined}
            autoComplete="organization"
          />
        </FormField>

        <FormField label="Your role" required error={errFor('role')}>
          <Select
            value={values.role}
            onChange={(e) => update('role', e.target.value)}
            onBlur={() => blur('role')}
            invalid={errFor('role') !== undefined}
          >
            <option value="">Select…</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Company size" required error={errFor('company_size')}>
          <Select
            value={values.company_size}
            onChange={(e) => update('company_size', e.target.value)}
            onBlur={() => blur('company_size')}
            invalid={errFor('company_size') !== undefined}
          >
            <option value="">Select…</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s} people
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Country" required error={errFor('country')} className="col-span-2">
          <Select
            value={values.country}
            onChange={(e) => update('country', e.target.value)}
            onBlur={() => blur('country')}
            invalid={errFor('country') !== undefined}
          >
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="col-span-2 mt-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-foreground-tertiary">
          A few quick questions{' '}
          <span className="font-medium normal-case tracking-normal text-foreground-disabled">
            (optional)
          </span>
        </div>

        <FormField label="When would you start?">
          <Select value={values.timeline} onChange={(e) => update('timeline', e.target.value)}>
            <option value="">Select…</option>
            {TIMELINE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Projects per year">
          <Select
            value={values.project_volume}
            onChange={(e) => update('project_volume', e.target.value)}
          >
            <option value="">Select…</option>
            {VOLUME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="A live project for the pilot?">
          <Select
            value={values.live_commitment}
            onChange={(e) => update('live_commitment', e.target.value)}
          >
            <option value="">Select…</option>
            {COMMITMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="What do you want to get out of the pilot?"
          className="col-span-2"
          hint="Optional: your biggest Wet kwaliteitsborging voor het bouwen (Wkb) challenge, what success looks like, etc."
        >
          <Textarea
            value={values.notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => update('notes', e.target.value)}
            placeholder="e.g. We run ~40 Wet kwaliteitsborging voor het bouwen (Wkb)-1 projects/yr and want faster federated IFC review and a clean dossier export."
            rows={3}
          />
        </FormField>
      </div>

      <label className="mt-1 flex cursor-pointer items-start gap-2.5 select-none">
        <Checkbox
          checked={values.terms_accepted}
          onChange={(e) => update('terms_accepted', e.target.checked)}
          onBlur={() => blur('terms_accepted')}
          className="mt-0.5"
        />
        <span className="text-[12px] leading-snug text-foreground-secondary">
          I agree that BimDossier may contact me about the pilot, and I accept the{' '}
          <a href="/legal/privacy" className="font-semibold text-primary no-underline">
            Privacy notice
          </a>{' '}
          and{' '}
          <a href="/legal/terms" className="font-semibold text-primary no-underline">
            Terms
          </a>
          .
        </span>
      </label>
      {errFor('terms_accepted') !== undefined ? (
        <div role="alert" className="text-[10.5px] text-error">
          {errFor('terms_accepted')}
        </div>
      ) : null}

      {submitError !== undefined ? (
        <div role="alert" className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-[12.5px] text-error">
          {submitError}
        </div>
      ) : null}

      <Button type="submit" variant="primary" size="md" disabled={submitting} className="mt-1">
        {submitting ? 'Submitting your application…' : 'Apply to join the pilot'}
      </Button>

      <div className="mt-1 text-center text-[11.5px] text-foreground-tertiary">
        Already on BimDossier?{' '}
        <a href={signInHref} className="font-semibold text-primary no-underline">
          Sign in →
        </a>
      </div>
    </form>
  );
}

// Re-exported so consumers can show the same iconography in their hero copy
// without re-importing lucide.
export const RequestAccessIcons = { User, Mail, Building2, Globe2, GraduationCap };
