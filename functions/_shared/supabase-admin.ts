export interface SupabaseAdminEnv { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE?: string; }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function supaFetch(env: SupabaseAdminEnv) {
  const base = env.SUPABASE_URL?.replace(/\/$/, "") || "";
  const key = env.SUPABASE_SERVICE_ROLE || "";
  if (!base || !key) throw new Error("Supabase env vars missing on server");
  return {
    async select(table: string, query: string): Promise<unknown[]> {
      const r = await fetch(`${base}/rest/v1/${table}?${query}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`Supabase select ${table} ${r.status}: ${await r.text()}`);
      return r.json();
    },
    async insert(table: string, row: Record<string, unknown>, returning = "representation"): Promise<unknown[]> {
      const r = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: `return=${returning}` },
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`Supabase insert ${table} ${r.status}: ${await r.text()}`);
      // `Prefer: return=minimal` is deliberately used for idempotency claims;
      // PostgREST answers that successful insert with an empty body.
      const text = await r.text();
      return text.trim() ? JSON.parse(text) as unknown[] : [];
    },
    async update(table: string, query: string, row: Record<string, unknown>): Promise<unknown[]> {
      const r = await fetch(`${base}/rest/v1/${table}?${query}`, {
        method: "PATCH",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`Supabase update ${table} ${r.status}: ${await r.text()}`);
      return r.json();
    },
  };
}

export async function verifySupabaseJwt(env: SupabaseAdminEnv, token: string): Promise<{ id: string; email?: string } | null> {
  if (!token) return null;
  const base = env.SUPABASE_URL?.replace(/\/$/, "") || "";
  if (!base) return null;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE || "", Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = (await r.json()) as { id?: string; email?: string };
  if (!u.id || !UUID_PATTERN.test(u.id)) return null;
  return { id: u.id, email: u.email };
}

export function bearerFromRequest(req: Request): string {
  const h = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}
