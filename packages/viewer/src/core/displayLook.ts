/**
 * Display-mode "looks" — whole-model material transforms applied as GLSL
 * injections, composed with the per-material coplanar depth-bias so the two
 * never clobber each other (see {@link applyLookToMaterial} and the material
 * hook in `Viewer.ts`).
 *
 * Why GLSL injection rather than mutating `material.color` / `vertexColors`:
 * BIM element colours arrive as per-instance attributes, not the material's
 * scalar `color`, so a flat colour can't desaturate them. Editing the final
 * fragment colour is the only transform that is uniform across instanced
 * geometry AND fully reversible.
 *
 * Why the looks override the FINAL colour (and inject their own view-space
 * normal varying): the fragment materials are a mix of lit (Lambert/Standard)
 * and UNLIT (Basic) types. Relying on the material's own lighting made clay/
 * matcap invisible on the unlit geometry. Computing our own normal-based shade
 * and writing `gl_FragColor` directly gives every surface the same dramatic,
 * form-revealing look regardless of how its base material is shaded.
 *
 * Why material-level, not a post-processing pass: the viewer renders
 * on-demand (the post composite only runs on the idle frame). A screen-space
 * pass would flash back to full colour during camera motion; a material edit
 * persists across motion and idle alike.
 */

import type * as THREE from 'three';

import type { MaterialLook } from './types.js';

// Rec. 709 luma weights — monochrome keeps per-element value (a dark duct vs a
// light wall stay distinguishable) while dropping hue.
const LUMA = 'vec3( 0.2126, 0.7152, 0.0722 )';

// Our own view-space normal varying, injected into vertex + fragment for the
// shaded looks so they work on unlit materials too. `gl_FrontFacing` re-orients
// it for back faces (geometry is rendered DoubleSide).
const VARYING_DECL = 'varying vec3 vDmViewNormal;';
const VARYING_WRITE = 'vDmViewNormal = normalize( normalMatrix * objectNormal );';
// Re-oriented unit view normal, available to the fragment look snippets as `dmN`.
const FRAG_NORMAL = 'vec3 dmN = normalize( vDmViewNormal ); dmN = gl_FrontFacing ? dmN : -dmN;';

// Warm clay study-model shade.
const CLAY_SHADED = `${FRAG_NORMAL}
\t\tfloat dmL = clamp( dmN.z, 0.0, 1.0 );
\t\tgl_FragColor.rgb = vec3( 0.87, 0.82, 0.73 ) * ( 0.35 + 0.65 * dmL );`;
const CLAY_FLAT = 'gl_FragColor.rgb = vec3( 0.85, 0.80, 0.71 );';

// Cool ceramic matcap with a bright fresnel rim.
const MATCAP_SHADED = `${FRAG_NORMAL}
\t\tfloat dmF = clamp( dmN.z, 0.0, 1.0 );
\t\tfloat dmRim = pow( 1.0 - dmF, 3.0 ) * 0.45;
\t\tgl_FragColor.rgb = vec3( 0.52, 0.58, 0.68 ) * ( 0.18 + 0.82 * pow( dmF, 0.6 ) ) + vec3( 0.85, 0.90, 1.0 ) * dmRim;`;
const MATCAP_FLAT = 'gl_FragColor.rgb = vec3( 0.55, 0.60, 0.68 );';

const NOOP: NonNullable<THREE.Material['onBeforeCompile']> = () => {
  /* restored to a no-op so the program cache key is stable */
};

/** Inject the depth bias into the fragment shader's log-depth chunk. */
function injectBias(shader: { fragmentShader: string }, biasLiteral: string): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <logdepthbuf_fragment>',
    `#include <logdepthbuf_fragment>
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
\tgl_FragDepth -= ${biasLiteral};
#endif`,
  );
}

/**
 * Inject our view-space normal varying into BOTH shader stages. Returns true if
 * it could be wired up (the vertex shader has the chunks we hook); false means
 * the caller must use a flat fallback that doesn't reference the varying (so we
 * never emit a fragment varying with no matching vertex output → link error).
 */
function injectViewNormal(shader: { vertexShader: string; fragmentShader: string }): boolean {
  const v = shader.vertexShader;
  if (!v.includes('#include <common>') || !v.includes('#include <beginnormal_vertex>')) {
    return false;
  }
  shader.vertexShader = v
    .replace('#include <common>', `#include <common>\n${VARYING_DECL}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n\t${VARYING_WRITE}`);
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>\n${VARYING_DECL}`,
  );
  return true;
}

/**
 * Inject a look's colour override just BEFORE the colour-management chunk, so it
 * writes a LINEAR colour that `<colorspace_fragment>` then encodes the same way
 * in both render paths (the direct sRGB-canvas render during motion AND the
 * linear half-float composite at rest). Injecting *after* colour management
 * instead would write un-encoded values straight to the sRGB canvas, making the
 * look pop darker during motion and only correct at idle.
 */
function injectFinalColor(shader: { fragmentShader: string }, body: string): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <colorspace_fragment>',
    `\t{\n\t\t${body}\n\t}\n#include <colorspace_fragment>`,
  );
}

/**
 * Build the combined `onBeforeCompile` for a material: the coplanar depth bias
 * (when `biasLiteral` is non-null) plus the active look's fragment edit.
 * Returns `null` when nothing needs injecting (no bias and the `normal` look).
 */
function buildOnBeforeCompile(
  biasLiteral: string | null,
  look: MaterialLook,
): NonNullable<THREE.Material['onBeforeCompile']> | null {
  if (biasLiteral === null && look === 'normal') return null;

  return (shader): void => {
    if (biasLiteral !== null) injectBias(shader, biasLiteral);

    if (look === 'monochrome') {
      // Desaturate the final shaded colour — keeps lighting/value, drops hue.
      injectFinalColor(shader, `gl_FragColor.rgb = vec3( dot( gl_FragColor.rgb, ${LUMA} ) );`);
    } else if (look === 'clay') {
      const shaded = injectViewNormal(shader);
      injectFinalColor(shader, shaded ? CLAY_SHADED : CLAY_FLAT);
    } else if (look === 'matcap') {
      const shaded = injectViewNormal(shader);
      injectFinalColor(shader, shaded ? MATCAP_SHADED : MATCAP_FLAT);
    }
  };
}

/**
 * (Re)apply the active look to a single material, composing it with that
 * material's stored coplanar bias (`userData.dmBias`, set by the Viewer's
 * material hook). Idempotent; flips `needsUpdate` so the program recompiles.
 * Restoring to `normal` removes the look while preserving the depth bias.
 */
export function applyLookToMaterial(
  material: THREE.Material,
  look: MaterialLook,
): void {
  const ud = material.userData as { dmBias?: string | null; dmLookApplied?: boolean };
  const bias = typeof ud.dmBias === 'string' ? ud.dmBias : null;
  const fn = buildOnBeforeCompile(bias, look);
  // THREE keys the program cache on `onBeforeCompile.toString()` by default. Our
  // closures all stringify identically (look/bias are captured, not in the source
  // text), so distinct looks — and distinct bias literals — would collapse onto a
  // single cached program and never recompile. Pin an explicit cache key per
  // (look, bias) so each combination gets its own program.
  const cacheKey = `dm|${look}|${bias ?? 'n'}`;
  if (fn) {
    material.onBeforeCompile = fn;
    material.customProgramCacheKey = () => cacheKey;
    material.needsUpdate = true;
    ud.dmLookApplied = true;
  } else if (ud.dmLookApplied) {
    // Was previously injected (e.g. an IfcSpace overlay that had no bias but
    // got a look); restore the no-op so it renders exactly as before.
    material.onBeforeCompile = NOOP;
    material.customProgramCacheKey = () => cacheKey;
    material.needsUpdate = true;
    ud.dmLookApplied = false;
  }
}
