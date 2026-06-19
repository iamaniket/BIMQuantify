import { Eyebrow } from '@bimstitch/ui';
import { getTranslations } from 'next-intl/server';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { BlogPostCard } from '@/components/blog/BlogPostCard';
import { Link } from '@/i18n/navigation';
import { getAllPostsMerged } from '@/lib/blog/mdx';

type Props = { locale: Locale };

/**
 * "From the blog" home strip — the 3 most recent posts, reusing the same
 * loader (`getAllPostsMerged`) and card (`BlogPostCard`) as the /blog index.
 * An async server component (no client boundary). Renders nothing when there
 * are no posts (empty `content/blog` + API unavailable), so the landing page
 * collapses cleanly until content exists.
 */
export async function FromTheBlogSection({ locale }: Props): Promise<JSX.Element | null> {
  const posts = (await getAllPostsMerged(locale)).slice(0, 3);
  if (posts.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'fromBlog' });

  return (
    <section id="from-blog" className="bg-surface-main">
      <div className="mx-auto w-full max-w-8xl px-6 py-20">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3">
            <Eyebrow size="sm">{t('eyebrow')}</Eyebrow>
            <h2 className="text-h3 font-semibold text-foreground">{t('headline')}</h2>
          </div>
          <Link
            href="/blog"
            className="text-body2 font-medium text-primary transition-colors hover:underline"
          >
            {t('readAll')} →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <BlogPostCard key={post.slug} post={post} />
          ))}
        </div>
      </div>
    </section>
  );
}
