# Privacy Notes

Rushd is a personal finance app, so privacy matters even while it is an open-source prototype.

## Current Storage

The current version stores app data locally in the browser:

- IndexedDB stores expenses, templates, settings, vault state, and month-end settlement records.
- localStorage stores small preferences such as theme, language, calendar type, motion level, and prompt flags.

The app does not currently send financial records to a server.

## Local Storage Risks

Browser-local data can be deleted when users clear site data, switch browsers, reinstall a browser, use cleanup tools, or move to a different device. Users should export backups before relying on the app for important records.

localStorage and IndexedDB are not a substitute for a secure production financial data system. Anyone with access to the browser profile may be able to inspect local records.

## Repository Rules

Do not commit real financial data, private screenshots, backups, `.env` files, access tokens, or secrets. Demo data must be clearly fake.

## User Guidance

Users should review the code before entering sensitive real data. Rushd is an active prototype and should not be treated as financial advice or completed financial infrastructure.

## Future Privacy Improvements

- Clearer import/export warnings.
- Optional encrypted backups.
- Better migration and recovery guidance.
- If cloud sync is added, an explicit security model, authentication plan, and data retention policy.
