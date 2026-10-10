import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { logoFormat, logoKey, logoSize, MAX_LOGO_CHARS, sanitizeLogo } from '../src/logos.js';
import { buildPdf } from '../static/app/src/exportPdf.js';
import { portalPdfContent } from '../src/pdfReport.js';
import { snapshotFrom } from '../src/publish.js';

// A 2×1 PNG (one red pixel, one blue).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC';

test('logos: PNG or JPEG data URLs within the size limit only', () => {
  assert.deepEqual(sanitizeLogo({ dataUrl: PNG, width: 2, height: 1, name: ' logo.png ' }), { dataUrl: PNG, width: 2, height: 1, name: 'logo.png' });
  assert.equal(sanitizeLogo({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', width: 1, height: 1 }), null);
  assert.equal(sanitizeLogo({ dataUrl: 'javascript:alert(1)', width: 1, height: 1 }), null);
  assert.equal(sanitizeLogo({ dataUrl: `data:image/png;base64,${'A'.repeat(MAX_LOGO_CHARS)}`, width: 1, height: 1 }), null);
  assert.equal(sanitizeLogo({ dataUrl: PNG, width: 0, height: 1 }), null);
  assert.equal(logoKey('company'), 'logo:company');
  assert.equal(logoKey('188'), 'logo:org:188');
  assert.throws(() => logoKey('../x'), /Invalid logo/);
  assert.equal(logoFormat({ dataUrl: 'data:image/jpeg;base64,AA==' }), 'JPEG');
  assert.deepEqual(logoSize({ width: 800, height: 200 }, 14, 40), { width: 40, height: 10 });
  assert.deepEqual(logoSize({ width: 100, height: 100 }, 14, 40), { width: 14, height: 14 });
});

test('the PDF draws both logos, and still works without them or with a broken one', () => {
  const snapshot = snapshotFrom({ organization: { id: '188', name: 'Ryanair Crew' }, period: { from: '2026-09-01', to: '2026-09-30' }, totals: { current: 10, previous: 5 }, patterns: [{ title: 'Pinpad', count: 4 }] });
  const c = portalPdfContent(snapshot);
  const logo = { dataUrl: PNG, width: 2, height: 1 };
  const plain = buildPdf(jsPDF, c).output();
  const withLogos = buildPdf(jsPDF, c, { logos: { company: logo, customer: logo } }).output();
  assert.ok(/\/Subtype \/Image/.test(withLogos));
  assert.ok(!/\/Subtype \/Image/.test(plain));
  assert.ok(buildPdf(jsPDF, c, { logos: { company: { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 } } }).output().length > 1000);
});
