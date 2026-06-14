import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { getLegalContent, type Locale } from '@bimstitch/i18n';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function TermsPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  const { terms, meta } = getLegalContent(locale as Locale);

  return (
    <>
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        {meta.draftBanner}
      </div>
      <article className="space-y-8">
        <header className="space-y-3">
          <h1 className="m-0 font-sans text-[32px] font-medium leading-tight tracking-tight text-foreground">
            {terms.title}
          </h1>
          <p className="font-sans text-[11px] uppercase tracking-[0.10em] text-foreground-tertiary">
            {t('lastUpdated', { date: terms.lastUpdated })}
          </p>
          <p className="text-[15px] leading-relaxed text-foreground-secondary">{terms.intro}</p>
        </header>

        {terms.sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="font-sans text-[18px] font-semibold leading-tight tracking-tight text-foreground">
              {section.title}
            </h2>
            <p className="text-[14.5px] leading-relaxed text-foreground-secondary">{section.body}</p>
          </section>
        ))}
      </article>
    </>
  );
}
