'use client';

import { MoreVertical } from 'lucide-react';
import { useState, type JSX } from 'react';

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import type { Project } from '@/lib/api/schemas';

import { ProjectFormDialog } from './ProjectFormDialog';
import { isProjectArchived } from './projectFormatting';
import { useArchiveProject } from './useArchiveProject';
import { useDeleteProject } from './useDeleteProject';
import { useReactivateProject } from './useReactivateProject';

type Props = {
  project: Project;
};

function formatDeleteError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'You do not have permission to delete this project.';
    }
    if (error.status === 404) {
      return 'Project not found. It may have been deleted already.';
    }
    return `Delete failed: ${error.detail}`;
  }
  return 'Could not delete project.';
}

export function ProjectCardMenu({ project }: Props): JSX.Element {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Project actions"
            className="absolute right-2 top-2 h-8 w-8 rounded-full bg-black/25 p-0 text-white backdrop-blur-sm hover:bg-black/40 hover:text-white"
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
            {archived ? 'View' : 'Edit'}
          </DropdownMenuItem>
          {archived ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                reactivateMutation.mutate({ id: project.id });
              }}
            >
              Reactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                archiveMutation.mutate({ id: project.id });
              }}
            >
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            Remove
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
        title="Delete project"
        description={`Remove "${project.name}" from active views? It will be hidden from normal project lists.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={formatDeleteError(deleteMutation.error)}
      />
    </>
  );
}
