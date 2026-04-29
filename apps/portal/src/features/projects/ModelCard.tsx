'use client';

import { MoreVertical, Trash2 } from 'lucide-react';
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
import type { Model } from '@/lib/api/schemas';

import { ModelFiles } from './ModelFiles';
import { formatDiscipline, formatModelStatus } from './modelFormatting';
import { useDeleteModel } from './useDeleteModel';

type Props = {
  projectId: string;
  model: Model;
};

const STATUS_TONE: Record<Model['status'], string> = {
  active: 'bg-success-lighter text-success border-success-light',
  draft: 'bg-background-tertiary text-foreground-secondary border-border',
  archived: 'bg-background-tertiary text-foreground-tertiary border-border',
};

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
            <span className="inline-flex h-5 items-center rounded-full border border-border bg-background-secondary px-2 text-caption text-foreground-secondary">
              {formatDiscipline(model.discipline)}
            </span>
            <span
              className={`inline-flex h-5 items-center rounded-full border px-2 text-caption ${STATUS_TONE[model.status]}`}
            >
              {formatModelStatus(model.status)}
            </span>
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
              Delete model
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ModelFiles projectId={projectId} modelId={model.id} />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete model"
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
