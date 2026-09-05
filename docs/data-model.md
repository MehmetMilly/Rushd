# Data Model

This document describes the current Rushd data model. P02 moves its legacy-v1
implementation to `src/data/legacy-v1/` without changing persisted data.

## Implemented

### Expense

Stored in IndexedDB `MicroSaveOS_DB` version 1, object store `expenses` with
key path `id` and non-unique `date` and `isPaid` indexes.

Typical fields include `id`, `name`, `expectedCost`, `actualPaid`, `date`, `category`, `classification`, `isPaid`, source fields for templates/flexible expenses, and timestamps.

### Template

Stored in the unchanged version-1 `templates` object store with key path `id`.

Templates represent planned expenses. Current template types cover daily/workday/offday applicability, monthly recurrence, and flexible expense definitions with monthly budget and max-use settings.

### Settings

Stored in the unchanged version-1 `settings` object store with key path `key`.
Some boot preferences remain mirrored in localStorage.

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

## P03 canonical model (Task A)

The canonical engine under `src/domain/` stores nothing yet; these are the
in-memory record shapes its commands produce, proven by the transactional
in-memory adapter in tests. The legacy v1 model above is unchanged, and no
legacy data has been migrated.

- **Money**: `{ currency, minorUnits }` — checked safe-integer minor units of
  an explicitly supported ISO currency (SAR/USD exponent 2, JPY 0, KWD 3).
  Signed values are allowed; parsing rejects excess precision, malformed or
  mixed-numeral input, and overflow instead of rounding.
- **FinanceBook**: stable `id`, display name, one bound ISO currency, profile
  IANA timezone, monthly cycle anchor (first-of-month or payday day 1–31),
  and creation time/date/timezone. Currency never changes per book and no
  foreign-exchange conversion exists.
- **BookState**: the book plus a monotonic `revision` (new book starts at 1;
  every committed command produces exactly revision + 1), its cycle records,
  and its ledger entries.
- **OpenCycleRecord**: one open full-cycle window with derived identity
  `cyc:<bookId>:<startDate>`, inclusive `startDate`, exclusive
  `endDateExclusive` (payday anchors clamp to short months), and non-negative
  starting funds. Close/carry/reopen and closed settlements are later tasks.
- **LedgerEntry**: `inflow` facts (positive amount, captured local date,
  timezone, cycle identity, calculation version, source operation) and
  `inflowReversal` facts (negated amount, `reversesEntryId`). Reversals
  append linked facts; original history is never rewritten.
- **OperationRecord**: the durable journal of committed commands — operation
  ID, book, canonical command payload, and receipt (revision before/after,
  commit instant, canonical digest, calculation version, effects). The
  idempotency scope is the operation ID across the whole repository.
- **OutboxEnvelope**: one pending replication entry per committed operation,
  written in the same transaction as the state and receipt. Nothing drains it
  yet; sync behavior is a later phase.

## P03 canonical model additions (Task B)

Task B extends the same in-memory canonical model. All records stay
immutable; state changes append linked facts.

- **LedgerEntry additions**: `expense` (positive outflow with nullable
  `category`, `flexibleDefinitionId`, `linkedObligationId`, and
  `replacesEntryId` for correction replacements), `expenseReversal` (negated
  amount, `reversesEntryId`), and `expenseReturn` (positive money received
  back, linked to an expense or an obligation). Category and
  flexible-definition links are descriptive only.
- **ObligationRecord** + **ObligationEvent**: the expected item (stable
  caller-supplied `obligationId`, due-cycle identity at creation, expected
  amount) is immutable; status transitions (`finalSettlement`,
  `cancellation`, `reopening`), the dispute overlay (`disputeOpened`,
  `disputeResolved` with its resolving action), and confirmed
  disputed-residual releases (`residualReleased`) are append-only events.
  Open obligations reserve `max(0, expected - unreversed net payments)`;
  a standing release decision suppresses the reservation while recording
  unresolved uncertainty, and is reset when the obligation is closed or
  explicitly reopened.
- **GoalRecord**: stable caller-supplied `goalId`, name, and positive target
  amount. Progress is the goal's assigned balance, never a shared total.
- **AllocationRecord**: `funding` (spendable → tracked pool, once),
  `assignment` / `unassignment` (between tracked-unallocated and a goal, no
  availability effect), `release` (tracked pool → one named destination
  cycle, once), and `reversal` (linked inverse of an earlier record,
  rejected when it would break conservation). Conservation invariant:
  unallocated + Σ assigned == funding − releases.
- **BufferSetting**: the explicit buffer amount replacing the previous
  setting on each confirmed `setBuffer`; deducted once by the availability
  calculation.
- **Derived queries** (pure, not stored): availability (signed amount,
  component breakdown, currency, data-as-of, calculation version,
  completeness), pacing (explicit eligible dates, exact integer division
  with a reported remainder), and completeness (pool and classification
  dimensions with typed reasons: `noPoolBasis`,
  `openDisputedObligation`, `releasedResidualUncertainty`,
  `unclassifiedExpenseMovements`).

## P02 compatibility boundary

`src/data/legacy-v1/contracts.ts` records the v1 database name, version,
stores, and common persisted shapes. `runtime.js` holds the mechanical
normalizers and storage behavior. P02 does not rename the database, bump its
version, rewrite records, or add a migration. P04 owns any verified migration.
