# Rolling out to the Retail inMotion sites

Retail inMotion Customer Insights is its own Forge app. The sandbox and work site currently run
Customer Insights from the Marketplace app, so each site moves over once.

## One-off setup

1. Add the repository secrets `FORGE_EMAIL` and `FORGE_API_TOKEN` (the same Atlassian account
   that owns the Marketplace app is fine).
2. Actions → **Register Forge app** → Run. It registers this app with Forge and commits the new
   app id to `manifest.yml`. If your account has several Developer Spaces, the run lists them;
   run it again with the id of the one to use.

## Sandbox (retailinmotion-sandbox1.atlassian.net)

1. In the old app, note the settings (Jira settings → Apps → Customer Insights): breakdown fields
   and which show on the portal, minimum tickets per pattern, placeholder values, spike alerts,
   watched organisations, and the customer portal switch.
2. Actions → **Deploy Customer Insights to Sandbox** → Run.
3. Enter the same settings in the new app (Jira settings → Apps → Customer Insights). While both
   apps are installed there are two Customer Insights entries; Manage apps shows which one is
   Retail inMotion Customer Insights.
4. Re-publish any customer portal reports that should stay visible: published reports belong to
   the old app and are not copied.
5. Uninstall the old Customer Insights from the sandbox (Manage apps), so only this app remains.

## Work site (retailinmotion.atlassian.net)

Same steps, using Actions → **Deploy to Retail inMotion work site** (type `DEPLOY`). It deploys the
Forge `work-site` environment, so merges to `main` never reach the work site on their own.

## What does not carry over

Forge storage belongs to each app, so settings, published portal reports and spike alerts start
empty. Analyses are run live from Jira, so nothing else is lost. Spike alerts rebuild from the next
daily run.

The old app's `EVALUATION_CLOUD_IDS` entry for these sites can be removed once it is uninstalled:
this app has no licence check.
