# Data Model

This document describes the current Rushd data model based on `index.html`.

## Implemented

### Expense

Stored in IndexedDB `expenses`.

Typical fields include `id`, `name`, `expectedCost`, `actualPaid`, `date`, `category`, `classification`, `isPaid`, source fields for templates/flexible expenses, and timestamps.

### Template

Stored in IndexedDB `templates`.

Templates represent planned expenses. Current template types cover daily/workday/offday applicability, monthly recurrence, and flexible expense definitions with monthly budget and max-use settings.

### Settings

Stored in IndexedDB `settings`, with some boot preferences mirrored in localStorage.

Settings include base allowance, safe-to-spend mode, language/calendar preferences, theme, motion level, template profiles, monthly template assignments, vault state, and month-end settlements.

### Template Profile

Implemented inside settings. A profile groups recurring plans and offdays so the app can apply different monthly planning patterns.

### Flexible Expense Definition

Implemented as a template-like record. It tracks default amount, monthly budget, usage count, and remaining flexible budget.

### Vault Goal

Implemented inside settings vault state. Goals include name, target amount, progress, and completion state.

### Vault Transaction

Implemented inside settings vault state. Transactions track movement into the savings vault, especially month-end surplus movement.

### Month-End Settlement

Implemented inside settings. Settlement records help calculate surplus carryover or vault transfers across months.

## Planned / Not Fully Implemented

### Income

The app models a base allowance/budget, but a separate income ledger is not currently implemented.

### Cloud User Account

No authentication or cloud user entity exists in this version.

### AI Insight

The app has smart/rule-based insights, but no model-backed insight entity exists.

### Category Catalog

Categories are currently defined in app code rather than managed as a separate persistent catalog.
