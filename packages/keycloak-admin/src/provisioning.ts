import { KeycloakAdminError, type KeycloakAdminClient } from "./client.js";

export async function createRealm(admin: KeycloakAdminClient, realm: string): Promise<void> {
  await admin.request("POST", "/admin/realms", { realm, enabled: true });
}

/**
 * Keycloak 26's declarative User Profile rejects any user attribute not explicitly
 * declared in its schema by default (`unmanagedAttributePolicy` unset) — a custom
 * attribute like `department` is silently DROPPED, not rejected with an error, which
 * makes the failure mode confusing (discovered the hard way against a real Keycloak
 * instance before writing this). `ENABLED` is the simplest fix for a Spec-driven
 * platform that doesn't know its full attribute set upfront; declaring `department`
 * as a first-class profile attribute would be the more precise alternative if the
 * attribute set is ever meant to be fixed and validated.
 */
export async function allowUnmanagedAttributes(admin: KeycloakAdminClient, realm: string): Promise<void> {
  const profile = await admin.request<Record<string, unknown>>("GET", `/admin/realms/${realm}/users/profile`);
  await admin.request("PUT", `/admin/realms/${realm}/users/profile`, { ...profile, unmanagedAttributePolicy: "ENABLED" });
}

export interface ClientOptions {
  clientId: string;
  secret: string;
  redirectUris: string[];
}

/** A confidential client with the standard (Authorization Code) flow enabled — the BFF pattern (ADR-006): the client secret lives only in the server-side BFF, never the browser. */
export async function createConfidentialClient(admin: KeycloakAdminClient, realm: string, opts: ClientOptions): Promise<string> {
  return admin.requestCreated(`/admin/realms/${realm}/clients`, {
    clientId: opts.clientId,
    secret: opts.secret,
    enabled: true,
    publicClient: false,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    redirectUris: opts.redirectUris,
  });
}

/**
 * `realm_access.roles` and custom user attributes are NOT included in the ID token by
 * default even though they ARE in the access token (Keycloak's built-in "roles" scope
 * mapper has `id.token.claim=false` out of the box) — confirmed against a real
 * instance. Rather than have every caller parse the access token JWT by hand, these
 * dedicated client-level mappers put both claims on the ID token directly, so
 * `packages/auth-bff` can read everything it needs from the one token OIDC already
 * validates for it.
 */
export async function addClaimsMappers(admin: KeycloakAdminClient, realm: string, clientUuid: string): Promise<void> {
  await admin.request("POST", `/admin/realms/${realm}/clients/${clientUuid}/protocol-mappers/models`, {
    name: "department",
    protocol: "openid-connect",
    protocolMapper: "oidc-usermodel-attribute-mapper",
    config: {
      "user.attribute": "department",
      "claim.name": "department",
      "jsonType.label": "String",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "userinfo.token.claim": "true",
    },
  });

  await admin.request("POST", `/admin/realms/${realm}/clients/${clientUuid}/protocol-mappers/models`, {
    name: "realm-roles",
    protocol: "openid-connect",
    protocolMapper: "oidc-usermodel-realm-role-mapper",
    config: {
      multivalued: "true",
      "claim.name": "realm_access.roles",
      "jsonType.label": "String",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "userinfo.token.claim": "true",
    },
  });
}

export async function createRealmRole(admin: KeycloakAdminClient, realm: string, roleName: string): Promise<void> {
  await admin.request("POST", `/admin/realms/${realm}/roles`, { name: roleName });
}

/** Looks up a client's internal UUID by its clientId (the human-readable one every other function here takes) — the Admin API's own delete/mapper endpoints need the UUID, not the clientId. */
async function findClientUuid(admin: KeycloakAdminClient, realm: string, clientId: string): Promise<string | undefined> {
  const clients = await admin.request<Array<{ id: string; clientId: string }>>(
    "GET",
    `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`
  );
  return clients?.find((c) => c.clientId === clientId)?.id;
}

/**
 * Deletes the OIDC client for an archived app (04_IMPLEMENTATION E9-8 "ARCHIVED 時の
 * リソース回収（... / OIDC client / ...）"). Idempotent — looks the client up by its
 * clientId first and returns `false` if it's already gone, rather than relying on
 * DELETE-on-404 semantics that would make a re-run throw.
 */
export async function deleteClient(admin: KeycloakAdminClient, realm: string, clientId: string): Promise<boolean> {
  const uuid = await findClientUuid(admin, realm, clientId);
  if (!uuid) return false;
  await admin.request("DELETE", `/admin/realms/${realm}/clients/${uuid}`);
  return true;
}

/**
 * Deletes a realm role (04_IMPLEMENTATION E9-8). Idempotent — a 404 (already
 * deleted, or a role that was declared in a Spec's `access.roles` but never actually
 * provisioned) is treated as `false`, not an error: the end state the caller wants
 * ("this role doesn't exist") already holds either way.
 */
export async function deleteRealmRole(admin: KeycloakAdminClient, realm: string, roleName: string): Promise<boolean> {
  try {
    await admin.request("DELETE", `/admin/realms/${realm}/roles/${roleName}`);
    return true;
  } catch (error) {
    if (error instanceof KeycloakAdminError && error.status === 404) return false;
    throw error;
  }
}

export interface UserOptions {
  username: string;
  password: string;
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  roles: string[];
}

/**
 * Creates a user with a COMPLETE profile in one shot. Leaving out email/firstName/
 * lastName (all realm-required by default) produces a working-looking 201/204 chain
 * that only fails later, opaquely, as `invalid_grant: "Account is not fully set up"`
 * on first login (confirmed the hard way) — so this function refuses to create a
 * half-filled profile in the first place rather than deferring that failure.
 */
export async function createUser(admin: KeycloakAdminClient, realm: string, opts: UserOptions): Promise<string> {
  const userId = await admin.requestCreated(`/admin/realms/${realm}/users`, {
    username: opts.username,
    enabled: true,
    email: opts.email,
    firstName: opts.firstName,
    lastName: opts.lastName,
    emailVerified: true,
    attributes: { department: [opts.department] },
    credentials: [{ type: "password", value: opts.password, temporary: false }],
  });

  for (const roleName of opts.roles) {
    const role = await admin.request<{ id: string; name: string }>("GET", `/admin/realms/${realm}/roles/${roleName}`);
    await admin.request("POST", `/admin/realms/${realm}/users/${userId}/role-mappings/realm`, [role]);
  }

  return userId;
}
