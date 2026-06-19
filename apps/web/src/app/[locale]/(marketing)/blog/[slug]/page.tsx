import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { compileMDX } from 'next-mdx-remote/rsc';
import type { JSX } from 'react';

import { supportedLocales, type Locale } from '@bimstitch/i18n';

import { BlogPostCoverImage } from '@/components/blog/BlogPostCoverImage';
import { BlogPostHero } from '@/components/blog/BlogPostHero';
import { mdxComponents } from '@/components/blog/MdxComponents';
import { getAllSlugs, getPostBySlugMerged } from '@/lib/blog/mdx';

// API-published posts must be reachable, so allow params outside the
// `generateStaticParams` set to render on-demand and be cached for 60s.
export const dynamicParams = true;
export const revalidate = 60;

type Params = { locale: string; slug: string };

export function generateStaticParams(): Params[] {
  return supportedLocales.flatMap((locale) =>
    getAllSlugs(locale).map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getPostBySlugMerged(slug, locale as Locale);
  if (post === null) {
    // Bare title — the [locale]/layout.tsx `%s — BimDossier` template appends
    // the suffix, so adding it here would double it.
    return { title: 'Post not found' };
  }
  return {
    title: post.meta.title,
    description: post.meta.description,
    openGraph: {
      title: post.meta.title,
      description: post.meta.description,
      type: 'article',
      publishedTime: post.meta.date,
      authors: [post.meta.author],
      tags: post.meta.tags,
      ...(post.meta.image ? { images: [post.meta.image] } : {}),
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<Params>;
}): Promise<JSX.Element> {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const post = await getPostBySlugMerged(slug, locale as Locale);
  if (post === null) {
    notFound();
  }

  const { content: mdxContent } = await compileMDX({
    source: post.content,
    components: mdxComponents,
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.meta.title,
    description: post.meta.description,
    datePublished: post.meta.date,
    author: {
      '@type': 'Organization',
      name: post.meta.author,
    },
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <BlogPostHero meta={post.meta} />
      {post.meta.image ? (
        <div className="mx-auto w-full max-w-8xl px-6 pt-12">
          <BlogPostCoverImage image={post.meta.image} title={post.meta.title} />
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-8xl px-6 pb-12 pt-8">
        <article className="prose prose-neutral max-w-none dark:prose-invert [&>h2]:mt-10 [&>h2]:text-h4 [&>h2]:font-semibold [&>h3]:mt-8 [&>h3]:text-title2 [&>h3]:font-semibold [&>p]:text-body1 [&>p]:text-foreground-secondary [&>p]:leading-relaxed [&>ul]:text-body1 [&>ul]:text-foreground-secondary [&>ol]:text-body1 [&>ol]:text-foreground-secondary">
          {mdxContent}
        </article>
      </div>
    </main>
  );
}
