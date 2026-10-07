# Changelog

## Unreleased

- **Words that mean the same:** tickets that call the same thing by different names now group together, for example "Bluepad connection" and "Pinpad connection", or "sync" and "synchronisation". Admins edit the lists in settings (Patterns); the first word of each list names the pattern. Defaults cover payment devices (pinpad, bluepad, pin pad, card reader…), sync and log in. The AI merge and live report refreshes are given the same lists.

## 1.3.0 (2026-10-02)

- **Several organisations at once:** analyse up to 10 organisations together. A By Organisation breakdown is added automatically, with drill-down and Open in Jira, and each issue shows its split by organisation. Portal reports stay one organisation each.

## 1.2.0 (2026-10-02)

- **When tickets arrive:** a day-of-week × hour heatmap in the agent's time zone, with the busiest hours, busiest day and the share created out of hours. Each issue says when it mostly happens, and the AI summary can mention it.
- **Licensing:** sites on the evaluation list are allowed even when Forge reports an inactive licence (sharing-link installs).

Marketplace readiness:

- **Customer portal is off by default** and switched on per site in settings. The `PORTAL_REPORTS` Forge variable is gone: variables apply to every site installed from an environment.
- **No account ids are stored.** Reports no longer keep who published them and alerts no longer keep who dismissed them; ids stored by older versions are removed by the hourly job.
- **One production build:** `main` with licensing on; internal and evaluation sites are allowed through `EVALUATION_CLOUD_IDS`.
- README rewritten to match the app, with a data and permissions table.

## 1.1.0 (2026-10-01)

Needs permission to create Jira issues (`write:jira-work`), so a Jira admin approves the upgrade. Tickets are only created when an admin switches it on.

- **Resolution time:** median time to resolve and share still open, for the period, each pattern and each breakdown value.
- **Drill-down:** click a breakdown value to analyse just those tickets; **Open in Jira** for patterns and values.
- **Data quality:** share of tickets with no value or a placeholder (Unknown, Please update…) per breakdown field, with examples. Placeholder values are an admin setting.
- **Trends:** a trend line and New / Rising / Steady / Fading for each pattern.
- **Spike alerts:** a daily check of watched organisations; patterns that jump show as alerts in the app, and optionally as Jira tickets in a chosen project.
- **Customer portal:** customers see the same report as agents for their own organisation, built by the app from their organisation's tickets: trends, time to resolve, example requests linking to the portal, and breakdowns an admin marks **Show on portal**.
- **Fixes:** links to tickets and searches now open the Jira site, not api.atlassian.com.

## 1.0.0 (2026-10-01)

First feature-complete version, running on the RiM work site and sandbox.

- **Analysis:** recurring patterns per customer organisation, with exact totals and trends against the previous period. Large customers are sampled evenly; **Analyse every ticket** removes the sample. Period presets (this or last week, month and quarter, and more).
- **Patterns:** grouping that ignores ticket codes, templates and word forms. AI merges patterns that are the same issue and names them. The **minimum tickets per pattern** is configurable (default 3).
- **AI summary:** Atlassian-hosted Claude (Forge LLMs). Gives an overview, suggested follow-ups, and names and descriptions for each pattern.
- **Breakdowns:** up to **5** admin-chosen fields (for example base or device type), with "where it happens" on each pattern.
- **Settings page:** Jira settings → Apps → Customer Insights.
- **Customer portal:** reviewed reports, optionally kept up to date daily or weekly, with a customer Refresh button limited to once an hour.
- **Reliability:** Jira rate limits (429) and brief outages (503) are retried with back-off.
- **Licensing:** Marketplace licensing that fails closed in production, with an allow-list for evaluation sites.
