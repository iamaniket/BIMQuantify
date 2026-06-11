/**
 * IFC world ↔ viewer THREE world for the floor-plan minimap, calibrated per model.
 *
 * The processor emits the plan in two of the model's raw IFC axes (`planAxisX`,
 * `planAxisY`); the third (`upAxis = 3 − planAxisX − planAxisY`) is vertical. The
 * viewer renders ThatOpen fragments in a **Y-up** scene: `IfcImporter` rotates the
 * model's up-axis onto +Y (identity when the model is already Y-up) and recenters
 * it. So camera-world = R·(IFC) + T, where R is fixed by the up-axis and T is a
 * per-model translation.
 *
 * We recover T from bbox centers (`metadata.bbox` in IFC vs the model world AABB
 * from `camera.getSceneBox`), and R from the up-axis via `AXIS_MAPS` below — each
 * entry maps an IFC axis to the camera axis + sign it lands on (the up-axis always
 * lands on +Y; the two horizontals on ±x / ±z using the standard Z-up→Y-up
 * convention `(x,y,z)→(x,z,−y)`).
 *
 * SINGLE source of truth for the convention. If the "you are here" marker is
 * mirrored on an axis for some up-axis, flip that entry's sign here.
 *
 * Owned by the minimap plugin so the IFC↔viewer transform lives next to the
 * camera-sync + storey-isolation logic that consumes it. The portal's minimap
 * view only ever sees plan coords (via the `minimap:pose` event) and canvas math.
 */

export type PlanVec2 = { x: number; y: number };
export type ViewerVec3 = { x: number; y: number; z: number };
export type Bbox3 = { min: [number, number, number]; max: [number, number, number] };
export type WorldBox = { min: ViewerVec3; max: ViewerVec3 };

type AxisMap = { axis: 'x' | 'y' | 'z'; sign: number };

/** Per up-axis: how IFC axes [x,y,z] map onto camera axes (+ sign). */
const AXIS_MAPS: Record<number, [AxisMap, AxisMap, AxisMap]> = {
  // up = X: rotate X-up → Y-up. cam.y=ifc.x, cam.x=−ifc.y, cam.z=ifc.z.
  0: [{ axis: 'y', sign: 1 }, { axis: 'x', sign: -1 }, { axis: 'z', sign: 1 }],
  // up = Y: already Y-up. identity.
  1: [{ axis: 'x', sign: 1 }, { axis: 'y', sign: 1 }, { axis: 'z', sign: 1 }],
  // up = Z: rotate Z-up → Y-up. cam.x=ifc.x, cam.y=ifc.z, cam.z=−ifc.y.
  2: [{ axis: 'x', sign: 1 }, { axis: 'z', sign: -1 }, { axis: 'y', sign: 1 }],
};

export type Calibration = {
  ifcCenter: [number, number, number];
  worldCenter: ViewerVec3;
  map: [AxisMap, AxisMap, AxisMap];
  planAxisX: number;
  planAxisY: number;
  upAxis: number;
};

const center = (lo: number, hi: number): number => (lo + hi) / 2;

export function makeCalibration(
  ifcBbox: Bbox3,
  worldBox: WorldBox,
  planAxisX: number,
  planAxisY: number,
): Calibration {
  const upAxis = 3 - planAxisX - planAxisY;
  return {
    ifcCenter: [
      center(ifcBbox.min[0], ifcBbox.max[0]),
      center(ifcBbox.min[1], ifcBbox.max[1]),
      center(ifcBbox.min[2], ifcBbox.max[2]),
    ],
    worldCenter: {
      x: center(worldBox.min.x, worldBox.max.x),
      y: center(worldBox.min.y, worldBox.max.y),
      z: center(worldBox.min.z, worldBox.max.z),
    },
    map: AXIS_MAPS[upAxis] ?? AXIS_MAPS[2]!,
    planAxisX,
    planAxisY,
    upAxis,
  };
}

const cameraComp = (p: ViewerVec3, axis: 'x' | 'y' | 'z'): number =>
  axis === 'x' ? p.x : axis === 'y' ? p.y : p.z;
const centerComp = (c: ViewerVec3, axis: 'x' | 'y' | 'z'): number =>
  axis === 'x' ? c.x : axis === 'y' ? c.y : c.z;

/** Recover IFC axis `i` from a camera-world point. */
function ifcFromCamera(i: number, p: ViewerVec3, c: Calibration): number {
  const m = c.map[i] ?? c.map[2]!;
  return m.sign * (cameraComp(p, m.axis) - centerComp(c.worldCenter, m.axis)) + c.ifcCenter[i]!;
}

/** Project a viewer world-space point onto the IFC plan (planAxisX, planAxisY). */
export function viewerToPlan(p: ViewerVec3, c: Calibration): PlanVec2 {
  return { x: ifcFromCamera(c.planAxisX, p, c), y: ifcFromCamera(c.planAxisY, p, c) };
}

/** Lift an IFC plan (X,Y) point at the given elevation into viewer world space. */
export function planToViewer(
  planX: number,
  planY: number,
  elevation: number,
  c: Calibration,
): ViewerVec3 {
  const ifc: [number, number, number] = [0, 0, 0];
  ifc[c.planAxisX] = planX;
  ifc[c.planAxisY] = planY;
  ifc[c.upAxis] = elevation;
  const out: ViewerVec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 3; i += 1) {
    const m = c.map[i] ?? c.map[2]!;
    const val = m.sign * (ifc[i]! - c.ifcCenter[i]!) + centerComp(c.worldCenter, m.axis);
    if (m.axis === 'x') out.x = val;
    else if (m.axis === 'y') out.y = val;
    else out.z = val;
  }
  return out;
}
