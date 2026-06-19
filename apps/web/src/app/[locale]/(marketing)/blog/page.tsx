import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { BlogHero } from '@/components/blog/BlogHero';
import { BlogPostCard } from '@/components/blog/BlogPostCard';
import { getAllPostsMerged } from '@/lib/blog/mdx';

// Re-render at most once per minute so newly-published API posts appear
// without redeploying. Committed in-repo posts are still baked in at build
// time — the revalidation only refreshes the API fetch.
export const revalidate = 60;

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'blog' });
  return {
    title: `${t('headline')} — BimDossier`,
    description: t('subtitle'),
  };
}

export default async function BlogListingPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'blog' });
  const posts = await getAllPostsMerged(locale as Locale);

  return (
    <main>
      <BlogHero />

      <div className="mx-auto w-full max-w-8xl px-6 py-12">
        {posts.length === 0 ? (
          <p className="text-body1 text-foreground-tertiary">
            {t('empty')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {posts.map((post) => (
              <BlogPostCard key={post.slug} post={post} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
