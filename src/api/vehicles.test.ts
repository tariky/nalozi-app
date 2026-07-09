import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { updateVehicle } from "./vehicles";
import type { Vehicle } from "../types";

process.env.DB_PATH = ":memory:";

let adminSession: string;
let adminCsrf: string;
let vehicleId: number;
let ownerId: number;
let otherCustomerId: number;

function req(method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: `session=${adminSession}`,
  };
  if (method !== "GET") headers["X-CSRF-Token"] = adminCsrf;
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
  db.exec("DELETE FROM vehicles");
  db.exec("DELETE FROM customers");

  const expires = new Date(Date.now() + 86400000).toISOString();
  const admin = db.query<{ id: number }, [string, string, string]>(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
  ).get("admin", "fake", "admin")!;
  adminSession = "admin-session";
  adminCsrf = "admin-csrf";
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(adminSession, admin.id, expires, adminCsrf);

  const owner = db.query<{ id: number }, [string, string]>(
    "INSERT INTO customers (ime, prezime) VALUES (?, ?) RETURNING id"
  ).get("Pero", "Perić")!;
  ownerId = owner.id;

  const other = db.query<{ id: number }, [string, string]>(
    "INSERT INTO customers (ime, prezime) VALUES (?, ?) RETURNING id"
  ).get("Ana", "Anić")!;
  otherCustomerId = other.id;

  const veh = db.query<{ id: number }, [number, string, string, string, string]>(
    "INSERT INTO vehicles (customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila) VALUES (?, ?, ?, ?, ?) RETURNING id"
  ).get(ownerId, "A12-B-345", "VIN123456789", "VW", "Golf")!;
  vehicleId = veh.id;
});

test("updateVehicle: moves the vehicle to the given customer_id", async () => {
  const res = await updateVehicle(req("PUT", `/api/vehicles/${vehicleId}`, { customer_id: otherCustomerId }));
  expect(res.status).toBe(200);
  const body = await res.json() as Vehicle;
  expect(body.customer_id).toBe(otherCustomerId);

  const db = getDB();
  const row = db.query<Vehicle, [number]>("SELECT * FROM vehicles WHERE id = ?").get(vehicleId)!;
  expect(row.customer_id).toBe(otherCustomerId);
});

test("updateVehicle: 404 and unchanged row when customer_id does not exist", async () => {
  const res = await updateVehicle(req("PUT", `/api/vehicles/${vehicleId}`, { customer_id: 99999 }));
  expect(res.status).toBe(404);
  const body = await res.json() as { message: string };
  expect(body.message).toBe("Klijent nije pronađen");

  const db = getDB();
  const row = db.query<Vehicle, [number]>("SELECT * FROM vehicles WHERE id = ?").get(vehicleId)!;
  expect(row.customer_id).toBe(ownerId);
});

test("updateVehicle: 404 and unchanged row when customer_id is 0", async () => {
  const res = await updateVehicle(req("PUT", `/api/vehicles/${vehicleId}`, { customer_id: 0 }));
  expect(res.status).toBe(404);
  const body = await res.json() as { message: string };
  expect(body.message).toBe("Klijent nije pronađen");

  const db = getDB();
  const row = db.query<Vehicle, [number]>("SELECT * FROM vehicles WHERE id = ?").get(vehicleId)!;
  expect(row.customer_id).toBe(ownerId);
});

test("updateVehicle: omitting customer_id leaves the owner unchanged", async () => {
  const res = await updateVehicle(req("PUT", `/api/vehicles/${vehicleId}`, { motor: "1.9 TDI" }));
  expect(res.status).toBe(200);
  const body = await res.json() as Vehicle;
  expect(body.customer_id).toBe(ownerId);
  expect(body.motor).toBe("1.9 TDI");
});
