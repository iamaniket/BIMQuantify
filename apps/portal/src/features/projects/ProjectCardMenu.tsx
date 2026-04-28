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
import { useDeleteProject } from './useDeleteProject';

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
            className="absolute right-2 top-2 h-8 w-8 rounded-full bg-background/80 p-0 text-foreground hover:bg-background"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setEditOpen(true);
            }}
          >
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            Delete
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
        description={`Delete "${project.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={formatDeleteError(deleteMutation.error)}
      />
    </>
  );
}
