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

1. In the old app (Jira settings → Apps → Customer Insights): **Download backup**. The file holds
   the settings, watched organisations, published portal reports and spike alerts.
2. Actions → **Deploy Customer Insights to Sandbox** → Run. Both apps can be installed side by side.
3. In the new app's settings page: **Restore** → choose the file → **Restore this backup**, then
   reload. While both apps are installed there are two Customer Insights entries; Manage apps shows
   which one is Retail inMotion Customer Insights.
4. Check the settings and a published portal report, then uninstall the old Customer Insights from
   the sandbox (Manage apps), so only this app remains.

## Work site (retailinmotion.atlassian.net)

Same steps, using Actions → **Deploy to Retail inMotion work site** (type `DEPLOY`). It deploys the
Forge `work-site` environment, so merges to `main` never reach the work site on their own.

## What carries over

Everything the old app stored on the site, through the backup. Analyses are run live from Jira. If
the old app has no Download backup button yet, update it first (its repository has the change), or
note the settings and enter them again; portal reports can then be re-published.

The old app's `EVALUATION_CLOUD_IDS` entry for these sites can be removed once it is uninstalled:
this app has no licence check.
