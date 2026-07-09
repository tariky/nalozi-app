import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { getCompanySettings, updateCompanySettings } from "./settings";

process.env.DB_PATH = ":memory:";

let adminSession: string;
let adminCsrf: string;
let mechSession: string;
let mechCsrf: string;

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  opts?: { csrf?: string; session?: string | null }
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts?.session !== null) {
    headers["Cookie"] = `session=${opts?.session ?? adminSession}`;
  }
  if (method !== "GET") {
    headers["X-CSRF-Token"] = opts?.csrf ?? adminCsrf;
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  closeDB();
  const db = getDB();

  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM users");
  db.exec("UPDATE company_settings SET naziv = NULL, telefon = NULL, email = NULL, adresa = NULL, id_broj = NULL, web = NULL, logo = NULL WHERE id = 1");

  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Admin user + session
  const admin = db.query<{ id: number }, [string, string, string]>(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
  ).get("admin", "fake", "admin")!;
  adminSession = "admin-session";
  adminCsrf = "admin-csrf";
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(adminSession, admin.id, expires, adminCsrf);

  // Mechanic user + session
  const mech = db.query<{ id: number }, [string, string, string]>(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
  ).get("mehanicar", "fake", "mechanic")!;
  mechSession = "mech-session";
  mechCsrf = "mech-csrf";
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(mechSession, mech.id, expires, mechCsrf);
});

test("getCompanySettings: returns default row for authenticated user", async () => {
  const res = getCompanySettings(makeRequest("GET", "/api/settings/company"));
  expect(res.status).toBe(200);
  const body = await res.json() as { id: number; naziv: string | null; logo: string | null };
  expect(body.id).toBe(1);
  expect(body.naziv).toBe(null);
  expect(body.logo).toBe(null);
});

test("getCompanySettings: requires authentication", async () => {
  const res = getCompanySettings(makeRequest("GET", "/api/settings/company", undefined, { session: null }));
  expect(res.status).toBe(401);
});

test("updateCompanySettings: admin saves and returns updated values", async () => {
  const res = await updateCompanySettings(makeRequest("PUT", "/api/settings/company", {
    naziv: "Auto Servis d.o.o.",
    telefon: "+387 61 123 456",
    email: "info@autoservis.ba",
    adresa: "Ulica 1, Sarajevo",
    id_broj: "4200000000001",
    web: "https://autoservis.ba",
    logo: "data:image/png;base64,AAAA",
  }));
  expect(res.status).toBe(200);
  const body = await res.json() as { naziv: string; telefon: string; logo: string };
  expect(body.naziv).toBe("Auto Servis d.o.o.");
  expect(body.telefon).toBe("+387 61 123 456");
  expect(body.logo).toBe("data:image/png;base64,AAAA");

  // Persisted: a fresh GET reflects the change
  const getRes = getCompanySettings(makeRequest("GET", "/api/settings/company"));
  const getBody = await getRes.json() as { naziv: string; email: string };
  expect(getBody.naziv).toBe("Auto Servis d.o.o.");
  expect(getBody.email).toBe("info@autoservis.ba");
});

test("updateCompanySettings: clears logo when null is sent", async () => {
  await updateCompanySettings(makeRequest("PUT", "/api/settings/company", {
    naziv: "X",
    logo: "data:image/png;base64,AAAA",
  }));
  const res = await updateCompanySettings(makeRequest("PUT", "/api/settings/company", {
    naziv: "X",
    logo: null,
  }));
  expect(res.status).toBe(200);
  const body = await res.json() as { logo: string | null };
  expect(body.logo).toBe(null);
});

test("updateCompanySettings: rejects non-admin with 403", async () => {
  const res = await updateCompanySettings(makeRequest("PUT", "/api/settings/company", {
    naziv: "Haker",
  }, { session: mechSession, csrf: mechCsrf }));
  expect(res.status).toBe(403);
});

test("updateCompanySettings: rejects invalid CSRF token", async () => {
  const res = await updateCompanySettings(makeRequest("PUT", "/api/settings/company", {
    naziv: "X",
  }, { csrf: "wrong-token" }));
  expect(res.status).toBe(403);
});

test("updateCompanySettings: rejects oversized logo with 400", async () => {
  const hugeLogo = "data:image/png;base64," + "A".repeat(250 * 1024);
  const res = await updateCompanySettings(makeRequest("PUT", "/api/settings/company", {
    naziv: "X",
    logo: hugeLogo,
  }));
  expect(res.status).toBe(400);
});

test("updateCompanySettings: rejects non-image logo data-URI with 400", async () => {
  const res = await updateCompanySettings(makeRequest("PUT", "/api/settings/company", {
    logo: "data:text/html;base64,AAAA",
  }));
  expect(res.status).toBe(400);
});
