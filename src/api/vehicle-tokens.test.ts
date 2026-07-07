import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { createVehiclePublicToken } from "./vehicle-tokens";

process.env.DB_PATH = ":memory:";

let adminSession: string;
let adminCsrf: string;
let vehicleId: number;

function req(method: string, path: string, opts?: { session?: string | null }): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.session !== null) headers["Cookie"] = `session=${opts?.session ?? adminSession}`;
  if (method !== "GET") headers["X-CSRF-Token"] = adminCsrf;
  return new Request(`http://localhost${path}`, { method, headers });
}

beforeEach(() => {
  closeDB();
  const db = getDB();
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM users");
  db.exec("DELETE FROM vehicle_public_tokens");
  db.exec("DELETE FROM work_orders");
  db.exec("DELETE FROM vehicles");
  db.exec("DELETE FROM customers");
  db.exec("DELETE FROM mechanics");

  const expires = new Date(Date.now() + 86400000).toISOString();
  const admin = db.query<{ id: number }, [string, string, string]>(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
  ).get("admin", "fake", "admin")!;
  adminSession = "admin-session";
  adminCsrf = "admin-csrf";
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(adminSession, admin.id, expires, adminCsrf);

  const cust = db.query<{ id: number }, [string, string]>(
    "INSERT INTO customers (ime, prezime) VALUES (?, ?) RETURNING id"
  ).get("Pero", "Perić")!;
  const veh = db.query<{ id: number }, [number, string, string, string, string]>(
    "INSERT INTO vehicles (customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila) VALUES (?, ?, ?, ?, ?) RETURNING id"
  ).get(cust.id, "A12-B-345", "VIN123456789", "VW", "Golf")!;
  vehicleId = veh.id;
});

test("schema: vehicle_public_tokens table exists", () => {
  const db = getDB();
  const cols = db.query<{ name: string }, []>(
    "PRAGMA table_info(vehicle_public_tokens)"
  ).all();
  const names = cols.map((c) => c.name).sort();
  expect(names).toEqual(["created_at", "token", "vehicle_id"]);
});

test("createVehiclePublicToken: requires authentication", () => {
  const res = createVehiclePublicToken(req("POST", `/api/vehicles/${vehicleId}/public-token`, { session: null }));
  expect(res.status).toBe(401);
});

test("createVehiclePublicToken: returns 404 for missing vehicle", () => {
  const res = createVehiclePublicToken(req("POST", `/api/vehicles/99999/public-token`));
  expect(res.status).toBe(404);
});

test("createVehiclePublicToken: is idempotent — same token on repeat", async () => {
  const res1 = createVehiclePublicToken(req("POST", `/api/vehicles/${vehicleId}/public-token`));
  expect(res1.status).toBe(200);
  const body1 = await res1.json() as { token: string };
  expect(body1.token.length).toBeGreaterThanOrEqual(12);

  const res2 = createVehiclePublicToken(req("POST", `/api/vehicles/${vehicleId}/public-token`));
  const body2 = await res2.json() as { token: string };
  expect(body2.token).toBe(body1.token);
});
