'use client';

import { Component, type ErrorInfo, type ReactNode, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import { BcfTopicList } from './BcfTopicList';

type Props = {
  projectId: string;
  handle: ViewerHandle | null;
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
            onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function BcfPanel({ projectId, handle }: Props): JSX.Element {
  return (
    <BcfErrorBoundary onReset={() => {}}>
      <BcfTopicList projectId={projectId} handle={handle} />
    </BcfErrorBoundary>
  );
}
