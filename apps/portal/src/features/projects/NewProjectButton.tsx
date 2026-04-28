'use client';

import { Plus } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Button } from '@bimstitch/ui';

import { ProjectFormDialog } from './ProjectFormDialog';

export function NewProjectButton(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => { setOpen(true); }}
      >
        <Plus className="h-4 w-4" />
        New project
      </Button>
      <ProjectFormDialog
        mode="create"
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
