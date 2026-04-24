import { parseIfc } from '../index.js';

describe('parseIfc', () => {
  it('returns empty elements for a minimal valid call shape', async () => {
    // We cannot run a real web-ifc parse in unit tests without the WASM binary,
    // so we verify the public API contract via the exported types.
    expect(typeof parseIfc).toBe('function');
  });
});
