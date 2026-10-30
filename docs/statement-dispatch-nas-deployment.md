# NAS deployment configuration (staging only)

Confirmed NAS root: `/volume1/docker/statement-dispatch`
- `/volume1/docker/statement-dispatch/data`: version database and audit history
- `/volume1/docker/statement-dispatch/statements`: immutable XLSX/PDF versions

This repository's production `finance.html` is unchanged. No service image, Dockerfile, or complete verified API exists yet. Do not launch a placeholder container.

Deployment requirements:
1. Implement an isolated API and XLSX/PDF generator, backed by these two mounted directories.
2. Generate both artifacts from one immutable financial snapshot and validate hotel, period, department, item, quantity, price, tax, totals, and version before publishing.
3. Require authenticated HTTPS access. Reuse existing Tailscale Funnel only after checking current route and reverse-proxy configuration; never expose DSM or bind the database publicly.
4. Persist manual LINE send acknowledgments separately from mere file downloads/shares. Reject acknowledgments for superseded versions.
5. Back up data and statements and test recovery.
6. Deploy as a new Container Manager project, without modifying or restarting other projects.
7. Test iPhone XLSX sharing, Windows downloads, PDF preview, revision and resend.

Next user action: none until the actual service code and tested compose configuration are ready.
