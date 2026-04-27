import { Boxes, FileSearch, Sparkles } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import { Button } from '@bimstitch/ui';

const portalUrl = process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001';

type Feature = {
  icon: ReactNode;
  title: string;
  body: string;
};

const features: Feature[] = [
  {
    icon: <Boxes className="h-6 w-6" aria-hidden />,
    title: 'IFC parsing',
    body: 'Stream large IFC models directly in the browser, with structured access to every entity and property.',
  },
  {
    icon: <FileSearch className="h-6 w-6" aria-hidden />,
    title: 'BCF workflows',
    body: 'Open, edit and round-trip BCF issues alongside the model, so coordination notes never lose their context.',
  },
  {
    icon: <Sparkles className="h-6 w-6" aria-hidden />,
    title: 'AI takeoff',
    body: 'Let the model do the counting. Quantities, areas and volumes pulled from the IFC, ready for export.',
  },
];

export default function WelcomePage(): JSX.Element {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 py-16">
      <section className="flex flex-col items-start gap-6">
        <span className="rounded-full border border-border bg-background-secondary px-3 py-1 text-body3 text-foreground-tertiary">
          AI-assisted BIM takeoff
        </span>
        <h1 className="max-w-3xl text-h2 font-semibold text-foreground">
          Quantify BIM models in minutes, not days.
        </h1>
        <p className="max-w-2xl text-title3 text-foreground-secondary">
          BIMstitch reads IFC and BCF files, extracts structured quantities, and lets your team
          collaborate on takeoffs without leaving the model.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <a href={portalUrl}>
            <Button variant="primary" size="lg">
              Get started
            </Button>
          </a>
          <Button variant="ghost" size="lg" disabled>
            View demo
          </Button>
        </div>
      </section>

      <section
        aria-label="Capabilities"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        {features.map((feature) => (
          <article
            key={feature.title}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface-main p-6 shadow-sm transition-colors hover:border-border-hover"
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary-light text-primary">
              {feature.icon}
            </div>
            <h2 className="text-h6 font-semibold text-foreground">{feature.title}</h2>
            <p className="text-body2 text-foreground-tertiary">{feature.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
