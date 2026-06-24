/**
 * Baked silhouette contact shadow.
 *
 * Borrows the render-to-texture + blur technique from the classic three.js
 * "contact shadow" example (and ThatOpen's `ShadowDropper`), but adapts it to
 * this viewer's streaming-fragments architecture:
 *
 *  - The shadow is baked from a fixed **top-down orthographic** camera, so it
 *    is independent of the user's viewpoint. It only needs re-baking when the
 *    *geometry or visibility* changes — never on camera motion. The `Viewer`
 *    drives `bake()` once on the idle frame after a load / isolation / x-ray
 *    change, not per frame.
 *  - `LodMode.ALL_VISIBLE` (see `Viewer.loadFragments`) means the model isn't
 *    frustum-culled to the user camera, so the bake camera sees the whole
 *    footprint rather than only what's on screen.
 *  - The silhouette is rendered with a customised `MeshDepthMaterial`, which
 *    three.js compiles with instancing/batching support — required because
 *    `FragmentsModels` draws instanced/batched meshes. A hand-written shader
 *    would collapse every instance to the origin.
 *
 * The output is a single-channel (alpha) silhouette mask, blurred twice, that
 * the `Viewer`'s ground plane samples. The plane keeps its `uLinearBlend`
 * uniform so the effects plugin's linear-composite alpha compensation still
 * works (see `plugins/3d/effects`).
 */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

export interface ContactShadowOptions {
  /** Square RT resolution in px. Default 1024. */
  resolution?: number;
  /** Silhouette alpha written per covered fragment (pre-`opacity`). Default 1. */
  darkness?: number;
  /** Normalised blur kernel (fraction of footprint). Default 0.012. */
  blur?: number;
  /**
   * Fraction of the footprint added as padding around the silhouette on every
   * side, so the blur has room to fade out instead of clipping at the texture
   * edge. Default 0.15.
   */
  pad?: number;
}

/** The square world region a baked texture maps to. */
export interface ContactShadowRect {
  /** World-space centre the (square) texture is framed around. */
  cx: number;
  cz: number;
  /** World side length the texture spans (X and Z). */
  side: number;
  /** World Y the shadow sits at (the visible set's floor). */
  groundY: number;
}

const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _prevClear = new THREE.Color();
const _boxSize = new THREE.Vector3();
const _boxCenter = new THREE.Vector3();
// Identity — the unit footprint quad is ALREADY pre-rotated into the XZ plane in
// the constructor, so instance matrices only translate + scale. Rotating again
// here would stand the footprints up vertically (edge-on to the top-down bake
// camera → an empty silhouette).
const _identityQuat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _mat = new THREE.Matrix4();

/** Renderer state both bake paths mutate and must restore. */
interface SavedRendererState {
  target: THREE.WebGLRenderTarget | null;
  autoClear: boolean;
  clearAlpha: number;
  clear: THREE.Color;
}

export class ContactShadowBaker {
  /** Stable texture reference the display plane samples — updated in place per bake. */
  readonly texture: THREE.Texture;

  private readonly resolution: number;
  private readonly darkness: number;
  private readonly blur: number;
  private readonly pad: number;

  private readonly rt: THREE.WebGLRenderTarget;
  private readonly rtBlur: THREE.WebGLRenderTarget;
  private readonly bakeCamera: THREE.OrthographicCamera;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private readonly fsQuad: FullScreenQuad;
  /**
   * Unit XZ-plane quad reused by {@link bakeBoxes} as the instanced footprint
   * primitive. `PlaneGeometry` defaults to the XY plane; pre-rotate it -π/2 about
   * X so it lies flat in XZ (matching the display ground plane) and per-box
   * instance matrices only translate + scale.
   */
  private readonly unitQuad: THREE.PlaneGeometry;
  /** Transient instanced footprint scene for {@link bakeBoxes} (reused across bakes). */
  private readonly boxScene: THREE.Scene;
  private readonly hBlur: THREE.ShaderMaterial;
  private readonly vBlur: THREE.ShaderMaterial;
  /** Concrete uniform handles (the cloned `uniforms` is an index signature). */
  private readonly hUniforms: { tDiffuse: THREE.IUniform; h: THREE.IUniform };
  private readonly vUniforms: { tDiffuse: THREE.IUniform; v: THREE.IUniform };

  constructor(opts: ContactShadowOptions = {}) {
    this.resolution = opts.resolution ?? 1024;
    this.darkness = opts.darkness ?? 1.0;
    this.blur = opts.blur ?? 0.012;
    this.pad = opts.pad ?? 0.15;

    const targetOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    };
    this.rt = new THREE.WebGLRenderTarget(
      this.resolution,
      this.resolution,
      targetOpts,
    );
    this.rt.texture.generateMipmaps = false;
    this.rtBlur = new THREE.WebGLRenderTarget(
      this.resolution,
      this.resolution,
      targetOpts,
    );
    this.rtBlur.texture.generateMipmaps = false;
    this.texture = this.rt.texture;

    // Looks straight down -Y; frustum is reframed to the footprint per bake.
    this.bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // MeshDepthMaterial gives us instancing/batching support for free; we only
    // override the final colour so every covered fragment writes a flat
    // `darkness` alpha (a pure footprint silhouette, independent of depth).
    const darknessUniform = { value: this.darkness };
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.BasicDepthPacking,
    });
    this.depthMaterial.depthTest = false;
    this.depthMaterial.depthWrite = false;
    this.depthMaterial.onBeforeCompile = (shader): void => {
      shader.uniforms.darkness = darknessUniform;
      shader.fragmentShader =
        'uniform float darkness;\n' +
        shader.fragmentShader.replace(
          'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
          'gl_FragColor = vec4( vec3( 0.0 ), darkness );',
        );
    };

    this.hBlur = new THREE.ShaderMaterial({
      ...HorizontalBlurShader,
      uniforms: THREE.UniformsUtils.clone(HorizontalBlurShader.uniforms),
      depthTest: false,
    });
    this.vBlur = new THREE.ShaderMaterial({
      ...VerticalBlurShader,
      uniforms: THREE.UniformsUtils.clone(VerticalBlurShader.uniforms),
      depthTest: false,
    });
    this.hUniforms = this.hBlur.uniforms as {
      tDiffuse: THREE.IUniform;
      h: THREE.IUniform;
    };
    this.vUniforms = this.vBlur.uniforms as {
      tDiffuse: THREE.IUniform;
      v: THREE.IUniform;
    };
    this.fsQuad = new FullScreenQuad(this.hBlur);

    this.unitQuad = new THREE.PlaneGeometry(1, 1);
    this.unitQuad.rotateX(-Math.PI / 2);
    this.boxScene = new THREE.Scene();
  }

  /**
   * Render the silhouette of `modelRoots` (framed to the world AABB `box`) into
   * the texture and blur it. Renders the live `scene` with the depth override,
   * temporarily hiding every direct child that isn't a model root or a light
   * (the ground plane, grid, overlays, measurement lines, …) so only building
   * geometry casts.
   *
   * Returns the square world region the texture maps to, or `null` if `box` is
   * empty (nothing visible — caller hides the plane). Saves and restores all
   * mutated renderer/scene state.
   */
  bake(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    modelRoots: ReadonlySet<THREE.Object3D>,
    box: THREE.Box3,
  ): ContactShadowRect | null {
    const rect = this.frameCamera(box);
    if (rect === null) return null;

    const saved = this.saveRendererState(renderer);
    const prevBackground = scene.background;
    const prevOverride = scene.overrideMaterial;

    // Hide everything that isn't building geometry for the silhouette pass.
    const hidden: THREE.Object3D[] = [];
    for (const child of scene.children) {
      if (modelRoots.has(child)) continue;
      if ((child as THREE.Light).isLight) continue;
      if (child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }

    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    scene.background = null;
    scene.overrideMaterial = this.depthMaterial;

    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.bakeCamera);

    scene.overrideMaterial = prevOverride;

    // Two blur passes — full then 0.4x — to soften and kill banding artifacts.
    this.blurPass(renderer, this.blur);
    this.blurPass(renderer, this.blur * 0.4);

    this.restoreRendererState(renderer, saved);
    scene.background = prevBackground;
    for (const child of hidden) child.visible = true;

    return rect;
  }

  /**
   * Box-silhouette bake: rasterise the XZ footprint of each world-space AABB in
   * `boxes` (framed to the union `box`) into the texture, then blur — no scene
   * geometry, so no model un-cull / streaming. Each footprint is an instance of
   * {@link unitQuad}; the flat-alpha depth override (depth test/write off) makes
   * the result a pure footprint silhouette, identical pipeline to {@link bake}.
   *
   * Over-approximates the true outline (axis-aligned boxes), but after the two
   * blur passes the soft 45%-opacity ground blob reads near-identical for dense
   * buildings. Returns the framed region, or `null` if `box` is empty.
   */
  bakeBoxes(
    renderer: THREE.WebGLRenderer,
    boxes: ReadonlyArray<THREE.Box3>,
    box: THREE.Box3,
  ): ContactShadowRect | null {
    const rect = this.frameCamera(box);
    if (rect === null) return null;

    // One instance per non-empty box: translate to the box's XZ centre at its
    // own floor, scale to its XZ extent. (The unit quad already lies in XZ.)
    let count = 0;
    for (const b of boxes) if (!b.isEmpty()) count++;
    const mesh = new THREE.InstancedMesh(this.unitQuad, this.depthMaterial, count);
    mesh.frustumCulled = false;
    let i = 0;
    for (const b of boxes) {
      if (b.isEmpty()) continue;
      const size = b.getSize(_boxSize);
      const center = b.getCenter(_boxCenter);
      _pos.set(center.x, b.min.y, center.z);
      _scale.set(Math.max(size.x, 1e-4), 1, Math.max(size.z, 1e-4));
      _mat.compose(_pos, _identityQuat, _scale);
      mesh.setMatrixAt(i++, _mat);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.boxScene.add(mesh);

    const saved = this.saveRendererState(renderer);
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rt);
    renderer.render(this.boxScene, this.bakeCamera);

    this.blurPass(renderer, this.blur);
    this.blurPass(renderer, this.blur * 0.4);

    this.restoreRendererState(renderer, saved);
    this.boxScene.remove(mesh);
    mesh.dispose();

    return rect;
  }

  /**
   * Reframe {@link bakeCamera} to the padded square footprint of `box`, looking
   * straight down. up = -Z makes texture +U → world +X and +V → world -Z, which
   * lines up with the display plane's UVs (PlaneGeometry rotated -π/2 about X) so
   * the silhouette lands un-mirrored over the geometry. Returns the world region
   * the texture maps to, or `null` when `box` is empty.
   */
  private frameCamera(box: THREE.Box3): ContactShadowRect | null {
    if (box.isEmpty()) return null;
    const size = box.getSize(_size);
    const center = box.getCenter(_center);
    const footprint = Math.max(size.x, size.z, 1);
    const side = footprint * (1 + this.pad * 2);
    const groundY = box.min.y;
    const height = Math.max(size.y, 1);

    this.bakeCamera.left = -side / 2;
    this.bakeCamera.right = side / 2;
    this.bakeCamera.top = side / 2;
    this.bakeCamera.bottom = -side / 2;
    this.bakeCamera.near = 0;
    this.bakeCamera.far = height + side;
    this.bakeCamera.position.set(center.x, box.max.y + height * 0.01, center.z);
    this.bakeCamera.up.set(0, 0, -1);
    this.bakeCamera.lookAt(center.x, groundY, center.z);
    this.bakeCamera.updateProjectionMatrix();
    this.bakeCamera.updateMatrixWorld();

    return { cx: center.x, cz: center.z, side, groundY };
  }

  /** Snapshot the renderer state both bake paths mutate. */
  private saveRendererState(renderer: THREE.WebGLRenderer): SavedRendererState {
    return {
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
      clearAlpha: renderer.getClearAlpha(),
      clear: renderer.getClearColor(_prevClear).clone(),
    };
  }

  /** Restore the renderer state saved by {@link saveRendererState}. */
  private restoreRendererState(
    renderer: THREE.WebGLRenderer,
    saved: SavedRendererState,
  ): void {
    renderer.setRenderTarget(saved.target);
    renderer.setClearColor(saved.clear, saved.clearAlpha);
    renderer.autoClear = saved.autoClear;
  }

  /** Horizontal (rt → rtBlur) then vertical (rtBlur → rt) blur of `this.rt`. */
  private blurPass(renderer: THREE.WebGLRenderer, amount: number): void {
    this.hUniforms.tDiffuse.value = this.rt.texture;
    this.hUniforms.h.value = amount;
    this.fsQuad.material = this.hBlur;
    renderer.setRenderTarget(this.rtBlur);
    this.fsQuad.render(renderer);

    this.vUniforms.tDiffuse.value = this.rtBlur.texture;
    this.vUniforms.v.value = amount;
    this.fsQuad.material = this.vBlur;
    renderer.setRenderTarget(this.rt);
    this.fsQuad.render(renderer);
  }

  dispose(): void {
    this.rt.dispose();
    this.rtBlur.dispose();
    this.depthMaterial.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
    this.fsQuad.dispose();
    this.unitQuad.dispose();
  }
}
