import test from 'node:test';
import assert from 'node:assert/strict';

test('resolver module loads and exports a handler', async () => {
  const { handler } = await import('../src/index.js');
  assert.equal(typeof handler, 'function');
});

test('portal resolver module loads and exports a handler', async () => {
  const { handler } = await import('../src/portal.js');
  assert.equal(typeof handler, 'function');
});

test('agent resolvers refuse portal customers before doing anything', async () => {
  const { handler } = await import('../src/index.js');
  for (const accountType of ['customer', 'unlicensed', 'anonymous']) {
    await assert.rejects(
      handler({ call: { functionKey: 'analyze', payload: {} }, context: { accountType } }),
      /only available to agents/,
    );
  }
});
