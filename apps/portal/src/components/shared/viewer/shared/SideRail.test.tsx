import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SideRail, type RailBadge } from './SideRail';

// next-intl: return the key so labels are deterministic; the pill's own label
// is passed in pre-localized via `toggleLabel`, so it doesn't go through this.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
// Keep the test hermetic (no dependency on the built @bimdossier/ui dist).
vi.mock('@bimdossier/ui', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));
vi.mock('@bimdossier/ui/icons', () => ({
  Flag: () => null,
  Info: () => null,
  ListTree: () => null,
  Ruler: () => null,
  Scan: () => null,
}));

function makeBadge(overrides: Partial<RailBadge> = {}): RailBadge {
  return {
    count: 3,
    visible: true,
    onToggleVisible: vi.fn(),
    toggleLabel: 'Hide Measure',
    ...overrides,
  };
}

describe('SideRail count pills', () => {
  it('renders a pill with the layer count and pressed state when count > 0', () => {
    render(
      <SideRail
        format="ifc"
        activePanel={null}
        onTogglePanel={vi.fn()}
        badges={{ measure: makeBadge({ count: 3 }) }}
      />,
    );
    const pill = screen.getByRole('button', { name: 'Hide Measure' });
    expect(pill).toHaveTextContent('3');
    expect(pill).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders no pill when the layer count is 0', () => {
    render(
      <SideRail
        format="ifc"
        activePanel={null}
        onTogglePanel={vi.fn()}
        badges={{ measure: makeBadge({ count: 0 }) }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Hide Measure' })).toBeNull();
  });

  it('clicking the pill toggles visibility WITHOUT opening the panel', () => {
    const onToggleVisible = vi.fn();
    const onTogglePanel = vi.fn();
    render(
      <SideRail
        format="ifc"
        activePanel={null}
        onTogglePanel={onTogglePanel}
        badges={{ measure: makeBadge({ onToggleVisible }) }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide Measure' }));
    expect(onToggleVisible).toHaveBeenCalledTimes(1);
    expect(onTogglePanel).not.toHaveBeenCalled();
  });

  it('clicking the tab itself opens the matching panel', () => {
    const onTogglePanel = vi.fn();
    render(
      <SideRail
        format="ifc"
        activePanel={null}
        onTogglePanel={onTogglePanel}
        badges={{ measure: makeBadge() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'titleMeasure' }));
    expect(onTogglePanel).toHaveBeenCalledWith('measure');
  });

  it('marks a hidden layer with aria-pressed=false', () => {
    render(
      <SideRail
        format="ifc"
        activePanel={null}
        onTogglePanel={vi.fn()}
        badges={{ measure: makeBadge({ visible: false, toggleLabel: 'Show Measure' }) }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Show Measure' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
