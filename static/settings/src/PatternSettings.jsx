// How tickets group into recurring issues, and which breakdown values count as
// "not filled in". Customer and internal reports each have their own.
import React from 'react';
import { Card, Field } from '@retailinmotion/ui/react';
import { DEFAULT_PLACEHOLDERS, DEFAULT_SYNONYMS, MAX_PLACEHOLDERS, MIN_PATTERN, SYNONYM_LIMITS } from '../../../src/settings.js';

// Saved lists show as "first = the rest"; text being edited is kept as typed.
const synonymText = (value) => (Array.isArray(value) ? value.map((list) => `${list[0]} = ${list.slice(1).join(', ')}`).join('\n') : value);

export default function PatternSettings({ id, value, onChange, defaultSynonyms = DEFAULT_SYNONYMS }) {
  return <>
    <Card title="Patterns" description="How tickets are grouped into recurring issues.">
      <Field label="Minimum tickets per pattern" htmlFor={`${id}-min`}
        help={`Between ${MIN_PATTERN.min} and ${MIN_PATTERN.max}. Higher numbers show fewer, more established issues. For large analyses this counts tickets in the analysed sample.`}>
        <input id={`${id}-min`} className="nq-input cs-number" type="number" min={MIN_PATTERN.min} max={MIN_PATTERN.max} step={1}
          value={value.minPatternSize ?? MIN_PATTERN.default} onChange={(e) => onChange({ minPatternSize: Number(e.target.value) })} />
      </Field>
      <Field label="Words that mean the same" htmlFor={`${id}-synonyms`}
        help={`One list per line, for example “laptop = notebook, pc”. Tickets using any of them group together under the first word. Up to ${SYNONYM_LIMITS.groups} lines; capital letters, hyphens and plurals don’t matter.`}>
        <textarea id={`${id}-synonyms`} className="nq-textarea" rows={5}
          value={synonymText(value.synonyms ?? defaultSynonyms)} onChange={(e) => onChange({ synonyms: e.target.value })} />
      </Field>
    </Card>
    <Card title="Data quality" description="Breakdown values that mean nobody filled the field in. Reports count them, with tickets that have no value, so you can track the clean-up.">
      <Field label="Placeholder values" htmlFor={`${id}-placeholders`}
        help={`One per line or separated by commas, up to ${MAX_PLACEHOLDERS}. Matching ignores capital letters and extra spaces.`}>
        <textarea id={`${id}-placeholders`} className="nq-textarea" rows={4}
          value={Array.isArray(value.placeholders) ? value.placeholders.join('\n') : (value.placeholders ?? DEFAULT_PLACEHOLDERS.join('\n'))}
          onChange={(e) => onChange({ placeholders: e.target.value })} />
      </Field>
    </Card>
  </>;
}
