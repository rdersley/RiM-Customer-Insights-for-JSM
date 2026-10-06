# Customer Insights — notes for contributors and AI assistants

## UI consistency (@retailinmotion/ui)

This app uses the shared Retail inMotion UI kit (`@retailinmotion/ui`). Style guide: `node_modules/@retailinmotion/ui/docs/STYLE_GUIDE.md` (UI Kit apps: `docs/UI-KIT.md`).

- No hardcoded colours in app CSS. Use `var(--nq-*)` tokens. `npm run check:ui` must pass (part of `npm test`).
- New screens use the kit's classes/components: `nq-header`, `nq-tabs`, `nq-card`, `nq-notice`, `nq-empty`, `nq-loading`, `nq-table`, `nq-btn`, `nq-field`, `nq-actionbar`, `nq-footer`.
- Every Custom UI resource calls `enableTheme(view)` from `@retailinmotion/ui/theme` at start-up.
- If a pattern is missing, add it to the `retailinmotion-ui` repo and bump the version. Don't restyle it locally.

Customer Insights specifics:

- The Custom UI is React/Vite in `static/app`. App CSS in `static/app/src/styles.css` covers only the chart and pattern rows; everything else is kit components.
- The header and footer version come from `package.json`.
