import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Clipper, Worlds } from '@thatopen/components';

import { CommandRegistry } from '../../../core/CommandRegistry';
import { EventBus } from '../../../core/EventBus';
import type { ViewerContext, ViewerEvents } from '../../../core/types';
import { sectionPlugin, type SectionPlane } from './index';

/**
 * The section plugin wraps OBC's `Clipper`/`SimplePlane`, but the integration —
 * not OBC — is what these tests pin: native click-to-place through the viewer's
 * `pick()` + edit `mode`, clipping pushed onto our *own* fragment materials, the
 * rotate gizmo mode, and selection-driven gizmo visibility. We fake the OBC
 * surface (no WebGL) and the one model `pick()` raycasts.
 */

class FakeEvent<T = unknown> {
  private readonly cbs = new Set<(arg: T) => void>();
  add(cb: (arg: T) => void): void { this.cbs.add(cb); }
  remove(cb: (arg: T) => void): void { this.cbs.delete(cb); }
  trigger(arg: T): void { for (const cb of this.cbs) cb(arg); }
}

class FakeControls {
  mode: 'translate' | 'rotate' = 'translate';
  showX = false;
  showY = false;
  showZ = true;
  setMode(m: 'translate' | 'rotate'): void { this.mode = m; }
  addEventListener(): void { /* no drag simulation needed */ }
  removeEventListener(): void { /* noop */ }
}

class FakeSimplePlane {
  readonly normal: THREE.Vector3;
  readonly origin: THREE.Vector3;
  readonly three: THREE.Plane;
  enabled = true;
  visible = false;
  size = 1;
  readonly planeMaterial = new THREE.MeshBasicMaterial();
  readonly helper = new THREE.Object3D();
  readonly controls = new FakeControls();

  constructor(normal: THREE.Vector3, origin: THREE.Vector3) {
    this.normal = normal.clone().normalize();
    this.origin = origin.clone();
    this.three = new THREE.Plane().setFromNormalAndCoplanarPoint(this.normal, this.origin);
    this.helper.position.copy(this.origin);
  }

  setFromNormalAndCoplanarPoint(normal: THREE.Vector3, point: THREE.Vector3): void {
    this.normal.copy(normal);
    this.origin.copy(point);
    this.three.setFromNormalAndCoplanarPoint(normal, point);
    this.helper.position.copy(point);
  }
}

class FakeClipper {
  enabled = true;
  visible = true;
  localClippingPlanes = false;
  readonly list = new Map<string, FakeSimplePlane>();
  readonly onAfterDrag = new FakeEvent();
  private n = 0;

  createFromNormalAndCoplanarPoint(_w: unknown, normal: THREE.Vector3, point: THREE.Vector3): string {
    const id = `c${String(++this.n)}`;
    this.list.set(id, new FakeSimplePlane(normal, point));
    return id;
  }

  delete(_w: unknown, id: string): Promise<void> {
    this.list.delete(id);
    return Promise.resolve();
  }

  deleteAll(): void { this.list.clear(); }
}

interface RaycastHit {
  localId: number;
  point: THREE.Vector3;
  normal?: THREE.Vector3;
}

function fakeModel(box: THREE.Box3, hit: RaycastHit | null): {
  object: THREE.Object3D;
  box: THREE.Box3;
  material: THREE.MeshBasicMaterial;
  raycast: () => Promise<RaycastHit | null>;
} {
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const object = new THREE.Group();
  object.add(mesh);
  return {
    object,
    box,
    material,
    raycast: () => Promise.resolve(hit ? { ...hit, distance: 1 } as RaycastHit : null),
  };
}

function makeCtx(model?: ReturnType<typeof fakeModel>): {
  ctx: ViewerContext;
  commands: CommandRegistry;
  events: EventBus<ViewerEvents>;
  clipper: FakeClipper;
  renderer: { localClippingEnabled: boolean };
  modeCalls: Array<Record<string, unknown>>;
  material: THREE.MeshBasicMaterial | null;
} {
  const commands = new CommandRegistry();
  const events = new EventBus<ViewerEvents>();
  const clipper = new FakeClipper();
  const worlds = { list: new Map([['w', {}]]) };
  const renderer = { localClippingEnabled: false };
  const modeCalls: Array<Record<string, unknown>> = [];
  let modeOnExit: (() => void) | null = null;

  commands.register('mode.enter', (args: unknown) => {
    const d = args as Record<string, unknown>;
    modeCalls.push(d);
    modeOnExit = (d.onExit as (() => void) | undefined) ?? null;
  });
  commands.register('mode.exit', () => {
    const f = modeOnExit;
    modeOnExit = null;
    f?.();
  });

  const models = new Map<string, ReturnType<typeof fakeModel>>();
  if (model) models.set('file-1', model);

  const components = {
    get: (token: unknown) =>
      token === Clipper ? clipper : token === Worlds ? worlds : undefined,
  };

  const ctx = {
    camera: {},
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    renderer,
    components,
    fragments: {},
    models: () => models,
    requestRender: () => undefined,
    commands,
    events,
  } as unknown as ViewerContext;

  return { ctx, commands, events, clipper, renderer, modeCalls, material: model?.material ?? null };
}

const box1 = (): THREE.Box3 =>
  new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));

describe('section plugin', () => {
  it('registers the section commands', () => {
    const { ctx, commands } = makeCtx();
    sectionPlugin().install(ctx);
    for (const name of [
      'section.add', 'section.remove', 'section.removeAll', 'section.toggle',
      'section.flip', 'section.list', 'section.activate', 'section.deactivate',
      'section.select', 'section.move', 'section.rotate', 'section.getExtent',
      'section.setGizmoMode', 'section.getGizmoMode',
    ]) {
      expect(commands.has(name)).toBe(true);
    }
  });

  it('add → list serializes the plane and applies clipping to fragment materials', async () => {
    const model = fakeModel(box1(), null);
    const { ctx, commands, renderer } = makeCtx(model);
    sectionPlugin().install(ctx);

    await commands.execute('section.add', { normal: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 0, z: 0 } });

    const planes = await commands.execute<SectionPlane[]>('section.list');
    expect(planes).toHaveLength(1);
    expect(planes![0]!.normal).toMatchObject({ x: 0, y: 1, z: 0 });
    expect(planes![0]!.active).toBe(true);

    expect(model.material.clippingPlanes).not.toBeNull();
    expect(model.material.clippingPlanes).toHaveLength(1);
    expect(renderer.localClippingEnabled).toBe(true);
  });

  it('removeAll clears planes, material clipping, and localClippingEnabled', async () => {
    const model = fakeModel(box1(), null);
    const { ctx, commands, renderer } = makeCtx(model);
    sectionPlugin().install(ctx);

    await commands.execute('section.add', { normal: { x: 0, y: 1, z: 0 } });
    await commands.execute('section.removeAll');

    expect(await commands.execute('section.list')).toHaveLength(0);
    expect(model.material.clippingPlanes).toBeNull();
    expect(renderer.localClippingEnabled).toBe(false);
  });

  it('toggle disables a plane and drops it from material clipping', async () => {
    const model = fakeModel(box1(), null);
    const { ctx, commands, renderer } = makeCtx(model);
    sectionPlugin().install(ctx);

    const id = await commands.execute<string>('section.add', { normal: { x: 0, y: 1, z: 0 } });
    await commands.execute('section.toggle', { id });

    const planes = await commands.execute<SectionPlane[]>('section.list');
    expect(planes![0]!.active).toBe(false);
    expect(model.material.clippingPlanes).toBeNull();
    expect(renderer.localClippingEnabled).toBe(false);
  });

  it('flip negates the plane normal', async () => {
    const { ctx, commands } = makeCtx(fakeModel(box1(), null));
    sectionPlugin().install(ctx);

    const id = await commands.execute<string>('section.add', { normal: { x: 0, y: 1, z: 0 } });
    await commands.execute('section.flip', { id });

    const planes = await commands.execute<SectionPlane[]>('section.list');
    expect(planes![0]!.normal.y).toBeCloseTo(-1);
  });

  it('setGizmoMode switches the selected plane gizmo between translate and rotate', async () => {
    const { ctx, commands, clipper } = makeCtx(fakeModel(box1(), null));
    sectionPlugin().install(ctx);

    await commands.execute('section.add', { normal: { x: 0, y: 1, z: 0 } }); // auto-selected
    const plane = [...clipper.list.values()][0]!;

    expect(await commands.execute('section.getGizmoMode')).toBe('translate');
    expect(plane.controls.mode).toBe('translate');
    expect(plane.controls.showX).toBe(false);
    expect(plane.controls.showZ).toBe(true);

    await commands.execute('section.setGizmoMode', { mode: 'rotate' });
    expect(plane.controls.mode).toBe('rotate');
    expect(plane.controls.showX).toBe(true);
    expect(plane.controls.showY).toBe(true);
    expect(plane.controls.showZ).toBe(true);
  });

  it('selection shows only the selected plane gizmo', async () => {
    const { ctx, commands, clipper } = makeCtx(fakeModel(box1(), null));
    sectionPlugin().install(ctx);

    const id1 = await commands.execute<string>('section.add', { normal: { x: 1, y: 0, z: 0 } });
    const id2 = await commands.execute<string>('section.add', { normal: { x: 0, y: 1, z: 0 } });
    const [p1, p2] = [...clipper.list.values()];

    // Second add is auto-selected.
    expect(p1!.visible).toBe(false);
    expect(p2!.visible).toBe(true);

    await commands.execute('section.select', { id: id1 });
    expect(p1!.visible).toBe(true);
    expect(p2!.visible).toBe(false);

    await commands.execute('section.select', null);
    expect(p1!.visible).toBe(false);
    expect(p2!.visible).toBe(false);
    void id2;
  });

  it('activate enters edit mode and a click places a plane coplanar to the face', async () => {
    const hitNormal = new THREE.Vector3(0, 0, 1);
    const model = fakeModel(box1(), { localId: 7, point: new THREE.Vector3(1, 2, 3), normal: hitNormal });
    const { ctx, commands, events, modeCalls } = makeCtx(model);
    sectionPlugin().install(ctx);

    await commands.execute('section.activate');
    expect(await commands.execute('section.isActive')).toBe(true);
    expect(modeCalls[0]).toMatchObject({ name: 'section.place', preserveCamera: true });

    events.emit('pointer:click', {
      ndc: { x: 0, y: 0 }, button: 0, shift: false, ctrl: false, meta: false, clientX: 50, clientY: 50,
    });
    await new Promise((r) => setTimeout(r, 0));

    const planes = await commands.execute<SectionPlane[]>('section.list');
    expect(planes).toHaveLength(1);
    // Outward face normal (0,0,1) is negated so the cut keeps the interior.
    expect(planes![0]!.normal.z).toBeCloseTo(-1);
    expect(planes![0]!.point).toMatchObject({ x: 1, y: 2, z: 3 });
    // Single-shot: mode.exit fired, placement ended.
    expect(await commands.execute('section.isActive')).toBe(false);
  });

  it('getExtent projects the model box onto the plane normal', async () => {
    const { ctx, commands } = makeCtx(fakeModel(box1(), null));
    sectionPlugin().install(ctx);

    const id = await commands.execute<string>('section.add', { normal: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 0, z: 0 } });
    const ext = await commands.execute<{ min: number; max: number; current: number }>('section.getExtent', { id });
    expect(ext!.min).toBeCloseTo(-1);
    expect(ext!.max).toBeCloseTo(1);
    expect(ext!.current).toBeCloseTo(0);
  });
});
