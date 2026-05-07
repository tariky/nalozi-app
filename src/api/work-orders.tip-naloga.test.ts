import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { createWorkOrder, updateWorkOrder, getWorkOrders, searchWorkOrders } from "./work-orders";

process.env.DB_PATH = ":memory:";

let sessionId: string;
let csrfToken: string;
let customerId: number;

function makeRequest(method: string, path: string, body?: unknown, opts?: { csrf?: string; session?: string }): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cookie": `session=${opts?.session ?? sessionId}`,
  };
  if (method !== "GET") {
    headers["X-CSRF-Token"] = opts?.csrf ?? csrfToken;
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

  db.exec("DELETE FROM work_order_items");
  db.exec("DELETE FROM work_orders");
  db.exec("DELETE FROM customers");
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM users");

  // Admin user
  const userResult = db.query<{ id: number }, [string, string, string]>(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
  ).get("admin", "fake", "admin")!;

  // Session
  sessionId = "test-session";
  csrfToken = "test-csrf";
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(sessionId, userResult.id, expires, csrfToken);

  // Customer
  const customerResult = db.query<{ id: number }, [string, string]>(
    "INSERT INTO customers (ime, prezime) VALUES (?, ?) RETURNING id"
  ).get("Test", "Customer")!;
  customerId = customerResult.id;
});

test("createWorkOrder: auto requires car fields", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    tip_naloga: "auto",
    customer_id: customerId,
    marka_vozila: "Audi",
    model_vozila: "A4",
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(400);
});

test("createWorkOrder: complete auto returns 201 and stores correctly", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    tip_naloga: "auto",
    customer_id: customerId,
    registarske_tablice: "ABC-123",
    marka_vozila: "Audi",
    model_vozila: "A4",
    motor: "2.0 TDI",
    kilometraza: 100000,
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(201);
  const body = await res.json() as { tip_naloga: string; marka_vozila: string; tip_agregata: string | null };
  expect(body.tip_naloga).toBe("auto");
  expect(body.marka_vozila).toBe("Audi");
  expect(body.tip_agregata).toBe(null);
});

test("createWorkOrder: agregat requires tip_agregata + marka_agregata", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    tip_naloga: "agregat",
    customer_id: customerId,
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(400);
});

test("createWorkOrder: complete agregat returns 201 with empty car fields", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    tip_naloga: "agregat",
    customer_id: customerId,
    tip_agregata: "alnaser",
    marka_agregata: "Bosch",
    serijski_broj: "SN12345",
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(201);
  const body = await res.json() as { tip_naloga: string; marka_vozila: string; registarske_tablice: string; tip_agregata: string; marka_agregata: string; serijski_broj: string };
  expect(body.tip_naloga).toBe("agregat");
  expect(body.marka_vozila).toBe("");
  expect(body.registarske_tablice).toBe("");
  expect(body.tip_agregata).toBe("alnaser");
  expect(body.marka_agregata).toBe("Bosch");
  expect(body.serijski_broj).toBe("SN12345");
});

test("createWorkOrder: agregat ignores any car fields client sends", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    tip_naloga: "agregat",
    customer_id: customerId,
    tip_agregata: "alternator",
    marka_agregata: "Valeo",
    marka_vozila: "Ford",
    registarske_tablice: "XYZ-999",
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(201);
  const body = await res.json() as { marka_vozila: string; registarske_tablice: string };
  expect(body.marka_vozila).toBe("");
  expect(body.registarske_tablice).toBe("");
});

test("createWorkOrder: rejects invalid tip_agregata", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    tip_naloga: "agregat",
    customer_id: customerId,
    tip_agregata: "rocketship",
    marka_agregata: "X",
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(400);
});

test("createWorkOrder: rejects invalid tip_naloga", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    tip_naloga: "ufo",
    customer_id: customerId,
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(400);
});

test("createWorkOrder: defaults missing tip_naloga to auto", async () => {
  const req = makeRequest("POST", "/api/work-orders", {
    customer_id: customerId,
    registarske_tablice: "BC-12",
    marka_vozila: "BMW",
    model_vozila: "X5",
  });
  const res = await createWorkOrder(req);
  expect(res.status).toBe(201);
  const body = await res.json() as { tip_naloga: string };
  expect(body.tip_naloga).toBe("auto");
});

test("updateWorkOrder: cannot change tip_naloga", async () => {
  const createRes = await createWorkOrder(makeRequest("POST", "/api/work-orders", {
    tip_naloga: "auto",
    customer_id: customerId,
    registarske_tablice: "AB-1",
    marka_vozila: "M",
    model_vozila: "X",
  }));
  const created = await createRes.json() as { id: number };

  const updateRes = await updateWorkOrder(makeRequest("PUT", `/api/work-orders/${created.id}`, {
    tip_naloga: "agregat",
  }));
  expect(updateRes.status).toBe(400);
});

test("updateWorkOrder: agregat fields update on agregat order", async () => {
  const createRes = await createWorkOrder(makeRequest("POST", "/api/work-orders", {
    tip_naloga: "agregat",
    customer_id: customerId,
    tip_agregata: "alnaser",
    marka_agregata: "Bosch",
  }));
  const created = await createRes.json() as { id: number };

  const updateRes = await updateWorkOrder(makeRequest("PUT", `/api/work-orders/${created.id}`, {
    marka_agregata: "Valeo",
    serijski_broj: "NEW-SN",
  }));
  expect(updateRes.status).toBe(200);
  const body = await updateRes.json() as { marka_agregata: string; serijski_broj: string };
  expect(body.marka_agregata).toBe("Valeo");
  expect(body.serijski_broj).toBe("NEW-SN");
});

test("getWorkOrders: filters by tip_naloga", async () => {
  await createWorkOrder(makeRequest("POST", "/api/work-orders", {
    tip_naloga: "auto",
    customer_id: customerId,
    registarske_tablice: "AB-1",
    marka_vozila: "M",
    model_vozila: "X",
  }));
  await createWorkOrder(makeRequest("POST", "/api/work-orders", {
    tip_naloga: "agregat",
    customer_id: customerId,
    tip_agregata: "alnaser",
    marka_agregata: "Bosch",
  }));

  const res = await getWorkOrders(makeRequest("GET", "/api/work-orders?tip_naloga=agregat"));
  expect(res.status).toBe(200);
  const body = await res.json() as { items: Array<{ tip_naloga: string }>; total: number };
  expect(body.total).toBe(1);
  expect(body.items[0]!.tip_naloga).toBe("agregat");
});

test("searchWorkOrders: matches agregat by serijski_broj", async () => {
  await createWorkOrder(makeRequest("POST", "/api/work-orders", {
    tip_naloga: "agregat",
    customer_id: customerId,
    tip_agregata: "alternator",
    marka_agregata: "Bosch",
    serijski_broj: "UNIQUE-SN-987",
  }));

  const res = await searchWorkOrders(makeRequest("GET", "/api/work-orders/search?q=UNIQUE-SN"));
  expect(res.status).toBe(200);
  const items = await res.json() as Array<{ tip_naloga: string; serijski_broj: string }>;
  expect(items.length).toBe(1);
  expect(items[0]!.tip_naloga).toBe("agregat");
});
