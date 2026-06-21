/**
 * Pure formatting helpers for the measurement plugin — value-to-string
 * formatters and CSS label construction. No shared mutable state: every
 * input (precision, label scale, overlay) is passed in explicitly. Imports
 * only `three`, the layer constant, and the CSS2D overlay types — never
 * `index.ts` — so there is no circular dependency.
 */

import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import { CSS2DObject } from '../shared/css2d-overlay.js';
import type { Css2dOverlay } from '../shared/css2d-overlay.js';

export function hexToCssRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${String(r)},${String(g)},${String(b)},${String(alpha)})`;
}

export function createCssLabel(
  ov: Css2dOverlay,
  text: string,
  labelScale: number,
  parent: THREE.Object3D,
  position: THREE.Vector3,
  bgColor?: number,
): CSS2DObject {
  const obj = ov.createLabel(text, position, parent);
  const fontSize = Math.round(12 * labelScale);
  obj.element.style.fontSize = `${String(fontSize)}px`;
  obj.element.style.fontWeight = 'bold';
  if (bgColor !== undefined) {
    obj.element.style.background = hexToCssRgba(bgColor, 0.82);
  }
  obj.layers.set(LAYER_OVERLAY);
  return obj;
}

export function formatDistance(d: number, precision: number): string {
  const p = precision;
  if (d < 0.01) return `${(d * 1000).toFixed(Math.max(p - 2, 1))} mm`;
  if (d < 1) return `${(d * 1000).toFixed(Math.max(p - 3, 0))} mm`;
  if (d < 100) return `${d.toFixed(p)} m`;
  return `${d.toFixed(Math.max(p - 2, 1))} m`;
}

export function formatAngle(radians: number, precision: number): string {
  const deg = radians * (180 / Math.PI);
  return `${deg.toFixed(Math.max(precision - 2, 1))}°`;
}

export function formatArea(area: number, precision: number): string {
  const p = precision;
  if (area < 0.0001) return `${(area * 1e6).toFixed(Math.max(p - 2, 1))} mm²`;
  if (area < 0.01) return `${(area * 1e4).toFixed(Math.max(p - 2, 1))} cm²`;
  return `${area.toFixed(p)} m²`;
}

export function formatVolume(vol: number, precision: number): string {
  const p = precision;
  if (vol < 0.000001) return `${(vol * 1e9).toFixed(Math.max(p - 2, 1))} mm³`;
  if (vol < 0.001) return `${(vol * 1e6).toFixed(Math.max(p - 2, 1))} cm³`;
  return `${vol.toFixed(p)} m³`;
}
