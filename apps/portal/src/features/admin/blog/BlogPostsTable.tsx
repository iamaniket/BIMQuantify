'use client';

import { Eye, EyeOff, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Button } from '@bimstitch/ui';

import { PageTable, type Column } from '@/components/shared/PageTable';
import type { BlogPostRead } from '@/lib/api/schemas';

type Props = {
  posts: BlogPostRead[];
  onDelete: (post: BlogPostRead) => void;
  onToggleStatus: (post: BlogPostRead) => void;
  deletingId: string | null;
  togglingId: string | null;
};

export function BlogPostsTable({
  posts,
  onDelete,
  onToggleStatus,
  deletingId,
  togglingId,
}: Props): JSX.Element {
  const t = useTranslations('admin.blog.table');

  const columns: Column<BlogPostRead>[] = [
    {
      header: t('title'),
      cell: (post) => (
        <>
          <div className="font-medium text-foreground">{post.title}</div>
          <div className="font-sans text-caption text-foreground-tertiary">{post.slug}</div>
        </>
      ),
    },
    {
      header: t('locale'),
      cell: (post) => (
        <Badge variant="default" size="sm">
          {post.locale.toUpperCase()}
        </Badge>
      ),
    },
    {
      header: t('status'),
      cell: (post) => (
        <Badge variant={post.status === 'published' ? 'success' : 'default'} size="sm">
          {t(`statusLabel.${post.status as 'draft' | 'published'}`)}
        </Badge>
      ),
    },
    {
      header: t('published'),
      className: 'text-foreground-tertiary',
      cell: (post) => new Date(post.published_at).toLocaleDateString(),
    },
    {
      header: '',
      className: 'w-24',
      cell: (post) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="border"
            size="sm"
            onClick={() => { onToggleStatus(post); }}
            disabled={togglingId === post.id}
            aria-label={
              post.status === 'published'
                ? t('unpublishAria', { title: post.title })
                : t('publishAria', { title: post.title })
            }
            title={post.status === 'published' ? t('unpublish') : t('publish')}
          >
            {post.status === 'published' ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="border"
            size="sm"
            onClick={() => { onDelete(post); }}
            disabled={deletingId === post.id}
            aria-label={t('deleteAria', { title: post.title })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageTable
      columns={columns}
      data={posts}
      rowKey={(p) => p.id}
      emptyMessage={t('empty')}
    />
  );
}
