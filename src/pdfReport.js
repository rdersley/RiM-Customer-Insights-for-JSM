// What goes in the PDF export, as plain data. The page draws it with jsPDF
// (static/app/src/exportPdf.js); keeping the wording here means it can be
// tested and stays in step with what the page shows.
import { median, patternTrend, topShares } from './analysis.js';
import { duration, trendWord } from './trend.js';
import { DAYS, hoursOf, outOfHoursShare, peakWindow, windowText } from './timeOfDay.js';

export const PDF_ISSUES = 25; // issues in the table
export const PDF_DETAILS = 10; // issues with example tickets
export const PDF_EXAMPLES = 3;

const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
const approx = (estimated) => (estimated ? '~' : '');
const changeText = (count, previous) => {
  if (!previous) return count ? 'New' : '–';
  const percent = Math.round(((count - previous) / previous) * 100);
  return `${signed(percent)}%`;
};
const peakText = (hours) => { const w = peakWindow(hours); return w ? `${windowText(w)} (${w.share}%)` : ''; };

/** Median time to resolve and share still open: "2.1 days · 12% open". */
export function resolutionLine({ medianHours, openShare } = {}) {
  return [medianHours !== null && medianHours !== undefined ? `${duration(medianHours)} to resolve` : '', openShare ? `${openShare}% open` : '']
    .filter(Boolean).join(' · ');
}

/**
 * The report as PDF sections. `groups` are the patterns as shown (AI-merged
 * after "Summarise with AI"); `ai` is the AI summary, if any.
 */
export function pdfContent({ report, groups = report?.groups || [], ai = null, generatedAt = new Date(), filter = null, crew = null }) {
  if (!report) throw new Error('There is no report to export.');
  const nameOf = (group, index) => ai?.patterns?.find((p) => p.index === index)?.title || group.theme;
  const whereOf = (group) => (report.breakdownFields || [])
    .map((f) => {
      const shares = topShares(group, f.id, 2);
      return shares.length ? `${f.label}: ${shares.map((s) => `${s.value} ${s.share}%`).join(', ')}` : '';
    })
    .filter(Boolean)
    .join(' · ');
  const resolutionOf = (group) => {
    const analysed = group.sampleCount || group.count;
    return { medianHours: median(group.resolvedHours || []), openShare: analysed ? Math.round(((group.openCount || 0) / analysed) * 100) : null };
  };

  const notes = [];
  if (filter) notes.push(`Only tickets where ${filter.label} is ${filter.value}.`);
  if (report.sampled) notes.push(`Patterns come from ${report.analyzedCount.toLocaleString('en-GB')} of ${report.currentCount.toLocaleString('en-GB')} tickets, sampled evenly across the period. Sizes marked ~ are estimates; ticket totals and the comparison are exact.`);
  if (ai) notes.push('Issue names and the overview are AI-generated from pattern names, counts and example summaries. Check the linked tickets before sharing.');

  const kpis = [
    { label: 'Tickets in period', value: report.currentCount.toLocaleString('en-GB') },
    { label: 'Vs previous period', value: report.changePercent === null ? 'New baseline' : `${signed(report.changePercent)}%`, hint: `previous ${report.previousCount.toLocaleString('en-GB')}` },
    { label: 'Recurring issues', value: String(groups.length), hint: `${report.minPatternSize || 2}+ related tickets` },
  ];
  if (report.resolution) kpis.push({ label: 'Median time to resolve', value: duration(report.resolution.medianHours), hint: report.resolution.openShare ? `${report.resolution.openShare}% still open` : 'all resolved' });

  const issues = groups.slice(0, PDF_ISSUES).map((group, index) => ({
    name: nameOf(group, index),
    count: `${approx(group.estimated)}${group.count.toLocaleString('en-GB')}`,
    previous: `${approx(group.estimated && group.previousCount)}${(group.previousCount || 0).toLocaleString('en-GB')}`,
    change: changeText(group.count, group.previousCount),
    trend: trendWord(patternTrend(group, report)),
    where: whereOf(group),
    resolution: resolutionLine(resolutionOf(group)),
    peak: peakText(group.hours || []),
    combines: group.mergedFrom?.length > 1 ? group.mergedFrom : null,
    summary: ai?.patterns?.find((p) => p.index === index)?.summary || '',
    examples: index < PDF_DETAILS ? (group.tickets || []).slice(0, PDF_EXAMPLES).map((t) => ({ key: t.key, summary: t.summary, status: t.status })) : [],
  }));

  // AI categories ("Summarise with AI"): member indexes refer to `groups`.
  const inPatterns = Math.max(1, groups.reduce((n, g) => n + g.count, 0));
  const categories = (ai?.categories?.length > 1 ? ai.categories : []).map((cat) => ({
    title: cat.title,
    share: `${Math.round((cat.count / inPatterns) * 100)}%`,
    count: `${approx(cat.estimated)}${cat.count.toLocaleString('en-GB')}`,
    previous: `${approx(cat.estimated && cat.previousCount)}${(cat.previousCount || 0).toLocaleString('en-GB')}`,
    change: changeText(cat.count, cat.previousCount),
    patterns: cat.members.filter((i) => groups[i]).slice(0, 6).map((i) => `${nameOf(groups[i], i)} (${groups[i].count})`).join(' · ') + (cat.members.length > 6 ? ` and ${cat.members.length - 6} more` : ''),
  }));

  const breakdowns = (report.breakdowns || []).filter((b) => b.values.length).map((b) => ({
    label: b.label,
    estimated: b.estimated,
    values: b.values.map((v) => ({
      value: v.value,
      count: `${approx(b.estimated)}${v.count.toLocaleString('en-GB')}`,
      change: changeText(v.count, v.previousCount),
      resolution: resolutionLine(v),
    })),
    withoutValue: b.withoutValue ? `${approx(b.estimated)}${b.withoutValue.toLocaleString('en-GB')} tickets have no ${b.label}.` : '',
  }));

  let timeOfDay = null;
  if (report.timeOfDay?.analysed > 0) {
    const { grid, timeZone } = report.timeOfDay;
    const totals = grid.map((row) => row.reduce((a, n) => a + n, 0));
    timeOfDay = {
      timeZone,
      grid,
      busiestHours: peakText(hoursOf(grid)),
      busiestDay: DAYS[totals.indexOf(Math.max(...totals))],
      outOfHours: `${outOfHoursShare(grid)}%`,
    };
  }

  const dataQuality = (report.dataQuality || []).filter((d) => d.problemCount > 0).map((d) => ({
    label: d.label,
    text: `${d.share}% of tickets (${approx(d.estimated)}${d.problemCount.toLocaleString('en-GB')}) have no real ${d.label}${d.placeholders.length ? `; placeholders: ${d.placeholders.slice(0, 4).map((p) => p.value).join(', ')}` : ''}.`,
  }));

  return {
    title: report.organization,
    period: `${report.startDate} to ${report.endDate}`,
    generated: generatedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    notes,
    kpis,
    overview: ai?.overview || '',
    actions: ai?.actions || [],
    categories,
    crew: crewSection(crew),
    volume: { points: report.timeSeries || [], unit: (Date.parse(report.endDate) - Date.parse(report.startDate)) / 86400000 < 35 ? 'day' : 'week' },
    issues,
    moreIssues: Math.max(0, groups.length - PDF_ISSUES),
    breakdowns,
    timeOfDay,
    dataQuality,
  };
}

/**
 * A published portal report (a snapshot from publish.js, as portalView returns
 * it) as PDF sections. Only what the customer already sees on the page:
 * example requests are ones shared with their organisation.
 */
export function portalPdfContent(snapshot, { generatedAt = new Date() } = {}) {
  if (!snapshot?.organization) throw new Error('There is no report to download.');
  const { totals, period } = snapshot;
  const n = (value) => (value || 0).toLocaleString('en-GB');
  const notes = [];
  if (snapshot.live) notes.push(`Numbers updated ${String(snapshot.refreshedAt).slice(0, 10)}; summary written ${String(snapshot.summaryWrittenAt).slice(0, 10)}.`);
  if (snapshot.patterns.some((p) => p.estimated) || snapshot.breakdowns?.some((b) => b.estimated)) notes.push('Counts marked ~ are estimates.');

  const kpis = [
    { label: 'Requests', value: n(totals.current), hint: 'in this period' },
    { label: 'Vs previous period', value: totals.changePercent === null ? 'New baseline' : `${signed(totals.changePercent)}%`, hint: `previous ${n(totals.previous)}` },
    { label: 'Common issues', value: String(snapshot.patterns.length) },
  ];
  if (snapshot.resolution?.medianHours !== null && snapshot.resolution?.medianHours !== undefined) {
    kpis.push({ label: 'Typical time to resolve', value: duration(snapshot.resolution.medianHours), hint: snapshot.resolution.openShare ? `${snapshot.resolution.openShare}% still open` : 'all resolved' });
  }

  const issues = snapshot.patterns.slice(0, PDF_ISSUES).map((p, index) => ({
    name: p.title,
    count: `${approx(p.estimated)}${n(p.count)}`,
    previous: `${approx(p.estimated && p.previousCount)}${n(p.previousCount)}`,
    change: changeText(p.count, p.previousCount),
    trend: p.trend?.length ? trendWord(p.trend) : (!p.previousCount ? 'New' : ''),
    where: '',
    resolution: resolutionLine(p),
    peak: peakText(p.hours || []),
    combines: null,
    summary: p.summary || '',
    examples: index < PDF_DETAILS ? (p.examples || []).slice(0, PDF_EXAMPLES).map((e) => ({ key: e.key, summary: e.summary, status: e.status })) : [],
  }));

  const breakdowns = (snapshot.breakdowns || []).filter((b) => b.values.length).map((b) => ({
    label: b.label,
    estimated: b.estimated,
    values: b.values.map((v) => ({ value: v.value, count: `${approx(b.estimated)}${n(v.count)}`, change: changeText(v.count, v.previousCount), resolution: resolutionLine(v) })),
    withoutValue: '',
  }));

  let timeOfDay = null;
  const grid = snapshot.timeOfDay?.grid;
  if (grid && grid.some((row) => row.some(Boolean))) {
    const days = grid.map((row) => row.reduce((a, c) => a + c, 0));
    timeOfDay = { timeZone: snapshot.timeOfDay.timeZone, grid, busiestHours: peakText(hoursOf(grid)), busiestDay: DAYS[days.indexOf(Math.max(...days))], outOfHours: `${outOfHoursShare(grid)}%` };
  }

  return {
    noun: 'Request',
    title: snapshot.organization.name,
    period: `Service report · ${period.from} to ${period.to}`,
    generated: generatedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    notes,
    kpis,
    overview: snapshot.overview || '',
    actions: snapshot.actions || [],
    volume: { points: snapshot.timeSeries || [], unit: (Date.parse(period.to) - Date.parse(period.from)) / 86400000 < 35 ? 'day' : 'week' },
    issues,
    moreIssues: Math.max(0, snapshot.patterns.length - PDF_ISSUES),
    breakdowns,
    timeOfDay,
    crew: crewSection(snapshot.crewRates),
    dataQuality: [],
  };
}

/** "service-report-acme-2026-09-01-2026-09-30.pdf" */
export function portalPdfFileName(snapshot) {
  const who = String(snapshot.organization?.name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `service-report-${who}-${snapshot.period.from}-${snapshot.period.to}.pdf`;
}

export const PDF_CREW_BASES = 25;
const rateText = (rate) => (rate === null || rate === undefined ? '–' : String(Math.round(rate * 10) / 10));

/** Tickets per 100 crew (headcount.js crewRates) as a PDF section: the bases with the highest rates. */
export function crewSection(rates) {
  if (!rates?.bases?.length) return null;
  const approxBase = approx(rates.estimated);
  const bases = [...rates.bases].sort((a, b) => b.rate - a.rate || b.tickets - a.tickets);
  const notes = [];
  if (rates.unmatchedTickets) notes.push(`${approxBase}${rates.unmatchedTickets.toLocaleString('en-GB')} tickets are at bases with no crew number (${rates.unmatched.slice(0, 6).map((u) => u.value).join(', ')}).`);
  if (bases.some((b) => b.small)) notes.push('* Small base: a handful of tickets changes the rate a lot.');
  return {
    field: rates.field,
    summary: [
      `${rates.crew.toLocaleString('en-GB')} crew at ${rates.bases.length} bases`,
      rates.rate !== null ? `${rateText(rates.rate)} tickets per 100 crew (previous period ${rateText(rates.previousRate)})` : '',
      `average across bases ${rateText(rates.average)}`,
    ].filter(Boolean).join(' · '),
    bases: bases.slice(0, PDF_CREW_BASES).map((b) => ({
      value: `${b.value}${b.small ? ' *' : ''}`,
      crew: b.crew.toLocaleString('en-GB'),
      tickets: `${approxBase}${b.tickets.toLocaleString('en-GB')}`,
      rate: rateText(b.rate),
      ratio: b.ratio === null ? '–' : `${b.ratio}x`,
      previous: rateText(b.previousRate),
    })),
    more: Math.max(0, bases.length - PDF_CREW_BASES),
    notes,
  };
}

/** "customer-insights-acme-2026-09-01-2026-09-30.pdf" */
export function pdfFileName(report) {
  const who = (report.organizations?.length > 1 ? `${report.organizations.length}-organisations` : report.organization || 'report')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `customer-insights-${who}-${report.startDate}-${report.endDate}.pdf`;
}

// jsPDF's built-in fonts only cover Windows-1252. Accents are kept where that
// set has them; other letters lose their accent; anything else becomes "?".
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfSafe(text) {
  return String(text ?? '')
    .replace(/[≈]/g, '~').replace(/[→]/g, '->').replace(/[↑]/g, 'up ').replace(/[↓]/g, 'down ').replace(/[−]/g, '-')
    .replace(/[  -​ ]/g, ' ')
    .replace(/[^\n\x20-\x7E]/g, (ch) => {
      if ((ch >= ' ' && ch <= 'ÿ') || CP1252_EXTRA.has(ch)) return ch;
      const plain = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      return /^[\x20-\x7E -ÿ]+$/.test(plain) ? plain : '?';
    });
}
