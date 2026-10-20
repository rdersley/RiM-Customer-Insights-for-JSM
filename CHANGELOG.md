# Changelog

## 1.23.0 (2026-10-20)

- **Report sections:** Settings → Customers and Settings → Internal each have a Report sections card to show or hide any section of the report: AI summary, ticket activity, what stands out, customer health, flow and workload, team performance, escalation levels, breakdowns, tickets per 100 crew, when tickets arrive, data quality, where the effort goes, devices affected, SLAs, knowledge gaps and the customer portal card. Hidden sections are left out of the page, downloaded PDFs and emailed PDFs, and their data isn't fetched. Headline numbers and issue patterns always show. Customer portal reports are unchanged.

## 1.22.0 (2026-10-16)

- **Customer health score:** a 0–100 score (Healthy 75+, Watch 50–74, At risk under 50) from five signals, each scored 0–100 and weighted: ticket volume against the previous period (20%), share of tickets in rising or new issues (20%), SLAs met (25%), open tickets over 30 days old (20%) and customer satisfaction (15%). Signals without enough data are left out and the rest weighted up. Internal only: never on the portal or sent to customers.
- **On every customer report:** a Customer health card with the score, each signal's detail and score, and the weakest signal. "Include in PDF" (on by default) adds it to the Export PDF.
- **All-customers list:** Settings → Customers → Customer health. Choose up to 50 organisations; each is scored once a day (from 05:00 UTC) over the last 30 days, as the app. The Customer Insights page lists them worst first with the 7-day change, a 30-day trend line, the weakest signal and Analyse. Agents only see organisations they can see. Admins can Refresh now.
- **Email reports:** schedules with no customer recipients (internal only), and test sends, include the health score in the PDF.
- Reports now read the satisfaction (CSAT) rating with the tickets, for the score.

## 1.21.1 (2026-10-15)

- **Retail inMotion logo:** shown as the app's icon in the Jira sidebar and in place of the letter tile in the header of the Customer Insights page and its settings. (The customer portal keeps its own branding.)

## 1.21.0 (2026-10-15)

Adds the app's first outside connection (Microsoft 365, for email only), so it is a major Forge version: a Jira admin approves the upgrade in Manage apps.

- **Email reports:** Settings → Customers → Email reports. Connect a Microsoft 365 mailbox (tenant ID, app client ID, client secret, sender) and add schedules: organisation(s), report period, weekly (day and hour) or monthly (day and hour) in a time zone, or send-only; internal and customer recipients; subject and message; optional AI summary. Each send runs the analysis for the period as the app, builds the same PDF as Export PDF (with crew rates, devices, channel heatmaps and logos) and emails it as an attachment. **Send now**, **Send test** to one address, and a log of recent sends.
- The client secret is stored encrypted as a Forge secret, never shown again, and left out of backups.

## 1.20.1 (2026-10-15)

- **PDF: a heatmap per contact channel.** Under the overall "When tickets arrive" chart and the channel table, the agent and portal PDFs now draw a heatmap for each channel (e.g. Phone, then Email; up to 4, not "Not set"), with the same hour columns and each channel's share, busiest day and hours, so they can be compared on paper. Each chart is shaded against its own busiest hour.

## 1.20.0 (2026-10-15)

- **When tickets arrive, by contact channel:** choose the channel field in settings (Customers → Contact channel, e.g. Issue Received by). The heatmap then has All / Phone / Email… buttons with each channel's share, busiest hours and busiest day, and a line comparing where each channel peaks. Shown on agent reports, the PDF (a table per channel), the customer portal's Service report (from its next live refresh) and the portal PDF. Read from each analysed ticket; no extra Jira calls.

## 1.19.0 (2026-10-13)

- **Escalation levels** (Internal tab, per project settings, e.g. SD only): for tickets created in the period, the highest support level each reached (stayed at 1st level, went to 2nd, went to 3rd) with counts and percentages, and the time from creation to reaching 2nd and 3rd level (typical, average and 90th percentile). Worked out from status history. Switch it on in Settings → Internal → (project settings) → Escalation levels and list each level's statuses, or leave them empty to recognise "1st/2nd/3rd" in status names. The card shows which statuses counted as which level.

## 1.18.0 (2026-10-13)

- **Devices affected:** choose the ticket field that holds the device ID or serial, and the device type field, in settings (Customers → Devices). Reports get a Devices affected card: distinct devices per recurring issue, by device type, against the fleet. **Live surges** show devices affected too (also in the incident ticket's description).
- **Fleet from crew numbers:** each device type has a number per crew member (defaults: 1 vPOS and 1 card reader), so the fleet is worked out from the crew list until Assets is fully populated.
- **Suggested priority:** P1 at 20%+ of a fleet affected and P2 at 5%+ by default (admin thresholds). Suggestions only; agents decide.

## 1.17.3 (2026-10-12)

- AHT is shown in minutes ("4 min", "1 h 20 min", "under 1 min") instead of tenths of an hour, so short handling times no longer show as 0 h. Sorting by AHT uses minutes too.

## 1.17.2 (2026-10-12)

- **AHT fix:** ticket history times are read whether Jira sends them as dates or epoch numbers, and repeated history entries are counted once. Time in progress with nobody assigned goes to whoever moved the ticket there.
- **AHT check:** when few tickets have handling time, Team performance lists the statuses those tickets actually passed through, so the handling statuses in settings can be matched exactly.
- Security: forces the patched prosemirror-view (npm audit).

## 1.17.1 (2026-10-12)

- Team performance (agent figures and AHT) is only on the Internal tab. Customer reports no longer show it, and the server refuses it for customer analyses.

## 1.17.0 (2026-10-12)

- **AHT (average handling time)** on Team performance: how long tickets were in progress while assigned to each agent, per ticket they worked on, plus total handling hours, for each agent (Jira admins) and the team. Worked out from each resolved ticket's status and assignee history; a ticket passed between agents splits its time. By default every "in progress" status counts except waiting ones (Waiting for customer, Pending, On hold…); settings (Internal → Handling time) can list the exact statuses instead.

## 1.16.0 (2026-10-12)

- **Team performance:** reports (both tabs) get a Team performance card for tickets resolved in the period and open now: resolved, typical time to resolve, SLA met (the SLA fields that apply), customer satisfaction (average rating and how many rated), time logged, open tickets and the oldest, and the work mix (top issue types and the share that was urgent). **Per-agent figures are shown to Jira admins only**; everyone else sees team totals. Nothing is stored: figures are worked out when the report runs. Large periods are sampled evenly.

## 1.15.0 (2026-10-11)

- **Settings per project:** on the Internal tab of settings, add project settings (for example IT Help, or Service Desk for SD and HW) with their own client fields, breakdown fields, SLAs, patterns, words that mean the same and placeholders. A new set starts as a copy of the default. An internal analysis uses a project's settings when every chosen project shares them; anything else uses the default internal settings, and the report says which were used.
- Clients are matched in every client field across all settings, so "SD Client" and "Client" both work whichever settings apply.

## 1.14.0 (2026-10-11)

- **SLAs:** choose the service project SLA fields that matter in settings (Internal → SLAs; for example Time to resolution, Time to first response). Reports on both tabs show the share met and breached in the period, the recurring issues that breach most, and the breakdown values (such as teams) with the highest breach rate. Works with full analysis too.
- **Knowledge gaps:** a "Check knowledge base" button on reports searches the knowledge base for each of the top 15 recurring issues and flags the ones with no matching article, with links to any matches. Searches run as the agent, so they only find articles the agent can see.

## 1.13.0 (2026-10-11)

- **Internal pattern settings:** the Internal tab of settings has its own minimum tickets per pattern, words that mean the same and placeholder values, used by internal reports (and their AI merge and full analysis). Internal word lists start with IT defaults: laptop/notebook/pc, login/sign in, password, MFA/2FA/authenticator, VPN/remote access, access/permissions. Customer settings are unchanged.
- The General tab is now Backup.

## 1.12.0 (2026-10-11)

- **Settings in tabs:** Customers (breakdown fields, crew numbers, spike alerts, surge detection, portal, PDF logos), Internal (client fields and breakdown fields) and General (patterns, data quality, backup & restore).
- **Internal breakdown fields:** internal reports have their own breakdown fields (for example team, component or category), separate from customer reports. Project and Client are still added automatically. Until some are chosen, internal reports show only Project and Client.

## 1.11.1 (2026-10-11)

- The Internal tab reads the client fields each time it opens, so a change in settings shows without reloading the page.
- Settings: the client field list has a search box, with ticked fields at the top.
- Logs record the flow counts and how many client fields are set.

## 1.11.0 (2026-10-10)

- **Internal analysis:** a new Internal tab analyses your own projects instead of customer organisations: pick projects and, optionally, clients. The client is read from the client fields a Jira admin chooses in settings (for example SD Client in SD and Client elsewhere). Leave projects empty to follow a client across every project. Recurring issues, AI summary and categories, trends, time of day and full analysis all work the same. Internal reports break down by Project (several projects) and Client (several or no clients chosen), with drill-down.
- **Where the effort goes:** recurring issues ranked by time logged on their tickets, or by tickets × typical time to resolve when little time is logged.
- **Flow and workload** (Customers and Internal): tickets created against resolved over the period, backlog change, open tickets now and their age, and a forecast of tickets per week for the next 4 weeks from the last 12 (with a normal range), plus the busiest hours of the week ahead for staffing.

## 1.10.0 (2026-10-10)

- **PDF logos:** a Jira admin uploads your logo and a logo per customer organisation in settings (PDF logos). PDFs show yours top left and the customer's top right, on the agent page and the portal's Download PDF. Images are shrunk in the browser before saving (PNG, JPEG or SVG in; at most 800 × 300 pixels kept).
- **Crew lists for several organisations:** one crew list can now cover several organisations (for example Ryanair Crew, Hardware, Bond and Head Office). Reports for any of them, on their own or together, show tickets per 100 crew. Lists saved earlier carry over. When some analysed organisations aren't in the list, the report says which.
- The settings log now records how many crew lists and whether surge detection is on.

## 1.9.0 (2026-10-09)

- **Live surge detection:** every 5 minutes, the latest tickets from watched organisations are grouped like a report. When enough tickets about the same issue arrive within the window (admin thresholds: tickets, minutes, times the normal rate for the last 7 days, and optionally a number of bases), agents see a **Live surges** alert at the top of the page. Off until a Jira admin turns it on in settings.
- **Incident ticket for System Alert Manager (optional):** one "Possible incident" ticket per surge in the chosen project (SD, P2 by default, so "Send System Alert" is available), with the matching tickets linked and chosen fields (such as the client) copied from them. Later tickets on the same surge are linked with a comment instead of raising another ticket. The Organizations field is never copied, so customers don't see it.

## 1.8.0 (2026-10-09)

- **Tickets per 100 crew:** a Jira admin uploads a customer's crew list in settings (Crew numbers). Only the number of crew per base is kept; the file is read in the browser, so names and contact details never leave the admin's computer. Reports then show tickets per 100 crew overall and for each base, ranked by rate and compared with the average, so a small base with lots of issues stands out next to STN or DUB. Small bases are marked, bases with tickets but no crew number are listed, and the table is in the PDF and CSV.
- **Portal (optional):** tick "Show on portal" for an organisation and its live portal report shows requests per 100 crew from the next refresh, in the page and the PDF.

## 1.7.0 (2026-10-09)

- **AI categories:** "Summarise with AI" now also sorts the issues into a few broad categories (for example vPOS, payment devices, stock and products) with totals and change, and each category opens to its patterns. Switch between By category and All patterns. Categories are in the PDF and CSV, and the AI overview leads with them.

## 1.6.0 (2026-10-09)

- **Create problem:** turn a recurring issue into a Jira problem (created as the agent), with the facts and optionally links to up to 20 example tickets. Uses the existing permission to create issues: no new scopes.
- **Portal: when requests arrive:** busiest hours, busiest day and a heatmap on portal reports, in the publishing agent's time zone. Reports published earlier show UTC until they're replaced.
- **Portal: Download PDF:** customers can download their service report as a PDF, with the same layout as the agent page's Export PDF and only what the portal page shows.

## 1.5.0 (2026-10-07)

- **Export PDF:** a printable report next to Export CSV, built in the browser: headline numbers, the AI summary and follow-ups (when generated), ticket activity, the top 25 recurring issues with where they happen, time to resolve and peak hours, example tickets for the top 10, breakdowns, when tickets arrive, and data quality. It uses the AI names when the AI summary has been run, and notes sampling and drill-down filters.

## 1.4.0 (2026-10-07)

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
