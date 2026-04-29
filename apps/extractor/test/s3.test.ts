import { describe, expect, it } from 'vitest';

import {
  fragmentsKeyFor,
  metadataKeyFor,
  propertiesKeyFor,
} from '../src/storage/s3.js';

describe('storage key derivation', () => {
  const source = 'projects/abc/123e4567-e89b-12d3-a456-426614174000.ifc';

  it('replaces .ifc with .frag', () => {
    expect(fragmentsKeyFor(source)).toBe(
      'projects/abc/123e4567-e89b-12d3-a456-426614174000.frag',
    );
  });

  it('replaces .ifc with .metadata.json', () => {
    expect(metadataKeyFor(source)).toBe(
      'projects/abc/123e4567-e89b-12d3-a456-426614174000.metadata.json',
    );
  });

  it('replaces .ifc with .properties.json', () => {
    expect(propertiesKeyFor(source)).toBe(
      'projects/abc/123e4567-e89b-12d3-a456-426614174000.properties.json',
    );
  });

  it('is case-insensitive on the source extension', () => {
    expect(fragmentsKeyFor('projects/x/file.IFC')).toBe('projects/x/file.frag');
  });
});
