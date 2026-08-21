/**
 * Platform-wide bootstrap: runs once per cluster, before any app schema is compiled.
 *
 * Creates the two resolver functions `access.rowLevel` may call (ADR-011) —
 * `department_of()` / `descendants_of()` — as SECURITY DEFINER functions in `public`,
 * so an app role can resolve "what department does this user belong to" without ever
 * being granted direct SELECT on the Control Plane's `users`/`departments` tables.
 *
 * The `public.users` / `public.departments` tables here are a **minimal stand-in**.
 * The real Control Plane schema (`organizations`, `departments`, `users`,
 * `role_assignments`, ...) is `packages/db`'s responsibility (Prisma-managed, not yet
 * built — see 01_ARCHITECTURE §6). This file only needs the two columns the resolver
 * functions actually read, so it can be developed and tested independently of that
 * larger schema, and the shapes here must stay a subset of whatever `packages/db`
 * eventually defines.
 */
export const PLATFORM_BOOTSTRAP_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS public.departments (
     id UUID PRIMARY KEY,
     parent_id UUID REFERENCES public.departments(id)
   )`,

  `CREATE TABLE IF NOT EXISTS public.users (
     id UUID PRIMARY KEY,
     department_id UUID REFERENCES public.departments(id)
   )`,

  `CREATE OR REPLACE FUNCTION public.department_of(p_user_id UUID)
   RETURNS UUID
   LANGUAGE sql
   STABLE
   SECURITY DEFINER
   SET search_path = public
   AS $$
     SELECT department_id FROM public.users WHERE id = p_user_id
   $$`,

  `CREATE OR REPLACE FUNCTION public.descendants_of(p_department_id UUID)
   RETURNS UUID[]
   LANGUAGE sql
   STABLE
   SECURITY DEFINER
   SET search_path = public
   AS $$
     WITH RECURSIVE tree AS (
       SELECT id FROM public.departments WHERE id = p_department_id
       UNION ALL
       SELECT d.id FROM public.departments d JOIN tree t ON d.parent_id = t.id
     )
     SELECT array_agg(id) FROM tree
   $$`,
];

/** Function signatures used for GRANT EXECUTE statements — must match the definitions above. */
export const RESOLVER_FUNCTION_SIGNATURES = [
  "public.department_of(uuid)",
  "public.descendants_of(uuid)",
] as const;
