import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function TermsPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  const sections = [
    { title: t('terms.serviceTitle'), body: t('terms.serviceBody') },
    { title: t('terms.obligationsTitle'), body: t('terms.obligationsBody') },
    { title: t('terms.billingTitle'), body: t('terms.billingBody') },
    { title: t('terms.liabilityTitle'), body: t('terms.liabilityBody') },
    { title: t('terms.terminationTitle'), body: t('terms.terminationBody') },
  ];

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="m-0 font-sans text-[32px] font-medium leading-tight tracking-tight text-foreground">
          {t('terms.title')}
        </h1>
        <p className="font-sans text-[11px] uppercase tracking-[0.10em] text-foreground-tertiary">
          {t('lastUpdated', { date: '2026-05-10' })}
        </p>
        <p className="text-[15px] leading-relaxed text-foreground-secondary">{t('terms.intro')}</p>
      </header>

      {sections.map(({ title, body }) => (
        <section key={title} className="space-y-2">
          <h2 className="font-sans text-[18px] font-semibold leading-tight tracking-tight text-foreground">
            {title}
          </h2>
          <p className="text-[14.5px] leading-relaxed text-foreground-secondary">{body}</p>
        </section>
      ))}
    </article>
  );
}
