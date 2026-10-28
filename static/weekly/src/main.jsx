// Customer portal: the Weekly SD report weeks agents published for the
// viewer's organisation(s) (src/portal.js myWeeklyReports), with an Excel
// download built in the browser.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view } from '@forge/bridge';
import '@retailinmotion/ui/css';
import { enableTheme } from '@retailinmotion/ui/theme';
import { Button, EmptyState, Field, Loading, Notice } from '@retailinmotion/ui/react';
import { weekLabel } from '../../../src/weekly.js';
import WeeklyReportView from '../../app/src/WeeklyReportView.jsx';
import { downloadWeeklyExcel } from '../../app/src/exportExcel.js';
import './styles.css';

enableTheme(view);

function Report({ report }) {
  const [from, setFrom] = useState(report.weeks[0].from);
  const record = report.weeks.find((w) => w.week.from === from) || report.weeks[0];
  return <section className="nq-stack">
    <div className="nq-spread wp-title">
      <h2>{report.name}</h2>
      <div className="wp-controls">
        {report.weeks.length > 1 && <Field label="Week" htmlFor={`wp-week-${report.id}`}>
          <select id={`wp-week-${report.id}`} className="nq-select" value={from} onChange={(e) => setFrom(e.target.value)}>
            {report.weeks.map((w) => <option key={w.week.from} value={w.week.from}>{weekLabel(w.week)}</option>)}
          </select>
        </Field>}
        <Button appearance="primary" onClick={() => downloadWeeklyExcel(record)}>Download Excel</Button>
      </div>
    </div>
    <WeeklyReportView record={record} />
  </section>;
}

function App() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    invoke('myWeeklyReports')
      .then((result) => setState({ loading: false, ...result }))
      .catch((error) => setState({ loading: false, error: error.message || 'The weekly report could not be loaded.' }));
  }, []);

  if (state.loading) return <div className="nq-page"><Loading text="Loading your weekly report…" /></div>;
  return <div className="nq-page nq-page--panel">
    {state.error && <Notice kind="error" title="Something went wrong.">{state.error}</Notice>}
    {!state.error && state.available === false && <Notice kind="warning">Weekly reports aren’t available on this site at the moment.</Notice>}
    {!state.error && state.available !== false && !state.reports?.length && <EmptyState title="No weekly report yet">
      Your service team hasn’t published a weekly report for your organisation yet.
    </EmptyState>}
    {state.reports?.map((report) => <Report key={report.id} report={report} />)}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
