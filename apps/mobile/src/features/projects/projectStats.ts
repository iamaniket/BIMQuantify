import type { Project } from '@/lib/api/schemas/projects';

export interface ProjectCounts {
  total: number;
  active: number;
  archived: number;
  construction: number;
  design: number;
}

// On-site construction ≈ the shell + finishing phases (mirrors the portal Hero).
const CONSTRUCTION_PHASES = new Set(['shell', 'finishing']);

/**
 * Portfolio tallies derived from the project list — the honest, mobile-available
 * substitute for the design's mock stat strip (Deadlines/Certificates need data
 * the app doesn't fetch). `active`/`archived` come from `lifecycle_state` (the
 * "N active · N archived" header line); the rest from `phase`.
 */
export function projectCounts(projects: Project[]): ProjectCounts {
  const counts: ProjectCounts = { total: projects.length, active: 0, archived: 0, construction: 0, design: 0 };
  for (const p of projects) {
    if (p.lifecycle_state === 'archived') counts.archived += 1;
    else counts.active += 1;
    if (p.phase !== undefined && CONSTRUCTION_PHASES.has(p.phase)) counts.construction += 1;
    if (p.phase === 'design') counts.design += 1;
  }
  return counts;
}
