import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { bulkAddWorkOrderItems } from "./work-orders";

// Force in-memory DB for tests. Must be set before getDB() is called.
process.env.DB_PATH = ":memory:";

let sessionId: string;
let csrfToken: string;
let workOrderId: number;

function makeRequest(orderId: number, body: unknown, opts?: { csrf?: string; session?: string }): Request {
  return new Request(`http://localhost/api/work-orders/${orderId}/items/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `session=${opts?.session ?? sessionId}`,
      "X-CSRF-Token": opts?.csrf ?? csrfToken,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  closeDB();
  const db = getDB();

  // Wipe (in-memory DB is fresh per session, but seed admin runs async — wait briefly)
  db.exec("DELETE FROM work_order_items");
  db.exec("DELETE FROM work_orders");
  db.exec("DELETE FROM customers");
  db.exec("DELETE FROM mechanics");
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM users");

  // Create admin user
  const passwordHash = "fake-hash";
  const userResult = db.query<{ id: number }, [string, string, string]>(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
  ).get("admin", passwordHash, "admin")!;

  // Create session + CSRF
  sessionId = "test-session-id";
  csrfToken = "test-csrf-token";
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(sessionId, userResult.id, expires, csrfToken);

  // Create customer
  const customerResult = db.query<{ id: number }, [string, string]>(
    "INSERT INTO customers (ime, prezime) VALUES (?, ?) RETURNING id"
  ).get("Test", "Customer")!;

  // Create work order
  const orderResult = db.query<{ id: number }, [string, number, string, string, string, string]>(
    `INSERT INTO work_orders (broj_naloga, customer_id, registarske_tablice, marka_vozila, model_vozila, status)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).get("2026-9999", customerResult.id, "T-1", "Audi", "A4", "otvoren")!;
  workOrderId = orderResult.id;
});

test("inserts all items in one transaction and recalculates total", async () => {
  const req = makeRequest(workOrderId, {
    items: [
      { tip: "dio", naziv: "Filter", kolicina: 1, jedinicna_cijena: 10, popust: 0 },
      { tip: "dio", naziv: "Pločice", kolicina: 2, jedinicna_cijena: 50, popust: 10 }, // 50*2=100, -10% = 90
    ],
  });
  const res = await bulkAddWorkOrderItems(req);
  expect(res.status).toBe(200);

  const db = getDB();
  const items = db.query<{ count: number; total: number }, [number]>(
    "SELECT COUNT(*) as count, COALESCE(SUM(ukupna_cijena), 0) as total FROM work_order_items WHERE work_order_id = ?"
  ).get(workOrderId)!;
  expect(items.count).toBe(2);
  expect(items.total).toBe(100);

  const wo = db.query<{ ukupna_cijena: number }, [number]>(
    "SELECT ukupna_cijena FROM work_orders WHERE id = ?"
  ).get(workOrderId)!;
  expect(wo.ukupna_cijena).toBe(100);
});

test("returns 404 when work order does not exist", async () => {
  const req = makeRequest(999_999, { items: [{ tip: "dio", naziv: "X", kolicina: 1, jedinicna_cijena: 5, popust: 0 }] });
  const res = await bulkAddWorkOrderItems(req);
  expect(res.status).toBe(404);
});

test("returns 401 without auth", async () => {
  const req = makeRequest(workOrderId, { items: [] }, { session: "bogus" });
  const res = await bulkAddWorkOrderItems(req);
  expect(res.status).toBe(401);
});

test("returns 403 for missing CSRF", async () => {
  const req = new Request(`http://localhost/api/work-orders/${workOrderId}/items/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `session=${sessionId}`,
    },
    body: JSON.stringify({ items: [] }),
  });
  const res = await bulkAddWorkOrderItems(req);
  expect(res.status).toBe(403);
});

test("returns 400 when items is missing or not array", async () => {
  const res = await bulkAddWorkOrderItems(makeRequest(workOrderId, { items: "x" }));
  expect(res.status).toBe(400);
});

test("returns 400 and inserts nothing when one item is invalid", async () => {
  const db = getDB();
  const before = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM work_order_items WHERE work_order_id = ?"
  ).get(workOrderId)!.count;

  const req = makeRequest(workOrderId, {
    items: [
      { tip: "dio", naziv: "Good", kolicina: 1, jedinicna_cijena: 10, popust: 0 },
      { tip: "dio", naziv: "", kolicina: 1, jedinicna_cijena: 10, popust: 0 }, // bad: empty naziv
    ],
  });
  const res = await bulkAddWorkOrderItems(req);
  expect(res.status).toBe(400);

  const after = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM work_order_items WHERE work_order_id = ?"
  ).get(workOrderId)!.count;
  expect(after).toBe(before); // rolled back
});

test("returns 200 with empty items array (no-op)", async () => {
  const req = makeRequest(workOrderId, { items: [] });
  const res = await bulkAddWorkOrderItems(req);
  expect(res.status).toBe(200);
});

test("forces tip to dio or usluga (rejects other values)", async () => {
  const req = makeRequest(workOrderId, {
    items: [{ tip: "wrong", naziv: "X", kolicina: 1, jedinicna_cijena: 5, popust: 0 }],
  });
  const res = await bulkAddWorkOrderItems(req);
  expect(res.status).toBe(400);
});
