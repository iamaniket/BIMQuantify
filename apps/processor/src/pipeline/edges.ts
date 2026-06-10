/**
 * Edge extraction — compute hard-edge outlines from IFC geometry.
 *
 * Walks every element with geometry in the already-parsed web-ifc model,
 * tessellates it, runs Three.js `EdgesGeometry` to find dihedral-angle hard
 * edges, bakes the element transform into world space, and serialises the
 * results as a compact binary artifact that the viewer can consume directly
 * instead of recomputing edges on the frontend.
 *
 * Binary format (little-endian):
 *   u32  version       — currently 1
 *   f32  threshold     — angle threshold in degrees used for edge detection
 *   u32  numElements   — number of elements with edge data
 *   Per element:
 *     u32  expressID   — IFC express ID (matches fragments localId)
 *     u32  numFloats   — length of positions array
 *     f32[numFloats]   — edge line-segment positions (x1,y1,z1, x2,y2,z2, …)
 */

import * as THREE from 'three';
import type { IfcAPI } from 'web-ifc';

import { logger } from '../log.js';
import type { MetadataResult } from './metadata.js';

/** Angle (degrees) above which an edge between two faces counts as "hard". */
const EDGE_THRESHOLD_DEG = 30;

/** Header: version(u32) + threshold(f32) + numElements(u32) = 12 bytes. */
const HEADER_BYTES = 12;

/** Per-element header: expressID(u32) + numFloats(u32) = 8 bytes. */
const ELEMENT_HEADER_BYTES = 8;

interface ElementEdges {
  expressID: number;
  positions: Float32Array;
}

/**
 * Generate a binary edges artifact from the already-opened IFC model.
 *
 * `api` / `modelID` must point at a model that is still open in web-ifc.
 * `metadata` is used for the element list (only elements with geometry
 * expressIDs are iterated).
 */
export function generateEdges(
  api: IfcAPI,
  modelID: number,
  metadata: MetadataResult,
): Uint8Array {
  const elements: ElementEdges[] = [];

  // Collect expressIDs from metadata elements list
  const expressIDs = metadata.elements
    .map((el) => el.expressID)
    .filter((id): id is number => typeof id === 'number' && id > 0);

  logger.info({ count: expressIDs.length }, 'extracting edges for elements');

  for (const expressID of expressIDs) {
    try {
      const flatMesh = api.GetFlatMesh(modelID, expressID);
      const geoms = flatMesh.geometries;

      const parts: Float32Array[] = [];
      let totalFloats = 0;

      for (let i = 0; i < geoms.size(); i++) {
        const placed = geoms.get(i);
        const geom = api.GetGeometry(modelID, placed.geometryExpressID);

        const vData = api.GetVertexArray(
          geom.GetVertexData(),
          geom.GetVertexDataSize(),
        );
        const iData = api.GetIndexArray(
          geom.GetIndexData(),
          geom.GetIndexDataSize(),
        );
        geom.delete();

        if (vData.length === 0 || iData.length === 0) continue;

        // web-ifc vertex data: 6 floats per vertex (x,y,z, nx,ny,nz)
        const vertexCount = vData.length / 6;
        const positions = new Float32Array(vertexCount * 3);
        for (let v = 0; v < vertexCount; v++) {
          positions[v * 3] = vData[v * 6]!;
          positions[v * 3 + 1] = vData[v * 6 + 1]!;
          positions[v * 3 + 2] = vData[v * 6 + 2]!;
        }

        const bufGeo = new THREE.BufferGeometry();
        bufGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        bufGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(iData), 1));

        const edgesGeo = new THREE.EdgesGeometry(bufGeo, EDGE_THRESHOLD_DEG);
        bufGeo.dispose();

        const src = edgesGeo.getAttribute('position').array as ArrayLike<number>;
        if (src.length === 0) {
          edgesGeo.dispose();
          continue;
        }

        // Apply the placement transform to bake positions into world space
        const transform = new THREE.Matrix4().fromArray(placed.flatTransformation);
        const out = new Float32Array(src.length);
        const vec = new THREE.Vector3();
        for (let j = 0; j < src.length; j += 3) {
          vec.set(src[j]!, src[j + 1]!, src[j + 2]!).applyMatrix4(transform);
          out[j] = vec.x;
          out[j + 1] = vec.y;
          out[j + 2] = vec.z;
        }

        edgesGeo.dispose();
        parts.push(out);
        totalFloats += out.length;
      }

      flatMesh.delete();

      if (totalFloats === 0) continue;

      // Merge all parts for this element into one Float32Array
      let merged: Float32Array;
      if (parts.length === 1) {
        merged = parts[0]!;
      } else {
        merged = new Float32Array(totalFloats);
        let off = 0;
        for (const part of parts) {
          merged.set(part, off);
          off += part.length;
        }
      }

      elements.push({ expressID, positions: merged });
    } catch {
      // Some elements may not have geometry; skip silently.
    }
  }

  logger.info(
    { elementsWithEdges: elements.length },
    'edge extraction complete',
  );

  return serialise(elements);
}

/** Pack element edges into the binary format. */
function serialise(elements: ElementEdges[]): Uint8Array {
  let totalBytes = HEADER_BYTES;
  for (const el of elements) {
    totalBytes += ELEMENT_HEADER_BYTES + el.positions.byteLength;
  }

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, 1, true); // version
  offset += 4;
  view.setFloat32(offset, EDGE_THRESHOLD_DEG, true); // threshold
  offset += 4;
  view.setUint32(offset, elements.length, true); // numElements
  offset += 4;

  // Elements
  for (const el of elements) {
    view.setUint32(offset, el.expressID, true);
    offset += 4;
    view.setUint32(offset, el.positions.length, true);
    offset += 4;
    const bytes = new Uint8Array(
      el.positions.buffer,
      el.positions.byteOffset,
      el.positions.byteLength,
    );
    new Uint8Array(buffer, offset, bytes.length).set(bytes);
    offset += bytes.length;
  }

  return new Uint8Array(buffer);
}

/**
 * Deserialise the binary edge artifact into a per-element map.
 *
 * Exported so the viewer package can also import this parser if desired,
 * but more commonly the viewer will inline its own copy.
 */
export function deserialiseEdges(
  data: ArrayBuffer,
): { threshold: number; edges: Map<number, Float32Array> } {
  const view = new DataView(data);
  let offset = 0;

  const version = view.getUint32(offset, true);
  offset += 4;
  if (version !== 1) {
    throw new Error(`Unsupported edges format version: ${String(version)}`);
  }

  const threshold = view.getFloat32(offset, true);
  offset += 4;
  const numElements = view.getUint32(offset, true);
  offset += 4;

  const edges = new Map<number, Float32Array>();
  for (let i = 0; i < numElements; i++) {
    const expressID = view.getUint32(offset, true);
    offset += 4;
    const numFloats = view.getUint32(offset, true);
    offset += 4;
    const positions = new Float32Array(data, offset, numFloats);
    edges.set(expressID, positions);
    offset += numFloats * 4;
  }

  return { threshold, edges };
}
