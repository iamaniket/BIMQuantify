'use client';

import {
  AuthShell,
  BrandMark,
  HeroGrid,
  LegalFooter,
  RequestAccessForm,
  RequestAccessSuccess,
  SystemStatusBadge,
  type RequestAccessValues,
} from '@bimstitch/brand';
import { NetherlandsMap, type MapMarker } from '@bimstitch/map';
import { useEffect, useState, type JSX } from 'react';

import { fetchProjectsMap, submitAccessRequest, WebApiError } from '@/lib/api';
import { env } from '@/lib/env';
import { formatApproxCount } from '@/lib/formatting/numbers';

type SubmittedState = {
  name: string;
  email: string;
  company: string;
};

export function RequestAccessClient(): JSX.Element {
  const [submitted, setSubmitted] = useState<SubmittedState | null>(null);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [markers, setMarkers] = useState<readonly MapMarker[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchProjectsMap()
      .then((points) => {
        if (cancelled) return;
        setMarkers(points.map((p): MapMarker => ({
          lat: p.lat,
          lng: p.lng,
          label: p.city,
          count: p.count,
        })));
      })
      .catch(() => {
        // Marketing page tolerates a missing API — just render an empty map.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (values: RequestAccessValues): Promise<void> => {
    setSubmitError(undefined);
    try {
      await submitAccessRequest({
        name: values.name,
        work_email: values.work_email,
        company: values.company,
        role: values.role,
        company_size: values.company_size,
        country: values.country,
        notes: values.notes === '' ? undefined : values.notes,
        terms_accepted: values.terms_accepted,
      });
      setSubmitted({ name: values.name, email: values.work_email, company: values.company });
    } catch (err) {
      if (err instanceof WebApiError) {
        if (err.status === 422) {
          setSubmitError(err.detail);
        } else if (err.status === 429) {
          setSubmitError('Too many requests from your network — please try again in an hour.');
        } else {
          setSubmitError(`We couldn't submit your request: ${err.detail}`);
        }
      } else {
        setSubmitError('We couldn’t reach the BimStitch API. Please try again in a moment.');
      }
    }
  };

  const totalProjects = markers.reduce((sum, m) => sum + (m.count ?? 1), 0);
  const signInHref = `${env.NEXT_PUBLIC_PORTAL_URL.replace(/\/$/, '')}/login`;

  return (
    <AuthShell
      brandPaneWidth="44%"
      brand={(
        <>
          <HeroGrid opacity={0.1} stroke="#ffffff" step={36} />

          <div className="relative flex items-center gap-3">
            <BrandMark size={38} tone="on-dark" />
            <div>
              <div className="font-sans text-[18px] font-semibold leading-tight tracking-tight text-white">
                BimStitch
              </div>
              <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.10em] text-white/60">
                Wkb-compliant BIM platform
              </div>
            </div>
          </div>

          <div className="relative mt-10 flex flex-1 flex-col items-stretch gap-8">
            <div>
              <div
                className="mb-3.5 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em]"
                style={{
                  color: 'var(--brand-accent-soft)',
                  background: 'color-mix(in srgb, var(--brand-accent) 16%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--brand-accent) 32%, transparent)',
                }}
              >
                <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: 'var(--brand-accent)' }} />
                Request a guided demo
              </div>

              <h1
                className="m-0 max-w-md font-sans text-[36px] font-medium leading-[1.06] tracking-tight text-white"
                style={{ textWrap: 'pretty' }}
              >
                See your <span className="italic" style={{ color: 'var(--brand-accent-ink)' }}>models</span>,{' '}
                <span className="italic" style={{ color: 'var(--brand-accent-ink)' }}>issues</span> and{' '}
                <span className="italic" style={{ color: 'var(--brand-accent-ink)' }}>dossier</span> stitched into one Wkb record.
              </h1>
              <p className="mt-3.5 max-w-md text-[13.5px] leading-snug text-white/70">
                Tell us a little about your team and we&rsquo;ll spin up
                a sandbox preloaded with sample Wkb projects, BBL
                libraries and a representative consumentendossier.
              </p>

              <ul className="mt-5 flex list-none flex-col gap-2.5 p-0">
                {[
                  'Federated IFC review with real Bouwbesluit checks',
                  'Wkb-1 risk dossier from kickoff to oplevering',
                  'Sandbox stays live for 14 days, no card required',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-[13px] leading-snug text-white/82">
                    <span
                      aria-hidden
                      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full"
                      style={{ background: 'color-mix(in srgb, var(--brand-accent) 22%, transparent)', color: 'var(--brand-accent-soft)' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Live NL map — height-driven so it scales with the viewport */}
            <div className="relative flex flex-1 items-center justify-end">
              <div className="relative">
                <NetherlandsMap
                  responsiveHeight="min(60vh, 600px)"
                  fill="var(--color-primary-light, #e5ecf6)"
                  markers={markers}
                  animatePulse
                  ariaLabel="Live BimStitch project locations across the Netherlands"
                  className="drop-shadow-[0_24px_48px_rgba(0,0,0,0.25)]"
                />
                {/* Always rendered with reserved space — visibility-toggled
                    so the map doesn't jump when the API call resolves. */}
                <div
                  className="mt-5 whitespace-nowrap text-right font-sans text-[15px] uppercase tracking-[0.10em] text-white/55"
                  style={{ visibility: markers.length > 0 ? 'visible' : 'hidden' }}
                  aria-hidden={markers.length === 0}
                >
                  {formatApproxCount(totalProjects)} projects ,{' '}
                  {formatApproxCount(markers.length)} cities
                </div>
              </div>
            </div>
          </div>

          <div className="relative mt-6">
            <LegalFooter tone="on-dark" />
          </div>
        </>
      )}
      topRight={(
        <>
          <SystemStatusBadge status="normal" region="Onboarding · EU-WEST · AMS01" tone="on-light" />
          <a href={signInHref} className="font-sans text-[11.5px] text-foreground-tertiary no-underline">
            ‹ Back to sign in
          </a>
        </>
      )}
      form={(
        submitted === null ? (
          <>
            <div className="mb-4">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
                Request access
              </div>
              <h2 className="m-0 font-sans text-[28px] font-medium leading-tight tracking-tight text-foreground">
                Get your BimStitch demo.
              </h2>
              <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
                Fill in the form with your work details — we&rsquo;ll review your request and send a
                personalised invite shortly.
              </p>
            </div>
            <RequestAccessForm
              onSubmit={onSubmit}
              submitError={submitError}
              defaultCountry="NL"
              signInHref={signInHref}
            />
          </>
        ) : (
          <RequestAccessSuccess
            name={submitted.name}
            email={submitted.email}
            company={submitted.company}
            onReset={() => { setSubmitted(null); }}
          />
        )
      )}
    />
  );
}
