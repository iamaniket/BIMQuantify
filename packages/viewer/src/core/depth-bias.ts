/**
 * Shared log-depth bias constants.
 *
 * The renderer runs with `logarithmicDepthBuffer: true`, which writes
 * `gl_FragDepth` in the fragment shader and so bypasses the rasterizer's
 * `polygonOffset`. To separate coplanar geometry we re-create polygon offset
 * *in log space* by nudging `gl_FragDepth` toward the camera by a tiny,
 * deterministic amount (see the surface-material hook in `Viewer.ts`).
 *
 * These constants live here — not privately in `Viewer.ts` — so the outline
 * edge materials can derive a bias that reliably beats the surface bias and the
 * two can never drift apart.
 *
 * `COPLANAR_BIAS_EPS` is the per-level step in window-depth units. It must clear
 * 24-bit quantisation noise (~6e-8) yet stay far below anything visible. Tune
 * here if separation is incomplete (raise) or surfaces visibly "peter-pan" /
 * poke through neighbours (lower). Verify in the real viewer on :3001 — the
 * preview origin can't load model geometry.
 */
export const COPLANAR_BIAS_EPS = 2e-5;
export const COPLANAR_BIAS_LEVELS = 8;

/**
 * Bias for the model-emphasis outline edges. Surfaces are pulled toward the
 * camera by up to `COPLANAR_BIAS_LEVELS * COPLANAR_BIAS_EPS`; the edge must beat
 * that worst case so it never sinks behind the surface it traces. One extra
 * level of headroom makes the edge a strict depth winner (not a flickering
 * tie), while staying far below the visible threshold.
 */
export const OUTLINE_LOG_DEPTH_BIAS =
  (COPLANAR_BIAS_LEVELS + 1) * COPLANAR_BIAS_EPS; // 1.8e-4
