import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { createVehiclePublicToken, getPublicServiceHistory } from "./vehicle-tokens";

function publicReq(token: string): Request {
  // No cookies, no CSRF — public endpoint
  return new Request(`http://localhost/api/public/service-history/${token}`, { method: "GET" });
}

// Helper: insert a work order for the seeded vehicle's VIN
function insertOrder(opts: { broj: string; vin: string | null; plates: string; km: number | null; opis: string }): number {
  const db = getDB();
  const wo = db.query<{ id: number }, [string, string, string | null, number | null, string]>(
    `INSERT INTO work_orders (broj_naloga, customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila, kilometraza, opis_kvara)
     VALUES (?, (SELECT id FROM customers LIMIT 1), ?, ?, 'VW', 'Golf', ?, ?) RETURNING id`
  ).get(opts.broj, opts.plates, opts.vin, opts.km, opts.opis)!;
  return wo.id;
}

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

test("getPublicServiceHistory: 404 for unknown token", () => {
  const res = getPublicServiceHistory(publicReq("nope"));
  expect(res.status).toBe(404);
});

test("getPublicServiceHistory: groups orders by VIN and omits prices/personal data", async () => {
  const db = getDB();
  // Two orders, same VIN, different plates -> both must appear
  const wo1 = insertOrder({ broj: "2026-0001", vin: "VIN123456789", plates: "A12-B-345", km: 100000, opis: "Servis kočnica" });
  insertOrder({ broj: "2026-0002", vin: "VIN123456789", plates: "NEW-PLATE", km: 110000, opis: "Zamjena ulja" });
  db.query<null, [number, string, string, number, number, number]>(
    `INSERT INTO work_order_items (work_order_id, tip, naziv, kolicina, jedinicna_cijena, ukupna_cijena) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(wo1, "dio", "Pločice", 1, 50, 50);

  // Create the token
  const tokRes = createVehiclePublicToken(req("POST", `/api/vehicles/${vehicleId}/public-token`));
  const { token } = await tokRes.json() as { token: string };

  const res = getPublicServiceHistory(publicReq(token));
  expect(res.status).toBe(200);
  const raw = await res.text();

  // Sanitization: no price or personal-data field names in payload
  for (const forbidden of ["jedinicna_cijena", "ukupna_cijena", "popust", "napomena", "telefon", "email", "broj_naloga", "vin_broj"]) {
    expect(raw).not.toContain(forbidden);
  }

  const body = JSON.parse(raw) as import("../types").PublicServiceHistoryData;
  expect(body.visits.length).toBe(2);
  expect(body.vehicle.marka_vozila).toBe("VW");
  expect(body.visits[0]!.items.length).toBeGreaterThanOrEqual(0);
});

test("getPublicServiceHistory: falls back to plates when vehicle has no VIN", async () => {
  const db = getDB();
  // Add a vehicle without VIN + its order matched by plates
  const veh = db.query<{ id: number }, [string, string, string]>(
    "INSERT INTO vehicles (customer_id, registarske_tablice, marka_vozila, model_vozila) VALUES ((SELECT id FROM customers LIMIT 1), ?, ?, ?) RETURNING id"
  ).get("ZZ-99-ZZ", "Fiat", "Punto")!;
  db.query<null, [string, string]>(
    `INSERT INTO work_orders (broj_naloga, customer_id, registarske_tablice, marka_vozila, model_vozila)
     VALUES (?, (SELECT id FROM customers LIMIT 1), ?, 'Fiat', 'Punto')`
  ).run("2026-0003", "ZZ-99-ZZ");

  const tokRes = createVehiclePublicToken(req("POST", `/api/vehicles/${veh.id}/public-token`));
  const { token } = await tokRes.json() as { token: string };
  const res = getPublicServiceHistory(publicReq(token));
  const body = await res.json() as import("../types").PublicServiceHistoryData;
  expect(body.visits.length).toBe(1);
});
