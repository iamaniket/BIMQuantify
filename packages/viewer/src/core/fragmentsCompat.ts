/**
 * Typed shims over ThatOpen's loosely-typed surfaces.
 *
 * `FragmentsModels.models.list` and `SimpleScene.three` are typed too loosely
 * for our use, so call sites historically reached for `as unknown as …` casts —
 * the same two casts hand-written ~16 times across {@link ./Viewer.ts} and its
 * collaborators. Centralising them here keeps the unsafe boundary in one
 * auditable place: if ThatOpen tightens these types, this is the only file to
 * touch, and the cast can't silently drift between call sites.
 */

import type * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';
import type { SimpleScene } from '@thatopen/components';

/** The map of loaded models, keyed by model id. */
export function modelMap(
  fragments: FRAGS.FragmentsModels,
): Map<string, FRAGS.FragmentsModel> {
  return fragments.models.list as unknown as Map<string, FRAGS.FragmentsModel>;
}

/** Unwrap the three.js `Scene` from ThatOpen's `SimpleScene` wrapper. */
export function threeScene(scene: SimpleScene): THREE.Scene {
  return (scene as unknown as { three: THREE.Scene }).three;
}
