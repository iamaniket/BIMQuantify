import type { JSX } from 'react';

import type { LegalDocument } from '@bimstitch/i18n';

type Props = {
  doc: LegalDocument;
  /** The package's `meta.lastUpdatedLabel` template, e.g. "Last updated: {date}". */
  lastUpdatedLabel: string;
  draftBanner?: string;
};

export function LegalArticle({ doc, lastUpdatedLabel, draftBanner }: Props): JSX.Element {
  const dateLabel = lastUpdatedLabel.replace('{date}', doc.lastUpdated);

  return (
    <div className="flex flex-col gap-6">
      {draftBanner ? (
        <div className="rounded-md border border-warning-light bg-warning-lighter px-4 py-3 text-body2 text-warning">
          {draftBanner}
        </div>
      ) : null}
      <article className="space-y-8">
        <header className="space-y-3">
          <h1 className="m-0 font-sans text-h4 font-medium leading-tight tracking-tight text-foreground">
            {doc.title}
          </h1>
          <p className="font-sans text-caption uppercase tracking-[0.10em] text-foreground-tertiary">
            {dateLabel}
          </p>
          <p className="text-body1 leading-relaxed text-foreground-secondary">{doc.intro}</p>
        </header>

        {doc.sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="font-sans text-title3 font-semibold leading-tight tracking-tight text-foreground">
              {section.title}
            </h2>
            <p className="text-body2 leading-relaxed text-foreground-secondary">{section.body}</p>
          </section>
        ))}
      </article>
    </div>
  );
}
