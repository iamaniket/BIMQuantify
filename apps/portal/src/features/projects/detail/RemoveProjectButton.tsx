'use client';

import { Trash2 } from '@bimdossier/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@bimdossier/ui';

import { ApiError } from '@/lib/api/client';
import type { Project } from '@/lib/api/schemas';
import { useRouter } from '@/i18n/navigation';

import { useDeleteProject } from '../useDeleteProject';
import { RemoveProjectDialog } from './RemoveProjectDialog';

type Props = {
  project: Project;
};

function formatDeleteError(
  error: unknown,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return t('errors.forbidden');
    }
    if (error.status === 404) {
      return t('errors.notFound');
    }
    return t('errors.deleteFailed', { detail: error.detail });
  }
  return t('errors.deleteUnknown');
}

/**
 * Destructive "Remove" button for the project-detail header, sitting beside
 * Edit/Settings/Project Access. Opens the type-to-confirm RemoveProjectDialog.
 * (Archive lived in a kebab menu here previously; it's temporarily removed from
 * the frontend — the archive hooks/API client are retained for re-adding later.)
 */
export function RemoveProjectButton({ project }: Props): JSX.Element {
  const t = useTranslations('projects.card.menu');
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = useDeleteProject();

  const handleDeleteOpenChange = (open: boolean): void => {
    setDeleteOpen(open);
    if (!open) {
      deleteMutation.reset();
    }
  };

  const handleConfirmDelete = (): void => {
    deleteMutation.mutate(
      { id: project.id },
      {
        onSuccess: () => {
          setDeleteOpen(false);
          // The project no longer exists — leave the now-dead detail page.
          router.push('/projects');
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="border"
        size="md"
        aria-label={t('removeAria')}
        className="text-error hover:border-error-light hover:bg-error-lighter hover:text-error"
        onClick={() => { setDeleteOpen(true); }}
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        {t('remove')}
      </Button>

      <RemoveProjectDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        projectName={project.name}
        onConfirm={handleConfirmDelete}
        isPending={deleteMutation.isPending}
        errorMessage={formatDeleteError(deleteMutation.error, t)}
      />
    </>
  );
}
