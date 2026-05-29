# GTD — public PWA mirror

This is the **public, install-from-phone mirror** of the GTD app. It contains only
the static front-end (no server, no data) so GitHub Pages can serve it over HTTPS.

- **Source of truth:** the private `GTD` repo. Do not edit files here by hand —
  they are regenerated from the private repo's `templates/index.html` + `static/`
  by `deploy_pages.ps1` and force-pushed.
- **No personal data lives here.** GTD data stays in each device's `localStorage`
  (and optionally your own OneDrive); none of it is in this repo.

## Install on a phone
Open the Pages URL in Chrome → menu → **Add to Home screen**. Works fully offline
afterwards; data lives on the phone.
