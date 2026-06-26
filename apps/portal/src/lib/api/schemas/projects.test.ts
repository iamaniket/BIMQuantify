import { describe, expect, it } from 'vitest';

import { BuildingTypeEnum } from './projects';

/**
 * Regression guard for the legacy `commercial` building-type code.
 *
 * The wizard no longer OFFERS `commercial`, but the API still STORES and RETURNS
 * it on older projects. If it's dropped from BuildingTypeEnum, the surrounding
 * ProjectSchema fails response validation on every such project — the client
 * throws and the project 404s. The invariant otherwise lives only in a comment
 * (see ./projects.ts), so this pins it.
 */
describe('BuildingTypeEnum legacy values', () => {
  it('still accepts the legacy "commercial" code the API can return', () => {
    expect(() => BuildingTypeEnum.parse('commercial')).not.toThrow();
    expect(BuildingTypeEnum.options).toContain('commercial');
  });
});
