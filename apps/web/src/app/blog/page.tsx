import type { Metadata } from 'next';
import type { JSX } from 'react';

import { Eyebrow } from '@bimstitch/ui';

import { BlogPostCard } from '@/components/blog/BlogPostCard';
import { getAllPosts } from '@/lib/blog/mdx';

export const metadata: Metadata = {
  title: 'Blog — BimDossier',
  description:
    'Insights on BIM quantification, WKB compliance, and the Dutch built environment.',
};

export default function BlogListingPage(): JSX.Element {
  const posts = getAllPosts();

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <div className="mb-12 flex flex-col gap-3">
        <Eyebrow size="sm">Blog</Eyebrow>
        <h1 className="text-h2 font-semibold text-foreground">
          Insights & updates
        </h1>
        <p className="max-w-xl text-body1 text-foreground-secondary">
          BIM quantification, Dutch building regulations, and product updates.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-body1 text-foreground-tertiary">
          No posts yet. Check back soon.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {posts.map((post) => (
            <BlogPostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </main>
  );
}
