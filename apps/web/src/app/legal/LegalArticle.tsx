'use client';

import type { JSX } from 'react';

import type { LegalDocument } from '@bimstitch/i18n';

type Props = {
  doc: LegalDocument;
  lastUpdatedLabel: string;
};

export function LegalArticle({ doc, lastUpdatedLabel }: Props): JSX.Element {
  const dateLabel = lastUpdatedLabel.replace('{date}', doc.lastUpdated);

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="m-0 font-sans text-[32px] font-medium leading-tight tracking-tight text-foreground">
          {doc.title}
        </h1>
        <p className="font-sans text-[11px] uppercase tracking-[0.10em] text-foreground-tertiary">
          {dateLabel}
        </p>
        <p className="text-[15px] leading-relaxed text-foreground-secondary">{doc.intro}</p>
      </header>

      {doc.sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="font-sans text-[18px] font-semibold leading-tight tracking-tight text-foreground">
            {section.title}
          </h2>
          <p className="text-[14.5px] leading-relaxed text-foreground-secondary">{section.body}</p>
        </section>
      ))}
    </article>
  );
}
