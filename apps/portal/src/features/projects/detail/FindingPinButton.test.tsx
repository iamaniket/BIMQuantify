import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DocumentViewerHandle, ViewerHandle } from '@bimdossier/viewer';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import { FindingPinButton, type AnchorState } from './FindingPinButton';

type PickedItem = { modelId: string; localId: number } | null;

/** A viewer handle whose `events.on` records the latest handler per event. */
function fakeViewerHandle() {
  const handlers = new Map<string, (evt: unknown) => void>();
  const handle = {
    commands: { execute: vi.fn() },
    events: {
      on: vi.fn((event: string, cb: (evt: unknown) => void) => {
        handlers.set(event, cb);
        return () => handlers.delete(event);
      }),
    },
  };
  return {
    handle: handle as unknown as ViewerHandle,
    emit: (event: string, evt: unknown) => handlers.get(event)?.(evt),
  };
}

function fakeDocumentHandle(): DocumentViewerHandle {
  return {
    commands: { execute: vi.fn() },
    events: { on: vi.fn(() => () => {}) },
  } as unknown as DocumentViewerHandle;
}

function renderButton(props: Partial<Parameters<typeof FindingPinButton>[0]>) {
  return render(
    <IntlWrapper>
      <FindingPinButton
        fileType={props.fileType ?? null}
        currentAnchor={props.currentAnchor ?? null}
        onAnchorChange={props.onAnchorChange ?? vi.fn()}
        documentHandle={props.documentHandle}
        viewerHandle={props.viewerHandle}
        linkModelId={props.linkModelId}
        linkFileId={props.linkFileId}
        resolvePickedGlobalId={props.resolvePickedGlobalId}
      />
    </IntlWrapper>,
  );
}

describe('FindingPinButton visibility', () => {
  it('shows "Pin to model" in no-selection scope (null fileType) with a 3D handle', () => {
    // The headline fix: project mode passes fileType=null but a viewer handle.
    renderButton({ fileType: null, viewerHandle: fakeViewerHandle().handle });
    expect(screen.getByRole('button', { name: /pin to model/i })).toBeInTheDocument();
  });

  it('shows "Pin to model" for an explicit ifc fileType', () => {
    renderButton({ fileType: 'ifc', viewerHandle: fakeViewerHandle().handle });
    expect(screen.getByRole('button', { name: /pin to model/i })).toBeInTheDocument();
  });

  it('shows "Pin to drawing" for a pdf fileType with a document handle', () => {
    renderButton({ fileType: 'pdf', documentHandle: fakeDocumentHandle() });
    expect(screen.getByRole('button', { name: /pin to drawing/i })).toBeInTheDocument();
  });

  it('renders nothing outside the viewer (no handles)', () => {
    const { container } = renderButton({ fileType: 'ifc' });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Update/Remove pin controls when already anchored', () => {
    const anchor: AnchorState = { linked_file_type: 'ifc', anchor_x: 1, anchor_y: 2, anchor_z: 3 };
    renderButton({ fileType: 'ifc', viewerHandle: fakeViewerHandle().handle, currentAnchor: anchor });
    expect(screen.getByRole('button', { name: /update pin/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove pin/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pin to model$/i })).not.toBeInTheDocument();
  });
});

describe('FindingPinButton placement', () => {
  it('arms a guided pick that keeps the selection, then stamps the resolved point', () => {
    const onAnchorChange = vi.fn();
    const viewer = fakeViewerHandle();
    const resolvePickedGlobalId = (item: PickedItem) =>
      item?.localId === 42 ? 'GID42' : null;

    renderButton({
      fileType: null,
      viewerHandle: viewer.handle,
      linkModelId: 'model-1',
      linkFileId: 'file-1',
      resolvePickedGlobalId,
      onAnchorChange,
    });

    fireEvent.click(screen.getByRole('button', { name: /pin to model/i }));
    // The guided overlay keeps the selection so the inspector stays scoped.
    expect(viewer.handle.commands.execute).toHaveBeenCalledWith(
      'interaction.request',
      expect.objectContaining({ keepSelection: true }),
    );

    act(() => {
      viewer.emit('interaction:resolved', {
        kind: 'point',
        point: { x: 1, y: 2, z: 3 },
        item: { modelId: 'file-file-1', localId: 42 },
      });
    });

    expect(onAnchorChange).toHaveBeenCalledWith({
      linked_file_type: 'ifc',
      anchor_x: 1,
      anchor_y: 2,
      anchor_z: 3,
      linked_file_id: 'file-1',
      linked_document_id: 'model-1',
      linkedElementGlobalId: 'GID42',
    });
  });

  it('drops a location-only pin when the pick hits no element', () => {
    const onAnchorChange = vi.fn();
    const viewer = fakeViewerHandle();

    renderButton({
      fileType: null,
      viewerHandle: viewer.handle,
      linkModelId: 'model-1',
      linkFileId: 'file-1',
      resolvePickedGlobalId: () => null,
      onAnchorChange,
    });

    fireEvent.click(screen.getByRole('button', { name: /pin to model/i }));
    act(() => {
      viewer.emit('interaction:resolved', {
        kind: 'point',
        point: { x: 4, y: 5, z: 6 },
        item: null,
      });
    });

    expect(onAnchorChange).toHaveBeenCalledWith({
      linked_file_type: 'ifc',
      anchor_x: 4,
      anchor_y: 5,
      anchor_z: 6,
      linked_file_id: 'file-1',
      linked_document_id: 'model-1',
    });
  });

  it('does not change the anchor when the pick is cancelled', () => {
    const onAnchorChange = vi.fn();
    const viewer = fakeViewerHandle();

    renderButton({
      fileType: null,
      viewerHandle: viewer.handle,
      linkFileId: 'file-1',
      onAnchorChange,
    });

    fireEvent.click(screen.getByRole('button', { name: /pin to model/i }));
    act(() => {
      viewer.emit('interaction:cancelled', undefined);
    });

    expect(onAnchorChange).not.toHaveBeenCalled();
  });
});
