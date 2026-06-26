'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { EmptyState } from '@bimdossier/ui';
import { HelpCircle } from '@bimdossier/ui/icons';

import { HelpArticleView } from '@/features/help/HelpArticleView';
import { useHelpArticle } from '@/features/help/useHelpContent';
import { Link } from '@/i18n/navigation';

export default function HelpArticlePage(): ReactNode {
  const params = useParams<{ slug: string }>();
  const t = useTranslations('help');
  const article = useHelpArticle(params.slug ?? '');

  if (article === undefined) {
    return (
      <EmptyState
        icon={HelpCircle}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Link href="/help" className="text-body2 font-medium text-primary hover:underline">
            {t('article.backToHelp')}
          </Link>
        }
        className={undefined}
      />
    );
  }

  return <HelpArticleView article={article} />;
}
