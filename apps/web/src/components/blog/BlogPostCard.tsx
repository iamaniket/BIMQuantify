import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { BlogCardThumbnail } from '@/components/blog/BlogCardThumbnail';
import { Link } from '@/i18n/navigation';
import type { PostMeta } from '@/lib/blog/types';

type BlogPostCardProps = {
  post: PostMeta;
};

export function BlogPostCard({ post }: BlogPostCardProps): JSX.Element {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-all hover:border-border-hover hover:shadow-lg"
    >
      <BlogCardThumbnail
        slug={post.slug}
        image={post.image}
        title={post.title}
      />

      <div className="flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          {post.tags.map((tag) => (
            <Badge key={tag} variant="primary" size="md">
              {tag}
            </Badge>
          ))}
        </div>

        <h3 className="text-title2 font-semibold text-foreground group-hover:text-primary">
          {post.title}
        </h3>

        <p className="text-body2 text-foreground-secondary">
          {post.description}
        </p>

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
      </div>
    </Link>
  );
}
