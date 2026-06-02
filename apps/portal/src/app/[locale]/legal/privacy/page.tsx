import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { getLegalContent, type Locale } from '@bimstitch/i18n';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function PrivacyPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  const { privacy } = getLegalContent(locale as Locale);

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="m-0 font-sans text-[32px] font-medium leading-tight tracking-tight text-foreground">
          {privacy.title}
        </h1>
        <p className="font-sans text-[11px] uppercase tracking-[0.10em] text-foreground-tertiary">
          {t('lastUpdated', { date: privacy.lastUpdated })}
        </p>
        <p className="text-[15px] leading-relaxed text-foreground-secondary">{privacy.intro}</p>
      </header>

      {privacy.sections.map((section) => (
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
