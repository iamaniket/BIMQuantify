import { describe, expect, it } from 'vitest';

import { createHistory, pushHistory, redo, undo } from './history.js';
import type { Annotation2D } from './types.js';

function ann(id: string): Annotation2D {
  return { id, tool: 'rect', points: [[0, 0], [1, 1]], color: '#ef4444', strokeWidth: 6 };
}

const A = [ann('a')];
const B = [ann('a'), ann('b')];
const C = [ann('a'), ann('b'), ann('c')];

describe('history', () => {
  it('starts empty', () => {
    const h = createHistory(A);
    expect(h.present).toBe(A);
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(0);
  });

  it('push moves the old present onto the undo stack and clears redo', () => {
    const h = pushHistory(createHistory(A), B);
    expect(h.present).toBe(B);
    expect(h.past).toEqual([A]);
    expect(h.future).toHaveLength(0);
  });

  it('push is a no-op when the present is unchanged (referential equality)', () => {
    const h0 = createHistory(A);
    const h1 = pushHistory(h0, A);
    expect(h1).toBe(h0);
  });

  it('undo then redo restores the present', () => {
    const h = pushHistory(createHistory(A), B);
    const undone = undo(h);
    expect(undone.present).toBe(A);
    expect(undone.future).toEqual([B]);
    const redone = redo(undone);
    expect(redone.present).toBe(B);
    expect(redone.future).toHaveLength(0);
  });

  it('undo/redo at the ends are no-ops', () => {
    const h = createHistory(A);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('a new edit after undo truncates the redo branch', () => {
    let h = pushHistory(createHistory(A), B); // A -> B
    h = pushHistory(h, C); // B -> C
    h = undo(h); // back to B, future [C]
    expect(h.present).toBe(B);
    expect(h.future).toEqual([C]);
    h = pushHistory(h, A); // new branch
    expect(h.present).toBe(A);
    expect(h.future).toHaveLength(0);
    expect(h.past).toEqual([A, B]);
  });
});
