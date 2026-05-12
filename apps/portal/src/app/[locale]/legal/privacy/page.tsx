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
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('privacy.title')}</h1>
        <p className="text-xs text-foreground-secondary">{t('lastUpdated', { date: '2026-05-10' })}</p>
        <p className="text-base text-foreground-secondary">{t('privacy.intro')}</p>
      </header>

      {sections.map(({ title, body }) => (
        <section key={title} className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-foreground-secondary">{body}</p>
        </section>
      ))}
    </article>
  );
}
