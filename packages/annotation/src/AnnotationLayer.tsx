/**
 * Read-only SVG overlay that renders a set of annotations into a pixel box. The
 * host positions it over the image (e.g. absolutely, matching the displayed
 * image rect). Pure presentation — no pointer handling, no state.
 */

import type { CSSProperties, JSX } from 'react';

import { ShapeView } from './shapes.js';
import type { Annotation2D } from './types.js';

export interface AnnotationLayerProps {
  annotations: Annotation2D[];
  /** Width/height of the box the annotations are normalized against (px). */
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
}

export function AnnotationLayer({
  annotations,
  width,
  height,
  className,
  style,
}: AnnotationLayerProps): JSX.Element {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={style}
      aria-hidden
    >
      {annotations.map((a) => (
        <ShapeView key={a.id} a={a} box={{ width, height }} />
      ))}
    </svg>
  );
}
