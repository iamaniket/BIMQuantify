/**
 * Types-only module for the 2D measure plugin. Kept free of any runtime imports
 * (no three.js) so it can be imported by both the plugin and host apps (the
 * shared measurement panel) without pulling in the renderer.
 */

export type PdfMeasureMode = 'distance' | 'angle' | 'area';

export interface PdfMeasurement {
  id: string;
  type: PdfMeasureMode;
  /**
   * Vertices in artifact space (PDF points, Y-up). `distance` has 2, `angle` has
   * 3 (the middle point is the vertex), `area` has ≥3. Everything visual is
   * reconstructed from these on every reproject, so they survive zoom/rotation.
   */
  points: Array<[number, number]>;
  /** Measured value in PDF units: pt (distance), degrees (angle), pt² (area). */
  valuePoints: number;
  /** Pre-formatted display label, e.g. "123.4 pt", "45.0°", "1234 pt²". */
  label: string;
  visible: boolean;
  /** 1-based page this measurement belongs to. */
  page: number;
}
