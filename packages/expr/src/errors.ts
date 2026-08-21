export class ExprValidationError extends Error {}

/**
 * A specific case of ExprValidationError: a `record.<field>` reference to a field that
 * doesn't exist *on the entity currently being checked*. Callers that reuse one rowLevel
 * expression across multiple entities (the App Spec access model is app-wide, not
 * per-entity — see docs/adr/007-data-isolation-schema-rls.md) can catch this specifically
 * to mean "this rule doesn't apply to this entity" rather than "this Spec is broken".
 */
export class UnknownFieldError extends ExprValidationError {}
