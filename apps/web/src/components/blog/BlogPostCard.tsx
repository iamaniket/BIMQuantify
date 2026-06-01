import Link from 'next/link';
import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import type { PostMeta } from '@/lib/blog/types';

type BlogPostCardProps = {
  post: PostMeta;
};

export function BlogPostCard({ post }: BlogPostCardProps): JSX.Element {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-background p-6 transition-all hover:border-border-hover hover:shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-2">
        {post.tags.map((tag) => (
          <Badge key={tag} variant="primary" size="sm">
            {tag}
          </Badge>
        ))}
      </div>

      <h3 className="text-title2 font-semibold text-foreground group-hover:text-primary">
        {post.title}
      </h3>

      <p className="text-body2 text-foreground-secondary">{post.description}</p>

      <div className="mt-auto flex items-center gap-3 text-caption text-foreground-tertiary">
        <time dateTime={post.date}>
          {new Date(post.date).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </time>
        <span>·</span>
        <span>{post.readingTime}</span>
      </div>
    </Link>
  );
}
