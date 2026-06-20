import { describe, expect, it } from 'vitest';

import { ShapeView } from './shapes.js';
import { ANNOTATION_SCHEMA_VERSION, type Annotation2D, type AnnotationDocument } from './types.js';

const sample: Annotation2D[] = [
  { id: '1', tool: 'arrow', points: [[0.1, 0.2], [0.8, 0.7]], color: '#ef4444', strokeWidth: 6 },
  { id: '2', tool: 'text', points: [[0.3, 0.3]], text: 'Crack here', color: '#2563eb', strokeWidth: 6 },
  { id: '3', tool: 'freehand', points: [[0, 0], [0.1, 0.1], [0.2, 0.05]], color: '#16a34a', strokeWidth: 3 },
  { id: '4', tool: 'blur', points: [[0.4, 0.4], [0.6, 0.6]], color: '#f59e0b', strokeWidth: 10 },
];

describe('serialization', () => {
  it('round-trips an AnnotationDocument losslessly through JSON', () => {
    const doc: AnnotationDocument = {
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      sourceVersionId: 'version-abc',
      annotations: sample,
    };
    const restored = JSON.parse(JSON.stringify(doc)) as AnnotationDocument;
    expect(restored).toEqual(doc);
    expect(restored.schemaVersion).toBe(ANNOTATION_SCHEMA_VERSION);
    expect(restored.annotations[1]?.text).toBe('Crack here');
  });

  it('preserves an unknown future tool through JSON (forward-compatible)', () => {
    const future = { id: '9', tool: 'star', points: [[0.5, 0.5]], color: '#000', strokeWidth: 4 };
    const restored = JSON.parse(JSON.stringify({ annotations: [future] })) as { annotations: unknown[] };
    expect(restored.annotations[0]).toEqual(future);
  });

  it('ShapeView renders nothing for an unknown tool rather than throwing', () => {
    const unknown = { id: 'x', tool: 'star', points: [[0.5, 0.5]], color: '#000', strokeWidth: 4 } as unknown as Annotation2D;
    expect(ShapeView({ a: unknown, box: { width: 100, height: 100 } })).toBeNull();
  });
});
