'use client';

import { MoreVertical } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@bimstitch/ui';

import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';
import type { Project } from '@/lib/api/schemas';

import { ProjectFormDialog } from './ProjectFormDialog';
import { isProjectArchived } from '@/lib/formatting/projects';
import { useArchiveProject } from './useArchiveProject';
import { useDeleteProject } from './useDeleteProject';
import { useReactivateProject } from './useReactivateProject';

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

function formatArchiveError(
  error: unknown,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (error === null || error === undefined) return null;
  return t('errors.archiveFailed');
}

export function ProjectCardMenu({ project }: Props): JSX.Element {
  const t = useTranslations('projects.card.menu');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archived = isProjectArchived(project);

  const archiveMutation = useArchiveProject();
  const deleteMutation = useDeleteProject();
  const reactivateMutation = useReactivateProject();

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
        },
      },
    );
  };

  const handleArchiveOpenChange = (open: boolean): void => {
    setArchiveOpen(open);
    if (!open) {
      archiveMutation.reset();
    }
  };

  const handleConfirmArchive = (): void => {
    archiveMutation.mutate(
      { id: project.id },
      {
        onSuccess: () => {
          setArchiveOpen(false);
          toast.success(t('archiveSuccess'));
        },
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('actions')}
            className="absolute right-2 top-2 z-20 h-8 w-8 rounded-full bg-black/25 p-0 text-white backdrop-blur-sm hover:bg-black/40 hover:text-white"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              if (!archived) {
                setEditOpen(true);
              }
            }}
          >
            {archived ? t('view') : t('edit')}
          </DropdownMenuItem>
          {archived ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                reactivateMutation.mutate(
                  { id: project.id },
                  {
                    onSuccess: () => {
                      toast.success(t('reactivateSuccess'));
                    },
                  },
                );
              }}
            >
              {t('reactivate')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setArchiveOpen(true);
              }}
            >
              {t('archive')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            {t('remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProjectFormDialog
        mode="edit"
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        title={t('deleteTitle')}
        description={t('deleteDescription', { name: project.name })}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={handleConfirmDelete}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={formatDeleteError(deleteMutation.error, t)}
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={handleArchiveOpenChange}
        title={t('archiveTitle')}
        description={t('archiveDescription', { name: project.name })}
        confirmLabel={t('archiveConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={handleConfirmArchive}
        variant="default"
        isPending={archiveMutation.isPending}
        errorMessage={formatArchiveError(archiveMutation.error, t)}
      />
    </>
  );
}
