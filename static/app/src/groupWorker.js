// Groups every ticket off the main thread (see fullAnalysis.js).
import { buildReport } from '../../../src/analysis.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ report: buildReport(data.issues, data.startDate, data.endDate, null, { limit: Infinity, breakdowns: data.breakdowns || [], minPatternSize: data.minPatternSize, placeholders: data.placeholders || [], synonyms: data.synonyms || [], timeZone: data.timeZone }) });
  } catch (error) {
    self.postMessage({ error: error.message || 'Grouping failed.' });
  }
};
