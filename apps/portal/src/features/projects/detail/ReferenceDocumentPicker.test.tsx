import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

const READY_DOC = {
  id: 'att-1',
  original_filename: 'fire-cert.pdf',
  status: 'ready',
  content_type: 'application/pdf',
  attachment_category: 'office',
};

vi.mock('@/features/attachments/useAttachments', () => ({
  useAttachments: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/lib/query/useAuthInfiniteQuery', () => ({
  flattenPages: () => [READY_DOC],
}));

// Stub the heavy viewer so we only assert the picker's open-on-click wiring.
vi.mock('@/features/attachments/AttachmentViewerDialog', () => ({
  AttachmentViewerDialog: ({
    open,
    attachment,
  }: {
    open: boolean;
    attachment: { original_filename: string } | null;
  }) => (open && attachment !== null
    ? <div data-testid="viewer-open">{attachment.original_filename}</div>
    : null),
}));

import { ReferenceDocumentPicker } from './ReferenceDocumentPicker';

describe('ReferenceDocumentPicker — tap to open', () => {
  it('opens the attachment viewer for the clicked reference document', () => {
    render(
      <IntlWrapper locale="en">
        <ReferenceDocumentPicker projectId="p1" referenceIds={['att-1']} onChange={() => {}} />
      </IntlWrapper>,
    );

    // Closed until the document name is clicked.
    expect(screen.queryByTestId('viewer-open')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('fire-cert.pdf'));

    expect(screen.getByTestId('viewer-open')).toHaveTextContent('fire-cert.pdf');
  });
});
