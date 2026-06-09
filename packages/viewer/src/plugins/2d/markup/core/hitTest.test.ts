import { describe, expect, it } from 'vitest';

import { hitTestCommitted, type HitShape } from './hitTest.js';

const PAGE_H = 800;

describe('markup hitTest', () => {
  it('selects a rectangle when clicking inside it', () => {
    const shapes: HitShape[] = [{ topicId: 't1', tool: 'rect', css: [[100, 100], [200, 200]] }];
    expect(hitTestCommitted(150, 150, shapes, PAGE_H)).toBe('t1');
    expect(hitTestCommitted(105, 195, shapes, PAGE_H)).toBe('t1');
  });

  it('misses a rectangle when clicking well outside it', () => {
    const shapes: HitShape[] = [{ topicId: 't1', tool: 'rect', css: [[100, 100], [200, 200]] }];
    expect(hitTestCommitted(300, 300, shapes, PAGE_H)).toBeNull();
  });

  it('selects an arrow only near its line', () => {
    const shapes: HitShape[] = [{ topicId: 'a', tool: 'arrow', css: [[0, 0], [100, 0]] }];
    expect(hitTestCommitted(50, 2, shapes, PAGE_H)).toBe('a'); // within threshold
    expect(hitTestCommitted(50, 40, shapes, PAGE_H)).toBeNull(); // far from line
  });

  it('selects a freehand stroke near any segment', () => {
    const shapes: HitShape[] = [{ topicId: 'f', tool: 'freehand', css: [[0, 0], [10, 10], [20, 0]] }];
    expect(hitTestCommitted(10, 11, shapes, PAGE_H)).toBe('f');
    expect(hitTestCommitted(100, 100, shapes, PAGE_H)).toBeNull();
  });

  it('selects text inside its estimated label box', () => {
    const shapes: HitShape[] = [{ topicId: 'x', tool: 'text', css: [[50, 50]], text: 'Hello' }];
    expect(hitTestCommitted(60, 58, shapes, PAGE_H)).toBe('x');
    expect(hitTestCommitted(500, 500, shapes, PAGE_H)).toBeNull();
  });

  it('returns the topmost (last) shape on overlap', () => {
    const shapes: HitShape[] = [
      { topicId: 'under', tool: 'rect', css: [[0, 0], [100, 100]] },
      { topicId: 'over', tool: 'rect', css: [[10, 10], [90, 90]] },
    ];
    expect(hitTestCommitted(50, 50, shapes, PAGE_H)).toBe('over');
  });
});
