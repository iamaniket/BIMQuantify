'use client';

import { Eye, EyeOff, Trash2 } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Button } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { BlogPostRead } from '@/lib/api/schemas';

type Props = {
  table: TablePagination<BlogPostRead>;
  onDelete: (post: BlogPostRead) => void;
  onToggleStatus: (post: BlogPostRead) => void;
  deletingId: string | null;
  togglingId: string | null;
};

export function BlogPostsTable({
  table,
  onDelete,
  onToggleStatus,
  deletingId,
  togglingId,
}: Props): JSX.Element {
  const t = useTranslations('admin.blog.table');
  const tBlog = useTranslations('admin.blog');
  const locale = useLocale() as Locale;

  const columns: Column<BlogPostRead>[] = [
    {
      header: t('title'),
      sortKey: 'title',
      cell: (post) => (
        <>
          <div className="font-medium text-foreground">{post.title}</div>
          <div className="font-sans text-caption text-foreground-tertiary">{post.slug}</div>
        </>
      ),
    },
    {
      header: t('locale'),
      sortKey: 'locale',
      cell: (post) => (
        <Badge variant="default" size="md">
          {post.locale.toUpperCase()}
        </Badge>
      ),
    },
    {
      header: t('status'),
      sortKey: 'status',
      cell: (post) => (
        <Badge variant={post.status === 'published' ? 'success' : 'default'} size="md">
          {t(`statusLabel.${post.status as 'draft' | 'published'}`)}
        </Badge>
      ),
    },
    {
      header: t('published'),
      sortKey: 'published_at',
      className: 'text-foreground-tertiary',
      cell: (post) => formatDate(post.published_at, locale),
    },
    {
      header: '',
      className: 'w-24',
      cell: (post) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="border"
            size="md"
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
            size="md"
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
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(p) => p.id}
      emptyMessage={t('empty')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={tBlog('loadError')}
    />
  );
}
