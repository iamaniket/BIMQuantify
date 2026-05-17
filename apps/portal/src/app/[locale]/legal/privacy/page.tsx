import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function PrivacyPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  const sections = [
    { title: t('privacy.dataCollectedTitle'), body: t('privacy.dataCollectedBody') },
    { title: t('privacy.purposeTitle'), body: t('privacy.purposeBody') },
    { title: t('privacy.retentionTitle'), body: t('privacy.retentionBody') },
    { title: t('privacy.rightsTitle'), body: t('privacy.rightsBody') },
    { title: t('privacy.hostingTitle'), body: t('privacy.hostingBody') },
  ];

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="m-0 font-display text-[32px] font-medium leading-tight tracking-tight text-foreground">
          {t('privacy.title')}
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.10em] text-foreground-tertiary">
          {t('lastUpdated', { date: '2026-05-10' })}
        </p>
        <p className="text-[15px] leading-relaxed text-foreground-secondary">{t('privacy.intro')}</p>
      </header>

      {sections.map(({ title, body }) => (
        <section key={title} className="space-y-2">
          <h2 className="font-display text-[18px] font-semibold leading-tight tracking-tight text-foreground">
            {title}
          </h2>
          <p className="text-[14.5px] leading-relaxed text-foreground-secondary">{body}</p>
        </section>
      ))}
    </article>
  );
}
