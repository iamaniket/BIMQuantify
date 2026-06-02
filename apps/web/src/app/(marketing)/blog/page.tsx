import type { Metadata } from 'next';
import type { JSX } from 'react';

import { BlogHero } from '@/components/blog/BlogHero';
import { BlogPostCard } from '@/components/blog/BlogPostCard';
import { getAllPosts } from '@/lib/blog/mdx';

export const metadata: Metadata = {
  title: 'Blog — BimDossier',
  description:
    'Insights on BIM quantification, Wet kwaliteitsborging voor het bouwen (Wkb) compliance, and the Dutch built environment.',
};

export default function BlogListingPage(): JSX.Element {
  const posts = getAllPosts();

  return (
    <main>
      <BlogHero />

      <div className="mx-auto w-full max-w-5xl px-6 py-12">
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
      </div>
    </main>
  );
}
