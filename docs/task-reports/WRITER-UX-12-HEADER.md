# WRITER-UX-12-HEADER

Owner: codex-main-header12-20261013. Baseline 5080db4; preserve concurrent rename/delete delivery.

## Changes
- Compact two-row header; removed duplicate breadcrumb, reduced spacing, one-row mobile tabs and horizontally scrollable actions.
- Removed repeated global check banner. All check details and optional scheduling now live in the review tab; no time panel interrupts actor or plot editing.
- Failures render as inline, closed-by-default details with an accessible alert summary; known conflicts/session/permission/rate errors retain helpful guidance. No raw service errors shown. Local notices are compact; duplicate feedback suppressed.
- Publish/trial/save permission and check guards unchanged.

## Acceptance
- npm run check: 2118 passed, no failures. npm run build passed.
- 23 workbench tests cover scheduling moved to review, intact publish guards, and collapsed failure guidance.
- Ego 168, local production build: 1440 desktop header 95.30px; 390 mobile header 178.19px; no viewport overflow. Actor page has no scheduling panel.
- Simulated network failure on check, local only: inline feedback 31.5px, closed, no modal; actor input retained; expanding shows guidance. No model calls or world creation.
- Production 50 migration checksums verified; no new SQL.
- Deployed 6c725e5ab4c3229fcb6462b068a71aded760af38; dpl_3B6Ca4DJmuiKdkgumAhJ4j8U2nHf READY and formal alias verified. Public 1440/390 actor page: no global time/banner, no horizontal overflow; review time details default closed. Health/workbench 200; anonymous works 401.
- Production read-only synthetic draft inspection; no draft writes or new worlds. Publisher cookies restored; browser space finished; own local server and PostgreSQL stopped.

## Remaining
Existing WRITER-UX-09/11 deferred items remain in the main board. This task does not claim importer dialogs or all application errors redesigned.
