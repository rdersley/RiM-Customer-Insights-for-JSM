// Keeps one failing card (or the whole page) from leaving Jira showing a blank
// frame: React unmounts everything on an uncaught render error. The message is
// shown so it can be reported, and logged with the stack for the browser console.
import React from 'react';
import { Button, Card, Notice } from '@retailinmotion/ui/react';

/** The first line of the stack that points into the app, for the report. */
export function whereFrom(error) {
  const line = String(error?.stack || '').split('\n').slice(1).find((l) => /\.jsx?|assets\//.test(l));
  return line ? line.trim().replace(/^at\s+/, '').replace(/\(?https?:\/\/[^)]*\/assets\//, '(').slice(0, 160) : '';
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`Customer Insights: ${this.props.name || 'page'} failed`, error, info?.componentStack);
  }

  componentDidUpdate(previous) {
    // A new analysis gets a fresh try.
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const message = String(error?.message || error);
    const where = whereFrom(error);
    if (this.props.page) {
      return <div className="nq-page">
        <Notice kind="error" title="Customer Insights hit an error and couldn’t show this report.">
          <p>{message}{where ? ` (${where})` : ''}</p>
          <p>Please send this message to the app’s owner. Try again starts a fresh page.</p>
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </Notice>
      </div>;
    }
    return <Card title={this.props.name}>
      <Notice kind="error" title="This section couldn’t be shown.">
        {message}{where ? ` (${where})` : ''}. The rest of the report is unaffected.
      </Notice>
    </Card>;
  }
}

/** One report card, isolated: a failure shows an error card in its place. */
export function Safe({ name, resetKey, children }) {
  return <ErrorBoundary name={name} resetKey={resetKey}>{children}</ErrorBoundary>;
}
