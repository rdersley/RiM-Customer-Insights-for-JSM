// Settings → PDF logos. Saved straight away (not with the Save button). Images
// are shrunk here before upload, so only a small PNG or JPEG is stored.
import React, { useEffect, useState } from 'react';
import { Button, Card, Field, Loading, Notice } from '@retailinmotion/ui/react';
import { MAX_LOGO_CHARS, MAX_ORG_LOGOS } from '../../../src/logos.js';

const MAX_W = 800;
const MAX_H = 300;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file isn’t an image this browser can read. Use PNG, JPEG or SVG.'));
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** The image scaled to fit 800×300 (or smaller until it fits the size limit), as PNG or JPEG. */
export async function shrinkLogo(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('That image is over 10 MB.');
  const img = await readImage(file);
  const natural = { w: img.naturalWidth || img.width || MAX_W, h: img.naturalHeight || img.height || MAX_H };
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    const ratio = Math.min(1, MAX_W / natural.w, MAX_H / natural.h) * scale;
    const width = Math.max(1, Math.round(natural.w * ratio));
    const height = Math.max(1, Math.round(natural.h * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    let dataUrl = canvas.toDataURL('image/png'); // keeps transparency
    if (dataUrl.length > MAX_LOGO_CHARS) {
      // Photos: JPEG on white, since JPEG has no transparency.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }
    if (dataUrl.length <= MAX_LOGO_CHARS) return { dataUrl, width, height, name: file.name };
  }
  throw new Error('That image is too detailed to use as a logo. Try a simpler or smaller one.');
}

function Preview({ logo }) {
  return logo ? <img className="cs-logo" src={logo.dataUrl} alt="" /> : <span className="nq-muted">No logo</span>;
}

function Upload({ label, onFile, disabled }) {
  return <label className={`nq-btn nq-btn--small cs-file${disabled ? ' is-disabled' : ''}`}>{label}
    <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" disabled={disabled} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
  </label>;
}

export default function PdfLogos({ invoke, organizations = [] }) {
  const [logos, setLogos] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [orgId, setOrgId] = useState('');

  useEffect(() => { invoke('getLogos').then(setLogos).catch((e) => setError(e.message || 'Logos could not be loaded.')); }, [invoke]);

  async function save(target, file) {
    if (target !== 'company' && !target) return;
    setError(''); setBusy(target);
    try {
      const logo = file ? await shrinkLogo(file) : null;
      const result = await invoke('saveLogo', { target, logo });
      setLogos((l) => (target === 'company'
        ? { ...l, company: result.logo }
        : { ...l, orgs: Object.fromEntries(Object.entries({ ...l.orgs, [target]: result.logo }).filter(([, v]) => v)) }));
      if (target !== 'company') { setOrgId(''); setOrgFilter(''); }
    } catch (e) { setError(e.message || 'The logo couldn’t be saved.'); } finally { setBusy(''); }
  }

  const name = (id) => organizations.find((o) => o.id === id)?.name || `Organisation ${id}`;
  const withLogo = Object.keys(logos?.orgs || {});
  const term = orgFilter.trim().toLowerCase();
  const choices = organizations.filter((o) => !withLogo.includes(o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 50);
  const chosen = orgId || choices[0]?.id || '';

  return <Card title="PDF logos" description="Shown at the top of PDF reports: your logo on the left and the customer’s on the right. Customers see them on the PDF they download from the portal too. Logos save straight away.">
    {error && <Notice kind="error">{error}</Notice>}
    {!logos && !error && <Loading inline text="Loading logos…" />}
    {logos && <div className="nq-stack">
      <div className="cs-logo-row">
        <div><strong>Your logo</strong><p className="nq-muted">On every PDF.</p></div>
        <Preview logo={logos.company} />
        <div className="nq-inline">
          <Upload label={logos.company ? 'Replace' : 'Upload'} disabled={Boolean(busy)} onFile={(f) => f && save('company', f)} />
          {logos.company && <Button small appearance="subtle" disabled={Boolean(busy)} onClick={() => save('company', null)}>Remove</Button>}
        </div>
      </div>
      {withLogo.map((id) => <div className="cs-logo-row" key={id}>
        <div><strong>{name(id)}</strong><p className="nq-muted">On this organisation’s reports.</p></div>
        <Preview logo={logos.orgs[id]} />
        <div className="nq-inline">
          <Upload label="Replace" disabled={Boolean(busy)} onFile={(f) => f && save(id, f)} />
          <Button small appearance="subtle" disabled={Boolean(busy)} onClick={() => save(id, null)}>Remove</Button>
        </div>
      </div>)}
      {withLogo.length < MAX_ORG_LOGOS && <div className="cs-row cs-row--pair">
        <Field label="Add a customer logo" htmlFor="cs-logo-org">
          <input id="cs-logo-org" className="nq-input" placeholder="Search organisations" value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); setOrgId(''); }} />
          <select className="nq-select cs-logo-select" aria-label="Organisation" value={chosen} onChange={(e) => setOrgId(e.target.value)}>
            {choices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <div className="cs-logo-add"><Upload label="Choose image" disabled={Boolean(busy) || !chosen} onFile={(f) => f && save(chosen, f)} /></div>
      </div>}
      {busy && <Loading inline text="Saving logo…" />}
      <p className="nq-muted">PNG, JPEG or SVG. Images are shrunk to at most 800 × 300 pixels before they’re saved. A transparent or white background looks best.</p>
    </div>}
  </Card>;
}
