'use client';

import { useCallback, useState, type JSX } from 'react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import { BcfCreateForm } from './BcfCreateForm';
import { BcfTopicDetail } from './BcfTopicDetail';
import { BcfTopicList } from './BcfTopicList';

type BcfView =
  | { mode: 'list' }
  | { mode: 'detail'; topicId: string }
  | { mode: 'create' };

type Props = {
  projectId: string;
  handle: ViewerHandle | null;
};

/** Tiny error boundary so a crash in a sub-view doesn't silently disappear. */
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
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-body3 font-medium text-error">
            Something went wrong rendering this view.
          </p>
          <p className="text-caption text-foreground-tertiary">
            {this.state.error.message}
          </p>
          <button
            type="button"
            className="mt-2 rounded bg-primary px-3 py-1 text-body3 font-medium text-primary-foreground"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            Back to list
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function BcfPanel({ projectId, handle }: Props): JSX.Element {
  const [view, setView] = useState<BcfView>({ mode: 'list' });

  const goToList = useCallback(() => {
    setView({ mode: 'list' });
  }, []);

  const openDetail = useCallback((topicId: string) => {
    setView({ mode: 'detail', topicId });
  }, []);

  const openCreate = useCallback(() => {
    setView({ mode: 'create' });
  }, []);

  if (view.mode === 'create') {
    return (
      <BcfErrorBoundary onReset={goToList}>
        <BcfCreateForm
          projectId={projectId}
          handle={handle}
          onCancel={goToList}
          onCreated={(topicId) => { setView({ mode: 'detail', topicId }); }}
        />
      </BcfErrorBoundary>
    );
  }

  if (view.mode === 'detail') {
    return (
      <BcfErrorBoundary onReset={goToList}>
        <BcfTopicDetail
          projectId={projectId}
          topicId={view.topicId}
          handle={handle}
          onBack={goToList}
        />
      </BcfErrorBoundary>
    );
  }

  return (
    <BcfTopicList
      projectId={projectId}
      onSelect={openDetail}
      onCreateNew={openCreate}
    />
  );
}
