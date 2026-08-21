import pg from "pg";

/**
 * node-postgres's default parser for a plain SQL DATE (OID 1082) constructs a JS
 * `Date` using the multi-argument constructor (`new Date(year, month, day)`), which
 * is interpreted in the SERVER PROCESS's local timezone — not UTC. Once that Date is
 * later JSON-serialized (`Date.toJSON()` → `toISOString()`, always UTC) and read back
 * on the client, a server running east of UTC (e.g. Asia/Tokyo) silently shifts every
 * date backward by a day (2026-08-21 → "2026-08-20T15:00:00.000Z"). A plain calendar
 * date has no timezone to begin with, so the correct fix is to not convert it to a
 * `Date` at all — keep it as the "YYYY-MM-DD" string Postgres sent. This must run
 * before any pool created by this process executes a query against a `date` column.
 *
 * Deliberately scoped to DATE only (OID 1082) — TIMESTAMPTZ (1184) legitimately
 * represents a real instant and should keep the default UTC-aware conversion.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
