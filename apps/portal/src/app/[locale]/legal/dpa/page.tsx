import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DpaPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  const sections = [
    { title: t('dpa.scopeTitle'), body: t('dpa.scopeBody') },
    { title: t('dpa.categoriesTitle'), body: t('dpa.categoriesBody') },
    { title: t('dpa.subprocessorsTitle'), body: t('dpa.subprocessorsBody') },
    { title: t('dpa.securityTitle'), body: t('dpa.securityBody') },
    { title: t('dpa.incidentTitle'), body: t('dpa.incidentBody') },
    { title: t('dpa.rightsTitle'), body: t('dpa.rightsBody') },
    { title: t('dpa.returnTitle'), body: t('dpa.returnBody') },
  ];

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('dpa.title')}</h1>
        <p className="text-xs text-foreground-secondary">{t('lastUpdated', { date: '2026-05-10' })}</p>
        <p className="text-base text-foreground-secondary">{t('dpa.intro')}</p>
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
