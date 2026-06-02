# Security Policy

Rushd is an active prototype. It should not be described as completed financial infrastructure or used for sensitive records without reviewing the code and storage model.

## Do Not Share Sensitive Data

Do not commit or post:

- API keys, tokens, secrets, or `.env` files.
- Real financial records or exported backups.
- Private screenshots showing personal transactions.
- Personal identifying information.

## Reporting Sensitive Issues

If you find a sensitive security or privacy issue, avoid posting private details publicly. Contact the repository owner through GitHub with a high-level summary first.

## Current Security Model

The current app stores data locally in the browser using IndexedDB and localStorage. There is no server, cloud sync, authentication, or encryption in this version.

## Future Goals

- Stronger backup validation.
- Clearer user-facing privacy warnings.
- Optional encrypted backup.
- A formal security model before any cloud sync or AI integration.
