import test from 'node:test';
import assert from 'node:assert/strict';
import { isProductionContext, licenseAllows } from '../src/license.js';

const prod = (license) => ({ environmentType: 'PRODUCTION', license });
const dev = (license) => ({ environmentType: 'DEVELOPMENT', license });

test('production fails closed without an active licence', () => {
  assert.equal(licenseAllows(prod({ active: true }), {}), true);
  assert.equal(licenseAllows(prod({ active: false }), {}), false);
  assert.equal(licenseAllows(prod(undefined), {}), false);
});

test('an unknown environment is treated as production', () => {
  assert.equal(isProductionContext({}), true);
  assert.equal(licenseAllows({}, {}), false);
  assert.equal(licenseAllows({ environment: { type: 'staging' } }, {}), true);
});

test('production ignores LICENSE_OVERRIDE', () => {
  assert.equal(licenseAllows(prod(undefined), { LICENSE_OVERRIDE: 'active' }), false);
});

test('production evaluation sites are allowed with no licence or an inactive one; others are not', () => {
  const env = { EVALUATION_CLOUD_IDS: ' ABC-123 , def-456' };
  assert.equal(licenseAllows({ ...prod(undefined), cloudId: 'abc-123' }, env), true);
  assert.equal(licenseAllows({ ...prod(undefined), cloudId: 'zzz-999' }, env), false);
  assert.equal(licenseAllows(prod(undefined), env), false);
  // A sharing-link install once licensing is on.
  assert.equal(licenseAllows({ ...prod({ active: false }), cloudId: 'abc-123' }, env), true);
  assert.equal(licenseAllows({ ...prod({ active: false }), cloudId: 'zzz-999' }, env), false);
  assert.equal(licenseAllows({ ...prod({ active: true }), cloudId: 'zzz-999' }, env), true);
  // As stored after an unquoted PowerShell argument.
  assert.equal(licenseAllows({ ...prod(undefined), cloudId: 'def-456' }, { EVALUATION_CLOUD_IDS: 'abc-123 def-456' }), true);
});

test('non-production allows a missing licence but honours simulated ones', () => {
  assert.equal(licenseAllows(dev(undefined), {}), true);
  assert.equal(licenseAllows(dev({ active: false }), {}), false);
  assert.equal(licenseAllows(dev(undefined), { LICENSE_OVERRIDE: 'inactive' }), false);
  assert.equal(licenseAllows(dev({ active: false }), { LICENSE_OVERRIDE: 'active' }), true);
});
