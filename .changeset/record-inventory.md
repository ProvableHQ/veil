---
"@provablehq/veil-core": minor
"@provablehq/veil-aleo-sdk": minor
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": minor
---

Add scanner-backed ARC20, ARC22, and native credits inventory actions, shared record reservations, and Shield Swap inventory wrappers. Add shield-swap inventory commands with bounded maintenance policies and a CLI-only SQLite recovery journal exported from @provablehq/shield-swap-cli/storage. SDK packages retain their existing runtime requirements.

Allow inventory assets to specify only a program, with optional record-name and amount-field overrides. Resolve amount before microcredits for custom records and use the deployed unsigned integer width.

Prefer available batch join helpers for more than two records: up to 16 credits or dedicated stablecoin records, and 15 dynamic ARC records. Validate helper interfaces, capture them in plans, and match their confirmed outputs before dependent steps. Explicit dynamic routers remain supported; tokenJoin: false selects native pairwise joins. Reservations and recovery remain off unless recordManagement.enabled is true.

Support private fees on managed local-account writes. Prefer an eligible supplied fee record, otherwise reserve a sufficient unreserved credits record alongside the execution inputs. Pass that record through local, delegated, and devnode proving, verify it before broadcast, and retain charged private fee records after rejected executions.

Retry automatic local Shield Swap record selection on pre-proving reservation conflicts. Keep swap terms fixed, bound retries to one scan, and preserve explicit inputs and execution errors. Export RecordReservationConflictError for input acquisition failures.

Record per-entry rebroadcast attempts and errors without releasing uncertain inputs or preventing later entries from being reconciled. Show recovery diagnostics in CLI status and waiting results. Reject unsupported wallet fee ceilings before scanning nonempty inventory plans while allowing no-op plans.
