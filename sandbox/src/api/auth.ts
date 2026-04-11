// APIInterceptScorer target: cy.intercept('/api/auth') matches this file
// (route segment "auth" matches file path ending with "auth")

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  token: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

// ─── In-memory mock — no backend required ────────────────────────────────────

const MOCK_USER: AuthUser = {
  id: "user-1",
  email: "demo@pelican.dev",
  name: "Demo User",
  token: "mock-jwt-token-abc123",
};

const delay = (ms = 400) => new Promise<void>((r) => setTimeout(r, ms));

export async function loginApi(payload: LoginPayload): Promise<AuthUser> {
  console.log("loginApi", payload);
  await delay();
  if (!payload.email || !payload.password) throw new Error("Login failed");
  return { ...MOCK_USER, email: payload.email };
}

export async function logoutApi(): Promise<void> {
  await delay(200);
}

export async function registerApi(payload: RegisterPayload): Promise<AuthUser> {
  await delay();
  return { ...MOCK_USER, email: payload.email, name: payload.name };
}

export async function refreshTokenApi(): Promise<{ token: string }> {
  await delay(200);
  return { token: "refreshed-mock-token-xyz789" };
}
