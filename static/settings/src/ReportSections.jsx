// Settings → Report sections: show or hide each section of customer or
// internal reports (src/sections.js). Headline numbers and patterns always show.
import React from 'react';
import { Card } from '@retailinmotion/ui/react';
import { DEFAULT_HIDDEN_SECTIONS, sectionsFor } from '../../../src/sections.js';

export default function ReportSections({ scope, value, onChange }) {
  const hidden = { ...DEFAULT_HIDDEN_SECTIONS, ...value };
  const list = hidden[scope] || [];
  const toggle = (key, shown) => onChange({ ...hidden, [scope]: shown ? list.filter((k) => k !== key) : [...list, key] });
  const sections = sectionsFor(scope);
  return <Card title="Report sections" description={`Choose which sections ${scope === 'internal' ? 'internal' : 'customer'} reports show, on the page and in PDFs (downloaded and emailed). Hidden sections aren't worked out at all. The headline numbers and issue patterns are always shown.`}>
    <div className="cs-sections">{sections.map((s) => <label className="cs-check" key={s.key}>
      <input type="checkbox" className="nq-check" checked={!list.includes(s.key)} onChange={(e) => toggle(s.key, e.target.checked)} />
      <span>{s.label}</span>
    </label>)}</div>
    <p className="nq-muted">{list.length ? `${list.length} of ${sections.length} hidden.` : 'All sections shown.'}{scope === 'internal' ? ' Escalation levels also need switching on in a project’s settings.' : ''}</p>
  </Card>;
}
