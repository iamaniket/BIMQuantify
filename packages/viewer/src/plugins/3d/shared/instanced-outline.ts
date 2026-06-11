/**
 * InstancedOutline — GPU-instanced renderer for a model's hard-edge outline.
 *
 * Each unique edge shape ("template") is uploaded to the GPU ONCE as a small
 * float texture of local segment endpoints (`segTex`); every element that
 * places that shape contributes a 4x4 in a second texture (`elemTex`). One
 * `InstancedOutlineMesh` then draws `segCount * elementCount` instances in a
 * single call — 10k identical windows cost one window's segments plus 10k
 * matrices instead of 10k baked copies. See {@link InstancedLineMaterial} for
 * the shader that reads those textures.
 *
 * Hybrid policy: only shapes reused by ≥ {@link INSTANCE_FANOUT_THRESHOLD}
 * elements (and not pathologically large) are instanced. Singletons and huge
 * unique shapes stay on the proven CPU-merged `LineSegmentsGeometry` path,
 * where instancing overhead would outweigh the saving.
 *
 * All of a model's objects live in one `THREE.Group`; the owning plugin adds it
 * to the scene and toggles its visibility for the idle frame. Hide/isolate
 * rebuilds only the (small) element textures and CPU chunks — never the shared
 * segment textures.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { LAYER_DEFAULT } from '../../../core/layers.js';
import { applyClippingPlanes } from './clipping.js';
import { InstancedLineMaterial } from './instanced-line-material.js';
import {
  mergeChunks,
  transformSegments,
  type InstanceRow,
  type OutlineModel,
} from './outline-cache.js';

/** ≥ this many placements of one shape ⇒ GPU instancing wins over CPU merge. */
const INSTANCE_FANOUT_THRESHOLD = 4;
/** Segment count above which a shape stays CPU-merged (keeps S*E bounded). */
const S_MAX = 50_000;

// The fat-line base quad — copied verbatim from LineSegmentsGeometry so the
// vertex shader's screen-space expansion behaves identically.
const QUAD_POS = [-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0];
const QUAD_UV = [-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2];
const QUAD_INDEX = [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5];

export type OutlineFilter = { visible?: Set<number>; hidden?: Set<number> } | null;

function rowVisible(localId: number, filter: OutlineFilter): boolean {
  if (!filter) return true;
  if (filter.visible) return filter.visible.has(localId);
  if (filter.hidden) return !filter.hidden.has(localId);
  return true;
}

function makeFloatTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Pack a template's local segments as 2 RGBA texels each: (sx,sy,sz,ex),(ey,ez,0,0). */
function buildSegTexture(
  template: Float32Array,
  maxTex: number,
): { tex: THREE.DataTexture; width: number; segCount: number } {
  const segCount = Math.floor(template.length / 6);
  const texels = Math.max(1, segCount * 2);
  const width = Math.min(maxTex, texels);
  const height = Math.ceil(texels / width);
  const data = new Float32Array(width * height * 4);
  for (let k = 0; k < segCount; k++) {
    const o = k * 6;
    const t0 = k * 2 * 4;
    const t1 = (k * 2 + 1) * 4;
    data[t0] = template[o]!;
    data[t0 + 1] = template[o + 1]!;
    data[t0 + 2] = template[o + 2]!;
    data[t0 + 3] = template[o + 3]!;
    data[t1] = template[o + 4]!;
    data[t1 + 1] = template[o + 5]!;
  }
  return { tex: makeFloatTexture(data, width, height), width, segCount };
}

/** Pack visible element transforms as 4 RGBA texels each (one column per texel). */
function buildElemTexture(
  rows: InstanceRow[],
  maxTex: number,
): { tex: THREE.DataTexture; width: number; count: number } {
  const count = rows.length;
  const texels = Math.max(1, count * 4);
  const width = Math.min(maxTex, texels);
  const height = Math.ceil(texels / width);
  const data = new Float32Array(width * height * 4);
  for (let e = 0; e < count; e++) {
    const m = rows[e]!.transform;
    for (let c = 0; c < 4; c++) {
      const t = (e * 4 + c) * 4;
      data[t] = m[c * 4]!;
      data[t + 1] = m[c * 4 + 1]!;
      data[t + 2] = m[c * 4 + 2]!;
      data[t + 3] = m[c * 4 + 3]!;
    }
  }
  return { tex: makeFloatTexture(data, width, height), width, count };
}

/** A bare instanced quad whose endpoints come from textures, not attributes. */
class InstancedOutlineMesh extends THREE.Mesh {
  segTex: THREE.DataTexture;
  segTexW: number;
  segCount: number;
  elemTex: THREE.DataTexture;
  elemTexW: number;
  private readonly mat: InstancedLineMaterial;

  constructor(
    material: InstancedLineMaterial,
    segTex: THREE.DataTexture,
    segTexW: number,
    segCount: number,
    elemTex: THREE.DataTexture,
    elemTexW: number,
    instanceCount: number,
  ) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(QUAD_INDEX);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(QUAD_POS, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(QUAD_UV, 2));
    geo.instanceCount = instanceCount;
    super(geo, material);
    this.mat = material;
    this.segTex = segTex;
    this.segTexW = segTexW;
    this.segCount = segCount;
    this.elemTex = elemTex;
    this.elemTexW = elemTexW;
    this.frustumCulled = false;
    this.renderOrder = 998;
    this.layers.set(LAYER_DEFAULT);
  }

  // Outlines are never picked.
  override raycast(): void {}

  // The textures/counts differ per template but the material is shared, so feed
  // this object's values just before it draws.
  override onBeforeRender(): void {
    const u = this.mat.uniforms;
    u.uSegTex!.value = this.segTex;
    u.uElemTex!.value = this.elemTex;
    u.uSegCount!.value = this.segCount;
    u.uSegTexW!.value = this.segTexW;
    u.uElemTexW!.value = this.elemTexW;
  }
}

interface InstancedTemplate {
  mesh: InstancedOutlineMesh;
  segTex: THREE.DataTexture;
  segCount: number;
  rows: InstanceRow[]; // every placement of this template (full, unfiltered)
}

interface ModelOutline {
  group: THREE.Group;
  instanced: InstancedTemplate[];
  cpuTemplates: { template: Float32Array; rows: InstanceRow[] }[];
  cpuChunks: LineSegmentsGeometry[];
  cpuObjects: LineSegments2[];
}

export interface InstancedOutlineOptions {
  color: number;
  lineWidth: number;
  opacity?: number;
}

export class InstancedOutline {
  private readonly maxTex: number;
  private readonly materialInstanced: InstancedLineMaterial;
  private readonly materialCpu: LineMaterial;
  private readonly models = new Map<string, ModelOutline>();
  private clipInstanced = -1;
  private clipCpu = -1;

  constructor(maxTextureSize: number, opts: InstancedOutlineOptions) {
    this.maxTex = Math.max(1, Math.floor(maxTextureSize) || 1);
    const opacity = opts.opacity ?? 0.9;
    this.materialInstanced = new InstancedLineMaterial({
      color: opts.color,
      linewidth: opts.lineWidth,
      opacity,
      transparent: true,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.materialCpu = new LineMaterial({
      color: opts.color,
      linewidth: opts.lineWidth,
      worldUnits: false,
      transparent: true,
      opacity,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      resolution: new THREE.Vector2(1, 1),
    });
  }

  has(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /**
   * Build all outline objects for a model and return their group (the caller
   * adds it to the scene and owns its visibility). `filter` is the initial
   * visible set.
   */
  setModel(modelId: string, model: OutlineModel, filter: OutlineFilter): THREE.Group {
    this.disposeModel(modelId);

    const group = new THREE.Group();
    group.name = `outline::${modelId}`;
    const instanced: InstancedTemplate[] = [];
    const cpuTemplates: { template: Float32Array; rows: InstanceRow[] }[] = [];

    for (let t = 0; t < model.templates.length; t++) {
      const template = model.templates[t]!;
      const rows = model.instancesByTemplate[t] ?? [];
      if (rows.length === 0 || template.length === 0) continue;
      const segCount = Math.floor(template.length / 6);

      if (rows.length >= INSTANCE_FANOUT_THRESHOLD && segCount <= S_MAX) {
        const { tex: segTex, width: segTexW } = buildSegTexture(template, this.maxTex);
        const visible = rows.filter((r) => rowVisible(r.localId, filter));
        const { tex: elemTex, width: elemTexW, count } = buildElemTexture(visible, this.maxTex);
        const mesh = new InstancedOutlineMesh(
          this.materialInstanced,
          segTex,
          segTexW,
          segCount,
          elemTex,
          elemTexW,
          segCount * count,
        );
        mesh.visible = count > 0;
        group.add(mesh);
        instanced.push({ mesh, segTex, segCount, rows });
      } else {
        cpuTemplates.push({ template, rows });
      }
    }

    const entry: ModelOutline = { group, instanced, cpuTemplates, cpuChunks: [], cpuObjects: [] };
    this.models.set(modelId, entry);
    this.rebuildCpu(entry, filter);
    return entry.group;
  }

  /** Re-filter (hide/isolate): rebuild only element textures + CPU chunks. */
  applyFilter(modelId: string, filter: OutlineFilter): void {
    const m = this.models.get(modelId);
    if (!m) return;
    for (const it of m.instanced) {
      const visible = it.rows.filter((r) => rowVisible(r.localId, filter));
      const { tex, width, count } = buildElemTexture(visible, this.maxTex);
      it.mesh.elemTex.dispose();
      it.mesh.elemTex = tex;
      it.mesh.elemTexW = width;
      (it.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = it.segCount * count;
      it.mesh.visible = count > 0;
    }
    this.rebuildCpu(m, filter);
  }

  setResolution(width: number, height: number): void {
    this.materialInstanced.resolution.set(width, height);
    this.materialCpu.resolution.set(width, height);
  }

  setClippingPlanes(planes: THREE.Plane[]): void {
    this.clipInstanced = applyClippingPlanes(this.materialInstanced, planes, this.clipInstanced);
    this.clipCpu = applyClippingPlanes(this.materialCpu, planes, this.clipCpu);
  }

  disposeModel(modelId: string): void {
    const m = this.models.get(modelId);
    if (!m) return;
    for (const it of m.instanced) {
      m.group.remove(it.mesh);
      it.mesh.geometry.dispose();
      it.segTex.dispose();
      it.mesh.elemTex.dispose();
    }
    this.clearCpu(m);
    m.group.removeFromParent();
    this.models.delete(modelId);
  }

  dispose(): void {
    for (const modelId of [...this.models.keys()]) this.disposeModel(modelId);
    this.materialInstanced.dispose();
    this.materialCpu.dispose();
  }

  private clearCpu(m: ModelOutline): void {
    for (const obj of m.cpuObjects) m.group.remove(obj);
    for (const geo of m.cpuChunks) geo.dispose();
    m.cpuChunks = [];
    m.cpuObjects = [];
  }

  // Expand the visible rows of low-fan-out templates to world space and merge
  // into a few LineSegmentsGeometry chunks — the proven non-instanced path.
  private rebuildCpu(m: ModelOutline, filter: OutlineFilter): void {
    this.clearCpu(m);
    const slices: Float32Array[] = [];
    for (const { template, rows } of m.cpuTemplates) {
      for (const r of rows) {
        if (!rowVisible(r.localId, filter)) continue;
        const out = new Float32Array(template.length);
        transformSegments(template, r.transform, out, 0);
        slices.push(out);
      }
    }
    const chunks = mergeChunks(slices);
    m.cpuChunks = chunks;
    for (const geo of chunks) {
      const obj = new LineSegments2(geo, this.materialCpu);
      obj.layers.set(LAYER_DEFAULT);
      obj.renderOrder = 998;
      obj.frustumCulled = false;
      m.group.add(obj);
      m.cpuObjects.push(obj);
    }
  }
}
