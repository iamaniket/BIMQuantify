/**
 * Discipline chip colours. Values are CSS custom properties (declared in
 * globals.css as `--disc-*`) so the palette is theme-aware — light pastels
 * in light mode, translucent tints in dark mode. Consumers spread the result
 * into an inline `style` because the discipline key is dynamic.
 */
type ChipColors = { bg: string; fg: string };

const DISCIPLINE_CHIP_COLORS: Record<string, ChipColors> = {
  architectural: { bg: 'var(--disc-architectural-bg)', fg: 'var(--disc-architectural-fg)' },
  structural: { bg: 'var(--disc-structural-bg)', fg: 'var(--disc-structural-fg)' },
  mep: { bg: 'var(--disc-mep-bg)', fg: 'var(--disc-mep-fg)' },
  coordination: { bg: 'var(--disc-coordination-bg)', fg: 'var(--disc-coordination-fg)' },
  other: { bg: 'var(--disc-other-bg)', fg: 'var(--disc-other-fg)' },
};

export function disciplineChipColors(discipline: string): ChipColors {
  return DISCIPLINE_CHIP_COLORS[discipline] ?? DISCIPLINE_CHIP_COLORS['other']!;
}

/**
 * Issue-category chip colours, keyed by short domain code. Reuses the
 * discipline palette where the hues match, with two category-specific extras.
 */
const ISSUE_CHIP_COLORS: Record<string, ChipColors> = {
  FIRE: { bg: 'var(--issue-fire-bg)', fg: 'var(--issue-fire-fg)' },
  ARCH: { bg: 'var(--disc-architectural-bg)', fg: 'var(--disc-architectural-fg)' },
  STR: { bg: 'var(--disc-structural-bg)', fg: 'var(--disc-structural-fg)' },
  MEP: { bg: 'var(--disc-mep-bg)', fg: 'var(--disc-mep-fg)' },
  ACC: { bg: 'var(--disc-coordination-bg)', fg: 'var(--disc-coordination-fg)' },
  ENV: { bg: 'var(--issue-env-bg)', fg: 'var(--issue-env-fg)' },
};

export function issueChipColors(category: string): ChipColors {
  return ISSUE_CHIP_COLORS[category] ?? DISCIPLINE_CHIP_COLORS['other']!;
}
