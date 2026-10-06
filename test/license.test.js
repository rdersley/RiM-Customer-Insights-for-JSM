import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { licenseAllows } from '../src/license.js';

test('the internal edition allows every installation in every environment', () => {
  for (const environmentType of ['PRODUCTION', 'DEVELOPMENT', 'STAGING', undefined]) {
    for (const license of [undefined, { active: false }, { active: true }]) {
      assert.equal(licenseAllows({ environmentType, license }, {}), true);
    }
  }
  assert.equal(licenseAllows({}, { LICENSE_OVERRIDE: 'inactive' }), true);
});

test('the internal edition does not enable Marketplace licensing', () => {
  const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(manifest, /licensing:\s*\n\s+enabled:\s*true/);
});
