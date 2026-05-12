'use client';

import { Building2, Globe2, GraduationCap, Mail, User } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react';

import { Button } from './Button.js';
import { FormField } from './FormField.js';
import { Input } from './Input.js';
import { Textarea } from './Textarea.js';

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
  'Wkb-inspecteur (kwaliteitsborger)',
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

export interface RequestAccessValues {
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  country: string;
  notes: string;
  terms_accepted: boolean;
}

export interface RequestAccessFormProps {
  onSubmit: (values: RequestAccessValues) => Promise<void>;
  defaultCountry?: string | undefined;
  /** Override error shown above the submit button (e.g. API error message). */
  submitError?: string | undefined;
  /**
   * Where the "Already on BimStitch? Sign in →" link points. Defaults to
   * a relative `/login` so the portal version works out of the box; the
   * marketing site overrides with the portal URL.
   */
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
      errs.work_email = 'Please use your work email — not a personal address.';
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
  notes: '',
  terms_accepted: false,
};

const selectClass =
  'w-full rounded-md border border-border bg-background text-foreground '
  + 'h-10 px-3 text-[14px] outline-none transition-colors '
  + 'focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'hover:border-border-hover';

/**
 * Validated lead-capture form for the marketing site. Submits in
 * client-side first (mirrors the server's free-email blocklist) so the user
 * gets immediate feedback; the API re-validates as the source of truth.
 *
 * Owns its own state — pass `onSubmit` to wire it to the API. Throws back
 * up are surfaced via the `submitError` prop.
 */
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
            ? 'We send the demo link here. Free providers (gmail, hotmail, …) are blocked.'
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
          <select
            value={values.role}
            onChange={(e) => update('role', e.target.value)}
            onBlur={() => blur('role')}
            className={selectClass}
          >
            <option value="">Select…</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Company size" required error={errFor('company_size')}>
          <select
            value={values.company_size}
            onChange={(e) => update('company_size', e.target.value)}
            onBlur={() => blur('company_size')}
            className={selectClass}
          >
            <option value="">Select…</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s} people
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Country" required error={errFor('country')} className="col-span-2">
          <select
            value={values.country}
            onChange={(e) => update('country', e.target.value)}
            onBlur={() => blur('country')}
            className={selectClass}
          >
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="What would you like to see in the demo?"
          className="col-span-2"
          hint="Optional — projects, Wkb workflow, BBL checks, IFC review, etc."
        >
          <Textarea
            value={values.notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => update('notes', e.target.value)}
            placeholder="e.g. We're a contractor running 40 Wkb-1 projects/yr — show us federated IFC review and the dossier export."
            rows={3}
          />
        </FormField>
      </div>

      <label className="mt-1 flex cursor-pointer items-start gap-2.5 select-none">
        <input
          type="checkbox"
          checked={values.terms_accepted}
          onChange={(e) => update('terms_accepted', e.target.checked)}
          onBlur={() => blur('terms_accepted')}
          className="mt-0.5 size-4 cursor-pointer accent-primary"
        />
        <span className="text-[12px] leading-snug text-foreground-secondary">
          I agree that BimStitch may contact me about this demo, and I accept the{' '}
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
        {submitting ? 'Sending your request…' : 'Request demo access'}
      </Button>

      <div className="mt-1 text-center text-[11.5px] text-foreground-tertiary">
        Already on BimStitch?{' '}
        <a href={signInHref} className="font-semibold text-primary no-underline">
          Sign in →
        </a>
      </div>
    </form>
  );
}

// Re-exported so consumers can show the same iconography in their hero copy
// if they want, without re-importing lucide.
export const RequestAccessIcons = { User, Mail, Building2, Globe2, GraduationCap };
