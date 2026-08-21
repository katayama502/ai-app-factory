export class AppNotFoundError extends Error {}
export class EntityNotFoundError extends Error {}
export class UnknownColumnError extends Error {}
/** The row was either never there, or RLS filtered it out for this caller — deliberately indistinguishable (S-05, 02_SECURITY §12: hide existence, don't just deny access). */
export class RecordNotFoundError extends Error {}
