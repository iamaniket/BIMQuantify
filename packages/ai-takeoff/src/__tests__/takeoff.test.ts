import { runTakeoff } from '../index.js';
import type { IfcElement } from '@bim-quantify/ifc-parser';

describe('runTakeoff', () => {
  it('is a function', () => {
    expect(typeof runTakeoff).toBe('function');
  });

  it('returns an empty result when given empty elements array (mock OpenAI)', async () => {
    // Mock the OpenAI module to avoid real API calls
    jest.mock('openai', () => {
      return class {
        chat = {
          completions: {
            create: async () => ({
              choices: [{ message: { content: '[]' } }],
            }),
          },
        };
      };
    });

    const elements: IfcElement[] = [];
    const result = await runTakeoff({ elements }, 'test-api-key');

    expect(result.items).toHaveLength(0);
    expect(result.count).toBe(0);
    expect(typeof result.durationMs).toBe('number');
  });
});
