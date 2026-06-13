/**
 * InstancedLineMaterial — a fat-line material that draws ONE local-space edge
 * template across many element placements with true GPU instancing.
 *
 * It is a minimal fork of three's `ShaderLib['line']` (the material behind
 * `LineMaterial`): the fragment shader is reused verbatim and the vertex shader
 * keeps every line of the screen-space width expansion, near-plane trim, world
 * units and clipping. The ONLY change is the source of each segment's two
 * endpoints. Stock LineMaterial reads them from per-segment instanced
 * attributes (`instanceStart`/`instanceEnd`); here `gl_InstanceID` is split into
 *   segIdx  = gl_InstanceID % uSegCount   (which segment of the template)
 *   elemIdx = gl_InstanceID / uSegCount   (which element placement)
 * the segment's local endpoints are fetched from `uSegTex` and the element's
 * 4x4 from `uElemTex`, then `modelViewMatrix * elemMatrix * local` reproduces
 * exactly what the stock shader computed — so width, clipping and world units
 * are untouched.
 *
 * Why no `glslVersion: GLSL3`: three always compiles ShaderMaterial as
 * `#version 300 es` and, crucially, only KEEPS the `gl_FragColor`/`attribute`/
 * `varying` compatibility defines when glslVersion is NOT GLSL3. Leaving it
 * unset lets us reuse the stock GLSL1-style shader + all `#include` chunks
 * unchanged while still using `gl_InstanceID`/`texelFetch` (both core in 300 es).
 *
 * The per-template uniforms (uSegTex/uElemTex/uSegCount/uSegTexW/uElemTexW)
 * differ per object, so one shared material is reused and each object injects
 * its own values in `onBeforeRender` (see instanced-outline.ts). Shared state
 * (color, opacity, linewidth, resolution, clipping) lives on the material.
 */

import {
  Color,
  ShaderLib,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
} from 'three';

const INSTANCING_DECL = /* glsl */ `
			uniform highp sampler2D uSegTex;
			uniform highp sampler2D uElemTex;
			uniform int uSegCount;
			uniform int uSegTexW;
			uniform int uElemTexW;

			void fetchSegment( int segIdx, out vec3 s, out vec3 e ) {
				int t0 = segIdx * 2;
				int t1 = t0 + 1;
				vec4 a = texelFetch( uSegTex, ivec2( t0 % uSegTexW, t0 / uSegTexW ), 0 );
				vec4 b = texelFetch( uSegTex, ivec2( t1 % uSegTexW, t1 / uSegTexW ), 0 );
				s = a.xyz;
				e = vec3( a.w, b.x, b.y );
			}

			mat4 fetchElemMatrix( int elemIdx ) {
				int m = elemIdx * 4;
				vec4 c0 = texelFetch( uElemTex, ivec2( m % uElemTexW, m / uElemTexW ), 0 );
				vec4 c1 = texelFetch( uElemTex, ivec2( ( m + 1 ) % uElemTexW, ( m + 1 ) / uElemTexW ), 0 );
				vec4 c2 = texelFetch( uElemTex, ivec2( ( m + 2 ) % uElemTexW, ( m + 2 ) / uElemTexW ), 0 );
				vec4 c3 = texelFetch( uElemTex, ivec2( ( m + 3 ) % uElemTexW, ( m + 3 ) / uElemTexW ), 0 );
				return mat4( c0, c1, c2, c3 );
			}`;

// The segment + element fetch, injected just before the stock `start` line.
const INSTANCED_PREAMBLE = /* glsl */ `int segIdx = gl_InstanceID % uSegCount;
			int elemIdx = gl_InstanceID / uSegCount;
			vec3 lStart, lEnd;
			fetchSegment( segIdx, lStart, lEnd );
			mat4 elemMatrix = fetchElemMatrix( elemIdx );
			`;

/**
 * Build the forked vertex shader from the stock one via single-line
 * exact-substring edits (robust to surrounding-whitespace changes). Throws if a
 * three.js upgrade drops a target line so the drift is caught at module load,
 * not as a silent compile failure.
 */
function buildVertexShader(): string {
  const base = ShaderLib['line']!.vertexShader;
  const out = base
    // Drop the per-segment position attributes; endpoints come from a texture.
    // (instanceColorStart/End stay declared but are dead under no USE_COLOR.)
    .replace('attribute vec3 instanceStart;', '')
    .replace('attribute vec3 instanceEnd;', '')
    // Add the samplers + fetch helpers next to the existing uniforms.
    .replace('uniform vec2 resolution;', `uniform vec2 resolution;\n${INSTANCING_DECL}`)
    // Compute the endpoints from the textures instead of per-segment attributes.
    .replace(
      'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
      `${INSTANCED_PREAMBLE}vec4 start = modelViewMatrix * elemMatrix * vec4( lStart, 1.0 );`,
    )
    .replace(
      'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
      'vec4 end = modelViewMatrix * elemMatrix * vec4( lEnd, 1.0 );',
    );

  if (out.includes('instanceStart') || out.includes('instanceEnd') || !out.includes('fetchSegment(')) {
    throw new Error(
      'InstancedLineMaterial: failed to patch the stock line vertex shader ' +
        '(three.js ShaderLib["line"] changed). Re-check the substring edits.',
    );
  }
  return out;
}

/**
 * Build the fragment shader. When `bias > 0` we re-create polygon offset in
 * log-depth space (the rasterizer's `polygonOffset` is a no-op under
 * `logarithmicDepthBuffer`) by nudging `gl_FragDepth` toward the camera — the
 * same trick `Viewer.ts` applies to surfaces, but with a larger bias so edges
 * win the depth test against the surface they trace. Throws if the stock chunk
 * moved, so a three.js upgrade surfaces the drift at module load.
 */
function buildFragmentShader(bias: number): string {
  const base = ShaderLib['line']!.fragmentShader;
  if (bias <= 0) return base;
  if (!base.includes('#include <logdepthbuf_fragment>')) {
    throw new Error(
      'InstancedLineMaterial: failed to patch the stock line fragment shader ' +
        '(three.js ShaderLib["line"] dropped <logdepthbuf_fragment>). ' +
        'Re-check the substring edit.',
    );
  }
  return base.replace(
    '#include <logdepthbuf_fragment>',
    `#include <logdepthbuf_fragment>
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
\tgl_FragDepth -= ${bias.toFixed(8)};
#endif`,
  );
}

export interface InstancedLineMaterialParameters {
  color?: number;
  linewidth?: number;
  opacity?: number;
  transparent?: boolean;
  depthTest?: boolean;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  /** Log-space depth bias toward the camera (px-independent). Default: 0. */
  depthBias?: number;
}

export class InstancedLineMaterial extends ShaderMaterial {
  readonly isInstancedLineMaterial = true;

  constructor(params: InstancedLineMaterialParameters = {}) {
    super({
      uniforms: UniformsUtils.merge([
        ShaderLib['line']!.uniforms,
        {
          uSegTex: { value: null },
          uElemTex: { value: null },
          uSegCount: { value: 0 },
          uSegTexW: { value: 1 },
          uElemTexW: { value: 1 },
        },
      ]),
      vertexShader: buildVertexShader(),
      fragmentShader: buildFragmentShader(params.depthBias ?? 0),
      clipping: true, // required so the clipping_planes chunks compile in
    });

    this.type = 'InstancedLineMaterial';
    const opacity = params.opacity ?? 1;
    this.uniforms.linewidth!.value = params.linewidth ?? 1;
    this.uniforms.diffuse!.value = new Color(params.color ?? 0xffffff);
    // The fragment shader reads the `opacity` UNIFORM; three never syncs the
    // Material.opacity field into a ShaderMaterial's uniforms, so set both.
    this.uniforms.opacity!.value = opacity;
    this.opacity = opacity;
    this.uniforms.resolution!.value = new Vector2(1, 1);

    this.transparent = params.transparent ?? false;
    this.depthTest = params.depthTest ?? true;
    this.polygonOffset = params.polygonOffset ?? false;
    this.polygonOffsetFactor = params.polygonOffsetFactor ?? 0;
    this.polygonOffsetUnits = params.polygonOffsetUnits ?? 0;
  }

  /** The shared resolution uniform (px). InstancedOutline keeps it in sync. */
  get resolution(): Vector2 {
    return this.uniforms.resolution!.value as Vector2;
  }
  set resolution(value: Vector2) {
    (this.uniforms.resolution!.value as Vector2).copy(value);
  }
}
