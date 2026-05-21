type DisciplineColor = { bg: string; fg: string };

const FALLBACK: DisciplineColor = { bg: '#f1f3f6', fg: '#4b5563' };

export const MODEL_DISCIPLINE_COLORS: Record<string, DisciplineColor> = {
  architectural: { bg: '#ede8f7', fg: '#5a3fa6' },
  structural: { bg: '#e5edf7', fg: '#2c5697' },
  mep: { bg: '#f8ecd9', fg: '#a97428' },
  coordination: { bg: '#eaf6ef', fg: '#3f8f65' },
  other: FALLBACK,
};

export const ISSUE_DISCIPLINE_COLORS: Record<string, DisciplineColor> = {
  FIRE: { bg: '#fde2e2', fg: '#b91c1c' },
  ARCH: { bg: '#ede8f7', fg: '#5a3fa6' },
  STR: { bg: '#e5edf7', fg: '#2c5697' },
  MEP: { bg: '#f8ecd9', fg: '#a97428' },
  ACC: { bg: '#eaf6ef', fg: '#3f8f65' },
  ENV: { bg: '#e0f2fe', fg: '#0369a1' },
};

export function getDisciplineColor(
  map: Record<string, DisciplineColor>,
  key: string,
): DisciplineColor {
  return map[key] ?? FALLBACK;
}
