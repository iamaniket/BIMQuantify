import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DOCUMENT_SETTINGS,
  loadDocumentSettings,
} from './documentSettings';
import {
  DEFAULT_VIEWER_SETTINGS,
  loadViewerSettings,
} from './viewerSettings';

// Regression guard: loaders must never hand out the shared module-level defaults
// by reference. A buggy consumer mutating the loaded object in place would
// otherwise corrupt DEFAULT_*_SETTINGS for the rest of the session, so
// "Reset defaults" would revert to the last value instead of the true default.
describe('settings loaders return non-aliased clones of the defaults', () => {
  beforeEach(() => {
    globalThis.window?.localStorage?.clear();
  });

  it('loadViewerSettings does not return the shared default reference', () => {
    const a = loadViewerSettings();
    expect(a).not.toBe(DEFAULT_VIEWER_SETTINGS);
    expect(a.zoom).not.toBe(DEFAULT_VIEWER_SETTINGS.zoom);
    expect(a.behavior).not.toBe(DEFAULT_VIEWER_SETTINGS.behavior);
  });

  it('mutating a loaded viewer result cannot corrupt the module defaults', () => {
    const loaded = loadViewerSettings();
    loaded.zoom.speed = 999;
    loaded.behavior.hoverHighlight.enabled = false;

    // The module defaults must stay pristine...
    expect(DEFAULT_VIEWER_SETTINGS.zoom.speed).toBe(1);
    expect(DEFAULT_VIEWER_SETTINGS.behavior.hoverHighlight.enabled).toBe(true);
    // ...so a later load (what "Reset defaults" effectively reads) is correct.
    const fresh = loadViewerSettings();
    expect(fresh.zoom.speed).toBe(1);
    expect(fresh.behavior.hoverHighlight.enabled).toBe(true);
  });

  it('loadDocumentSettings does not return the shared default reference', () => {
    const a = loadDocumentSettings();
    expect(a).not.toBe(DEFAULT_DOCUMENT_SETTINGS);
    expect(a.controls).not.toBe(DEFAULT_DOCUMENT_SETTINGS.controls);
  });

  it('mutating a loaded document result cannot corrupt the module defaults', () => {
    const loaded = loadDocumentSettings();
    loaded.pageBackground = '#000000';
    loaded.controls.wheel = 'none';

    expect(DEFAULT_DOCUMENT_SETTINGS.pageBackground).toBe('#f3f4f6');
    expect(DEFAULT_DOCUMENT_SETTINGS.controls.wheel).toBe('zoom');
    const fresh = loadDocumentSettings();
    expect(fresh.pageBackground).toBe('#f3f4f6');
    expect(fresh.controls.wheel).toBe('zoom');
  });
});
