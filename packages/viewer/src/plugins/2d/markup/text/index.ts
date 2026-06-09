/**
 * Text markup tool — performance-minded: the string is rasterized to a 2D
 * canvas and shown as a `THREE.CanvasTexture` on a `PlaneGeometry`, NOT as
 * tessellated glyph geometry and NOT as a DOM label. Because it lives in the
 * WebGL scene it composites into the snapshot for free. A transient `<input>`
 * is used only while typing.
 *
 * The markup overlay camera is Y-down (top=0, bottom=H), so the texture is
 * uploaded with `flipY = false` to render upright.
 */

import * as THREE from 'three';

import type { DocumentContext, DocumentPlugin } from '../../../../pdf-core/documentTypes.js';
import type { Pt } from '../../measure/math.js';
import type { MarkupBuildOpts, MarkupCoreAPI, MarkupInteraction, MarkupToolContext } from '../core/api.js';
import type { MarkupStyle } from '../types.js';
import { MARKUP_CORE_NAME } from '../core/index.js';
import { TEXT_SIZE_FRAC } from '../core/draw.js';

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

function build(css: Pt[], style: MarkupStyle, opts: MarkupBuildOpts): THREE.Object3D[] {
  const text = opts.text ?? '';
  if (css.length < 1 || text === '') return [];
  const anchor = css[0]!;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const fontPx = Math.max(8, opts.pageCss.h * TEXT_SIZE_FRAC);
  const padPx = Math.round(fontPx * 0.25);

  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d');
  if (c2d === null) return [];
  const fontStr = `600 ${Math.round(fontPx * dpr)}px ${FONT_STACK}`;
  c2d.font = fontStr;
  const textW = Math.ceil(c2d.measureText(text).width);
  const bufW = Math.max(1, textW + padPx * 2 * dpr);
  const bufH = Math.max(1, Math.ceil(fontPx * 1.3 * dpr));
  canvas.width = bufW;
  canvas.height = bufH;
  // Resizing the canvas resets the 2D context — re-apply font + styles.
  c2d.font = fontStr;
  c2d.textBaseline = 'middle';
  c2d.fillStyle = style.color;
  c2d.fillText(text, padPx * dpr, bufH / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });

  const planeW = bufW / dpr;
  const planeH = bufH / dpr;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  // Anchor is the top-left; the plane is centre-origin, so offset by half.
  mesh.position.set(anchor[0] + planeW / 2, anchor[1] + planeH / 2, 0);
  return [mesh];
}

function createInteraction(c: MarkupToolContext): MarkupInteraction {
  let input: HTMLInputElement | null = null;
  let anchor: Pt | null = null;
  let done = false;

  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    const el = input;
    input = null;
    const value = el?.value.trim() ?? '';
    el?.remove();
    if (commit && value !== '' && anchor) c.submit([anchor], value);
    else c.cancel();
    anchor = null;
  };

  return {
    onPointerDown(e: PointerEvent): void {
      if (e.button !== 0 || input !== null) return;
      e.preventDefault();
      e.stopPropagation();
      done = false;
      anchor = c.cursorToArtifact(e);
      const css = c.artifactToCss(anchor);
      const el = document.createElement('input');
      el.type = 'text';
      el.style.cssText = [
        'position:absolute',
        `left:${css[0]}px`,
        `top:${css[1]}px`,
        'z-index:10',
        'min-width:80px',
        'padding:1px 4px',
        `font:600 13px ${FONT_STACK}`,
        'border:1px solid #2563eb',
        'border-radius:3px',
        'background:#fff',
        'color:#111',
        'pointer-events:auto',
        'outline:none',
      ].join(';');
      el.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') finish(true);
        else if (ev.key === 'Escape') finish(false);
      });
      el.addEventListener('blur', () => { finish(true); });
      input = el;
      c.labelHost.appendChild(el);
      setTimeout(() => { el.focus(); }, 0);
    },
    dispose(): void {
      finish(false);
    },
  };
}

export function markupTextPlugin(): DocumentPlugin {
  return {
    name: 'markup-text',
    dependencies: [MARKUP_CORE_NAME],
    install(ctx: DocumentContext): void {
      const core = ctx.plugins.get<MarkupCoreAPI>(MARKUP_CORE_NAME);
      if (!core) throw new Error('markup-text requires markup-core');
      core.registerTool({ tool: 'text', build, createInteraction });
    },
  };
}
