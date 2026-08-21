export interface KeycloakAdminOptions {
  /** e.g. "http://localhost:8180" — no trailing slash. */
  baseUrl: string;
  adminUsername: string;
  adminPassword: string;
}

export class KeycloakAdminError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "KeycloakAdminError";
  }
}

/**
 * A thin wrapper over Keycloak's Admin REST API — just enough to provision what
 * ADR-006 needs (realm, confidential client with PKCE, realm roles, users carrying a
 * `department` attribute), not a general-purpose Keycloak SDK. One admin token is
 * fetched at construction and reused for the lifetime of this client; provisioning
 * runs (dev script, integration test setup) are short enough that token refresh isn't
 * needed — this is NOT meant to be held open for a long-running process.
 */
export class KeycloakAdminClient {
  private constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  static async authenticate(opts: KeycloakAdminOptions): Promise<KeycloakAdminClient> {
    const res = await fetch(`${opts.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        username: opts.adminUsername,
        password: opts.adminPassword,
        grant_type: "password",
      }),
    });
    if (!res.ok) {
      throw new KeycloakAdminError(`admin authentication failed: ${await res.text()}`, res.status);
    }
    const body = (await res.json()) as { access_token: string };
    return new KeycloakAdminClient(opts.baseUrl, body.access_token);
  }

  /** Low-level request helper. Every provisioning method below is built on this. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      throw new KeycloakAdminError(`${method} ${path} -> ${res.status}: ${await res.text()}`, res.status);
    }
    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : undefined;
  }

  /** Returns the id from a Keycloak `Location` response header (`.../{id}`) — the standard way Admin API POSTs report what they created. */
  async requestCreated(path: string, body: unknown): Promise<string> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new KeycloakAdminError(`POST ${path} -> ${res.status}: ${await res.text()}`, res.status);
    }
    const location = res.headers.get("location");
    if (!location) throw new KeycloakAdminError(`POST ${path} succeeded but returned no Location header`, res.status);
    return location.slice(location.lastIndexOf("/") + 1);
  }
}
