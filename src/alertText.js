// Alert wording shared by the alert job (ticket summaries) and the agent page.

/** "up 120% (22 vs 10 the week before)" or "new: 6 tickets, none the week before". */
export function changeText(alert) {
  const approx = alert.estimated ? '≈' : '';
  return alert.previousCount
    ? `up ${alert.changePercent}% (${approx}${alert.count} vs ${approx}${alert.previousCount} the week before)`
    : `new: ${approx}${alert.count} tickets, none the week before`;
}
