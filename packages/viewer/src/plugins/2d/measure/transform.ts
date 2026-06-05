/**
 * Pure (no React/Three) coordinate transform between the PDF geometry artifact
 * space and CSS pixel space of the rendered page.
 *
 * Artifact space: PDF points, Y-up, bottom-left origin, box-relative
 * (0 ≤ ax ≤ w, 0 ≤ ay ≤ h). The box offset x0,y0 was already subtracted by the
 * extractor, so it is never needed here.
 *
 * CSS space: device-independent pixels, Y-down, top-left origin, inside the
 * rendered page rect `{pageW, pageH}` (which already reflects the chosen scale
 * AND rotation — pdfjs transposes the box at 90/270, so pageW/pageH are the
 * post-rotation dims).
 */

export interface PdfTransformParams {
  /** Artifact page-box width in PDF points. */
  w: number;
  /** Artifact page-box height in PDF points. */
  h: number;
  /** Rendered page width in CSS px (post scale + rotation). */
  pageW: number;
  /** Rendered page height in CSS px (post scale + rotation). */
  pageH: number;
  /** Combined rotation in degrees: `(userRotation + (pageGeometry.rot ?? 0)) % 360`. */
  rotation: number;
}

/** Snap an arbitrary rotation to the nearest legal quarter-turn. */
function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/** Artifact point (PDF points, Y-up) → CSS px (Y-down, top-left) inside the page rect. */
export function artifactToCss(
  ax: number,
  ay: number,
  params: PdfTransformParams,
): [number, number] {
  const { w, h, pageW: W, pageH: H } = params;
  const u = w === 0 ? 0 : ax / w;
  const v = h === 0 ? 0 : ay / h;
  switch (normalizeRotation(params.rotation)) {
    case 90:
      return [(1 - v) * W, (1 - u) * H];
    case 180:
      return [(1 - u) * W, v * H];
    case 270:
      return [v * W, u * H];
    case 0:
    default:
      return [u * W, (1 - v) * H];
  }
}

/** Inverse of {@link artifactToCss}: CSS px → artifact point (PDF points, Y-up). */
export function cssToArtifact(
  px: number,
  py: number,
  params: PdfTransformParams,
): [number, number] {
  const { w, h, pageW: W, pageH: H } = params;
  const U = W === 0 ? 0 : px / W;
  const V = H === 0 ? 0 : py / H;
  let u: number;
  let v: number;
  switch (normalizeRotation(params.rotation)) {
    case 90:
      u = 1 - V;
      v = 1 - U;
      break;
    case 180:
      u = 1 - U;
      v = V;
      break;
    case 270:
      u = V;
      v = U;
      break;
    case 0:
    default:
      u = U;
      v = 1 - V;
      break;
  }
  return [u * w, v * h];
}

/** Length between two artifact-space points, in PDF points (rotation-invariant). */
export function artifactDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(bx - ax, by - ay);
}
