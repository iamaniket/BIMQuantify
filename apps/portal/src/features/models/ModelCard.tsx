'use client';

import { MoreVertical, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';

import {
  Badge,
  type BadgeVariant,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import type { Model } from '@/lib/api/schemas';

import { ModelFiles } from './ModelFiles';
import { formatDiscipline, formatModelStatus } from '@/lib/formatting/models';
import { useDeleteModel } from './useDeleteModel';

type Props = {
  projectId: string;
  model: Model;
};

const STATUS_VARIANT: Record<Model['status'], BadgeVariant> = {
  active: 'success',
  draft: 'default',
  archived: 'default',
};

function dimensionLabel(primaryFileType: Model['primary_file_type']): string {
  if (primaryFileType === 'ifc') return '3D';
  if (primaryFileType === 'pdf') return '2D';
  return 'Empty';
}

export function ModelCard({ projectId, model }: Props): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteMutation = useDeleteModel();

  const handleDelete = (): void => {
    deleteMutation.mutate(
      { projectId, modelId: model.id },
      {
        onSuccess: () => {
          setConfirmOpen(false);
        },
      },
    );
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-title3 font-semibold text-foreground">
            {model.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="primary">{dimensionLabel(model.primary_file_type ?? null)}</Badge>
            <Badge variant="default">{formatDiscipline(model.discipline)}</Badge>
            <Badge variant={STATUS_VARIANT[model.status]}>{formatModelStatus(model.status)}</Badge>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Actions for ${model.name}`}
              className="h-8 w-8 p-0"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ModelFiles
        projectId={projectId}
        modelId={model.id}
        primaryFileType={model.primary_file_type ?? null}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete document"
        description={`Delete "${model.name}" and all its uploaded versions? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={
          deleteMutation.error instanceof ApiError
            ? deleteMutation.error.detail
            : null
        }
      />
    </article>
  );
}
