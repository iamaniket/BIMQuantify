import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AnnotationLayer } from './AnnotationLayer.js';
import { AnnotationToolbar, type AnnotationToolbarLabels } from './AnnotationToolbar.js';
import { ImageAnnotator } from './ImageAnnotator.js';
import type { Annotation2D } from './types.js';

const labels: AnnotationToolbarLabels = {
  select: 'Select',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  cloud: 'Cloud',
  freehand: 'Freehand',
  text: 'Text',
  blur: 'Blur',
  color: 'Colour',
  strokeWidth: 'Width',
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
  undo: 'Undo',
  redo: 'Redo',
  delete: 'Delete',
  clear: 'Clear',
};

const annotations: Annotation2D[] = [
  { id: '1', tool: 'rect', points: [[0.1, 0.1], [0.5, 0.5]], color: '#ef4444', strokeWidth: 6 },
  { id: '2', tool: 'arrow', points: [[0.2, 0.2], [0.8, 0.6]], color: '#2563eb', strokeWidth: 6 },
  { id: '3', tool: 'text', points: [[0.3, 0.3]], text: 'Crack', color: '#16a34a', strokeWidth: 6 },
  { id: '4', tool: 'blur', points: [[0.6, 0.6], [0.9, 0.9]], color: '#f59e0b', strokeWidth: 10 },
];

describe('AnnotationLayer rendering', () => {
  it('renders an SVG with each shape', () => {
    const html = renderToStaticMarkup(<AnnotationLayer annotations={annotations} width={400} height={300} />);
    expect(html).toContain('<svg');
    expect(html).toContain('<rect');
    expect(html).toContain('<polyline'); // arrow head
    expect(html).toContain('<text');
    expect(html).toContain('Crack');
  });
});

describe('AnnotationToolbar rendering', () => {
  it('renders a button per tool plus colours', () => {
    const html = renderToStaticMarkup(
      <AnnotationToolbar
        tool="select"
        onToolChange={() => {}}
        color="#ef4444"
        onColorChange={() => {}}
        strokeWidth={6}
        onStrokeWidthChange={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        canUndo={false}
        canRedo={false}
        onDelete={() => {}}
        canDelete={false}
        onClear={() => {}}
        canClear={false}
        labels={labels}
      />,
    );
    expect(html).toContain('aria-label="Rectangle"');
    expect(html).toContain('aria-label="Blur"');
    expect(html).toContain('Clear');
  });
});

describe('ImageAnnotator rendering', () => {
  it('mounts with the image without throwing', () => {
    const html = renderToStaticMarkup(
      <ImageAnnotator
        imageUrl="https://example.test/photo.jpg"
        value={annotations}
        onChange={() => {}}
        tool="select"
        onToolChange={() => {}}
        color="#ef4444"
        strokeWidth={6}
        selectedId={null}
        onSelectedIdChange={() => {}}
      />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('https://example.test/photo.jpg');
  });
});
