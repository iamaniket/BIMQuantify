'use client';

import { useTranslations } from 'next-intl';
import { Component, type ErrorInfo, type ReactNode, type JSX } from 'react';

import { BcfTopicList } from './BcfTopicList';
import type { BcfController } from './useBcfController';

function BcfRenderErrorFallback({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}): JSX.Element {
  const t = useTranslations('viewer.bcf');
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-body3 font-medium text-error">
        {t('renderError')}
      </p>
      <p className="text-caption text-foreground-tertiary">
        {message}
      </p>
      <button
        type="button"
        className="mt-2 rounded bg-primary px-3 py-1 text-body3 font-medium text-primary-foreground"
        onClick={onReset}
      >
        {t('retry')}
      </button>
    </div>
  );
}

type Props = {
  projectId: string;
  controller: BcfController;
  /** The model currently open in the viewer (logical model). */
  modelId?: string | undefined;
  /** The exact file version (ProjectFile) currently open. */
  fileId?: string | undefined;
  /** Viewer dimension — '3d' for IFC, '2d' for PDF/drawings. */
  dimension?: '2d' | '3d' | undefined;
  createNonce?: number | undefined;
  onCreateClose?: ((saved: boolean) => void) | undefined;
  openTopicId?: string | undefined;
  openTopicNonce?: number | undefined;
};

class BcfErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[BcfPanel] render error:', error, info);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <BcfRenderErrorFallback
          message={this.state.error.message}
          onReset={() => { this.setState({ error: null }); this.props.onReset(); }}
        />
      );
    }
    return this.props.children;
  }
}

export function BcfPanel({
  projectId,
  controller,
  modelId,
  fileId,
  dimension,
  createNonce,
  onCreateClose,
  openTopicId,
  openTopicNonce,
}: Props): JSX.Element {
  return (
    <BcfErrorBoundary onReset={() => {}}>
      <BcfTopicList
        projectId={projectId}
        controller={controller}
        modelId={modelId}
        fileId={fileId}
        dimension={dimension}
        createNonce={createNonce}
        onCreateClose={onCreateClose}
        openTopicId={openTopicId}
        openTopicNonce={openTopicNonce}
      />
    </BcfErrorBoundary>
  );
}
