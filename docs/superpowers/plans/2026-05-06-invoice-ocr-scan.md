# Invoice OCR Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Skeniraj račun" (scan invoice) button to `WorkOrderItems` that lets the user capture or upload a parts-invoice image, OCR it via the OpenRouter `qwen/qwen3.5-flash-02-23` vision model, review/edit parsed items in an editable dialog, and bulk-insert them into the work order in a single SQLite transaction.

**Architecture:** Stateless server endpoint posts the image (base64) to OpenRouter and returns parsed items as JSON. A separate bulk-insert endpoint atomically inserts the reviewed items and recalculates the work-order total. The dialog component owns capture, review, and submission.

**Tech Stack:** Bun + bun:sqlite + React 19 + Tailwind + shadcn (existing). New dependency: none — uses native `fetch`, `FormData`, `AbortController`.

**Spec:** `docs/superpowers/specs/2026-05-06-invoice-ocr-scan-design.md`

---

## File map

**New files:**
- `src/api/invoice-scan.ts` — OCR endpoint + prompt builder + JSON validator
- `src/api/invoice-scan.test.ts` — unit tests for the validator and prompt builder
- `src/api/work-orders.bulk.test.ts` — unit tests for the bulk-add handler
- `src/components/work-orders/InvoiceScanDialog.tsx` — capture/review dialog

**Modified files:**
- `src/db/index.ts` — add `DB_PATH` env override for testability (`:memory:` in tests)
- `src/types/index.ts` — add `ParsedInvoiceItem`, `ScanInvoiceResponse`, `BulkItemsRequest` types
- `src/api/work-orders.ts` — add `bulkAddWorkOrderItems` handler
- `src/index.ts` — register `/api/work-orders/scan-invoice` and `/api/work-orders/:id/items/bulk` routes
- `src/lib/api.ts` — add `invoiceScanApi.scan(file)` and `workOrderItemsApi.addBulk(...)`
- `src/components/work-orders/WorkOrderItems.tsx` — add the `[📷 Skeniraj račun]` button + render `InvoiceScanDialog`

---

## Task 1: Make DB path overridable for tests

**Files:**
- Modify: `src/db/index.ts:8-28`

The bulk-add tests need an in-memory SQLite. Add a `DB_PATH` env override.

- [ ] **Step 1: Modify `getDB()` to honor `DB_PATH`**

Replace the body of `getDB` (lines 8-28) with:

```ts
export function getDB(): Database {
  if (!db) {
    const dbPath = process.env.DB_PATH ?? "data/asnord.db";

    // Ensure data directory exists for file-backed databases
    if (dbPath !== ":memory:") {
      try {
        mkdirSync("data", { recursive: true });
      } catch {}
    }

    db = new Database(dbPath, { create: true });
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(createTablesSQL);

    // Run migrations for existing databases
    runMigrations(db);

    // Seed admin user (async, but we don't wait for it)
    if (!adminSeeded) {
      seedAdminUser(db);
      adminSeeded = true;
    }
  }
  return db;
}
```

- [ ] **Step 2: Sanity-run dev server**

Run: `bun --hot src/index.ts &` then `curl -s http://localhost:3000/api/auth/me` and stop the server with `kill %1`.
Expected: server starts, `/api/auth/me` responds with `{"message":"Niste prijavljeni"}` (401). DB still works against `data/asnord.db` (default).

- [ ] **Step 3: Commit**

```bash
git add src/db/index.ts
git commit -m "Allow overriding SQLite path via DB_PATH for tests"
```

---

## Task 2: Add new TypeScript types

**Files:**
- Modify: `src/types/index.ts:189-191` (end of file)

- [ ] **Step 1: Append types to the end of `src/types/index.ts`**

```ts
// Invoice OCR types
export interface ParsedInvoiceItem {
  naziv: string;
  kolicina: number;
  jedinicna_cijena: number;
  popust: number;
}

export interface ScanInvoiceResponse {
  items: ParsedInvoiceItem[];
  warnings: string[];
}

export interface BulkItemsRequest {
  items: WorkOrderItemForm[];
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add types for invoice OCR scan and bulk item insert"
```

---

## Task 3: Add the OCR JSON validator (TDD)

**Files:**
- Create: `src/api/invoice-scan.ts`
- Create: `src/api/invoice-scan.test.ts`

The validator is a pure function that takes the raw string returned by the model and returns `ParsedInvoiceItem[]` plus warnings, or throws on malformed input. We TDD this in isolation before touching `fetch`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/invoice-scan.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parseModelResponse } from "./invoice-scan";

test("parses clean JSON object response", () => {
  const raw = JSON.stringify({
    items: [
      { naziv: "Filter ulja", kolicina: 1, jedinicna_cijena: 12.5, popust: 0 },
      { naziv: "Pločice", kolicina: 2, jedinicna_cijena: 45, popust: 10 },
    ],
    warnings: [],
  });
  const result = parseModelResponse(raw);
  expect(result.items.length).toBe(2);
  expect(result.items[0]!.naziv).toBe("Filter ulja");
  expect(result.items[1]!.popust).toBe(10);
  expect(result.warnings).toEqual([]);
});

test("strips markdown json fences", () => {
  const raw = '```json\n{"items":[{"naziv":"X","kolicina":1,"jedinicna_cijena":5,"popust":0}],"warnings":[]}\n```';
  const result = parseModelResponse(raw);
  expect(result.items.length).toBe(1);
});

test("strips plain markdown fences", () => {
  const raw = '```\n{"items":[],"warnings":["nothing found"]}\n```';
  const result = parseModelResponse(raw);
  expect(result.items.length).toBe(0);
  expect(result.warnings).toEqual(["nothing found"]);
});

test("defaults missing kolicina to 1 and missing popust to 0", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", jedinicna_cijena: 5 }],
    warnings: [],
  });
  const result = parseModelResponse(raw);
  expect(result.items[0]!.kolicina).toBe(1);
  expect(result.items[0]!.popust).toBe(0);
});

test("rejects items missing naziv", () => {
  const raw = JSON.stringify({
    items: [{ kolicina: 1, jedinicna_cijena: 5, popust: 0 }],
    warnings: [],
  });
  expect(() => parseModelResponse(raw)).toThrow(/naziv/);
});

test("rejects items with negative price", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", kolicina: 1, jedinicna_cijena: -5, popust: 0 }],
    warnings: [],
  });
  expect(() => parseModelResponse(raw)).toThrow(/jedinicna_cijena/);
});

test("rejects items with non-numeric kolicina", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", kolicina: "two", jedinicna_cijena: 5, popust: 0 }],
    warnings: [],
  });
  expect(() => parseModelResponse(raw)).toThrow(/kolicina/);
});

test("rejects when items is missing", () => {
  expect(() => parseModelResponse('{"warnings":[]}')).toThrow(/items/);
});

test("rejects when items is not an array", () => {
  expect(() => parseModelResponse('{"items":"x","warnings":[]}')).toThrow(/items/);
});

test("rejects malformed JSON", () => {
  expect(() => parseModelResponse("not json at all")).toThrow();
});

test("clamps popust to [0, 100]", () => {
  const raw = JSON.stringify({
    items: [
      { naziv: "A", kolicina: 1, jedinicna_cijena: 5, popust: 150 },
      { naziv: "B", kolicina: 1, jedinicna_cijena: 5, popust: -5 },
    ],
    warnings: [],
  });
  const result = parseModelResponse(raw);
  expect(result.items[0]!.popust).toBe(100);
  expect(result.items[1]!.popust).toBe(0);
});

test("missing warnings field defaults to empty array", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", kolicina: 1, jedinicna_cijena: 5, popust: 0 }],
  });
  const result = parseModelResponse(raw);
  expect(result.warnings).toEqual([]);
});
```

- [ ] **Step 2: Create stub `src/api/invoice-scan.ts` and run tests to verify they fail**

```ts
import type { ScanInvoiceResponse } from "../types";

export function parseModelResponse(_raw: string): ScanInvoiceResponse {
  throw new Error("not implemented");
}
```

Run: `bun test src/api/invoice-scan.test.ts`
Expected: all 11 tests fail with "not implemented" or schema mismatches.

- [ ] **Step 3: Implement `parseModelResponse`**

Replace `src/api/invoice-scan.ts` contents with:

```ts
import type { ScanInvoiceResponse, ParsedInvoiceItem } from "../types";

// Strip markdown code fences (```json ... ``` or ``` ... ```) if the model wrapped output.
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

export function parseModelResponse(raw: string): ScanInvoiceResponse {
  const cleaned = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Invalid JSON from model: ${(e as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model response is not an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.items)) {
    throw new Error("Field 'items' is missing or not an array");
  }

  const items: ParsedInvoiceItem[] = obj.items.map((rawItem, idx) => {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error(`Item ${idx}: not an object`);
    }
    const it = rawItem as Record<string, unknown>;

    if (typeof it.naziv !== "string" || it.naziv.trim() === "") {
      throw new Error(`Item ${idx}: 'naziv' must be a non-empty string`);
    }

    const kolicinaRaw = it.kolicina ?? 1;
    if (typeof kolicinaRaw !== "number" || !isFinite(kolicinaRaw) || kolicinaRaw <= 0) {
      throw new Error(`Item ${idx}: 'kolicina' must be a positive number`);
    }

    if (typeof it.jedinicna_cijena !== "number" || !isFinite(it.jedinicna_cijena) || it.jedinicna_cijena < 0) {
      throw new Error(`Item ${idx}: 'jedinicna_cijena' must be a non-negative number`);
    }

    const popustRaw = it.popust ?? 0;
    if (typeof popustRaw !== "number" || !isFinite(popustRaw)) {
      throw new Error(`Item ${idx}: 'popust' must be a number`);
    }
    const popust = Math.max(0, Math.min(100, popustRaw));

    return {
      naziv: it.naziv.trim(),
      kolicina: kolicinaRaw,
      jedinicna_cijena: it.jedinicna_cijena,
      popust,
    };
  });

  const warnings: string[] = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];

  return { items, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/invoice-scan.test.ts`
Expected: 11 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/api/invoice-scan.ts src/api/invoice-scan.test.ts
git commit -m "Add OCR response validator with tests"
```

---

## Task 4: Add the OCR endpoint (prompt + OpenRouter call)

**Files:**
- Modify: `src/api/invoice-scan.ts` (add handler + prompt builder)
- Modify: `src/api/invoice-scan.test.ts` (add prompt-builder test)

The fetch call itself is integration-tested manually (Task 10). We unit-test the prompt builder so the message structure is locked in.

- [ ] **Step 1: Append prompt-builder test to `src/api/invoice-scan.test.ts`**

```ts
import { buildOcrMessages } from "./invoice-scan";

test("buildOcrMessages produces correct shape with image", () => {
  const messages = buildOcrMessages("data:image/jpeg;base64,XXX");
  expect(messages.length).toBe(2);
  expect(messages[0]!.role).toBe("system");
  expect(messages[1]!.role).toBe("user");
  expect(Array.isArray(messages[1]!.content)).toBe(true);
  const userContent = messages[1]!.content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
  expect(userContent.some(c => c.type === "text")).toBe(true);
  expect(userContent.some(c => c.type === "image_url" && c.image_url?.url === "data:image/jpeg;base64,XXX")).toBe(true);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `bun test src/api/invoice-scan.test.ts -t "buildOcrMessages"`
Expected: fails with "buildOcrMessages is not a function" or import error.

- [ ] **Step 3: Implement `buildOcrMessages` and `scanInvoice` handler**

Append to `src/api/invoice-scan.ts`:

```ts
import { requireAuth, validateCsrf } from "./auth";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3.5-flash-02-23";
const TIMEOUT_MS = 45_000;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

const INSTRUCTIONS = [
  "Extract every line item from this car parts supplier invoice.",
  "",
  "Rules:",
  "1. Skip non-item rows: header rows, addresses, dates, freight/shipping, totals, tax summary, subtotals, terms.",
  "2. For 'jedinicna_cijena', use the price WITH VAT (Cijena sa PDV-om). If only one price column exists, use it.",
  "3. Output STRICT JSON with this exact shape and no extra fields, no markdown, no prose:",
  '   {"items":[{"naziv":string,"kolicina":number,"jedinicna_cijena":number,"popust":number}],"warnings":string[]}',
  "4. Use dot decimals (e.g. 12.50), never commas. Numbers must be JSON numbers, not strings.",
  "5. If quantity is missing, use 1. If discount is missing, use 0.",
  "6. Append a short note to 'warnings' for any row you skipped because data was unclear.",
].join("\n");

interface OcrMessage {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export function buildOcrMessages(dataUrl: string): OcrMessage[] {
  return [
    {
      role: "system",
      content: "You are an OCR parser for car parts supplier invoices in Bosnian/Croatian. Extract each line item. Return strict JSON only.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: INSTRUCTIONS },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];
}

export async function scanInvoice(req: Request): Promise<Response> {
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ message: "Servis nije konfigurisan" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ message: "Slika nije validna" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ message: "Slika nije validna" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ message: "Slika nije validna" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ message: "Slika je prevelika (max 8MB)" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${file.type};base64,${base64}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let openrouterRes: Response;
  try {
    openrouterRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildOcrMessages(dataUrl),
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      return Response.json({ message: "Vrijeme za obradu isteklo" }, { status: 504 });
    }
    return Response.json({ message: "OpenRouter nedostupan" }, { status: 502 });
  }
  clearTimeout(timer);

  if (!openrouterRes.ok) {
    const text = await openrouterRes.text().catch(() => "");
    console.error(`OpenRouter HTTP ${openrouterRes.status}:`, text.slice(0, 500));
    return Response.json({ message: "OpenRouter greška" }, { status: 502 });
  }

  const json = await openrouterRes.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    return Response.json({ message: "Model nije vratio sadržaj" }, { status: 422 });
  }

  try {
    const parsed = parseModelResponse(content);
    return Response.json(parsed);
  } catch (err) {
    console.error("OCR parse error:", (err as Error).message, "raw:", content.slice(0, 500));
    return Response.json(
      { message: "Model nije vratio ispravan format. Pokušajte sa jasnijom slikom." },
      { status: 422 }
    );
  }
}
```

- [ ] **Step 4: Run all invoice-scan tests**

Run: `bun test src/api/invoice-scan.test.ts`
Expected: 12 pass.

- [ ] **Step 5: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/api/invoice-scan.ts src/api/invoice-scan.test.ts
git commit -m "Add scanInvoice endpoint that calls OpenRouter qwen vision"
```

---

## Task 5: Add the bulk-add work-order-items handler (TDD)

**Files:**
- Modify: `src/api/work-orders.ts` (append `bulkAddWorkOrderItems`)
- Create: `src/api/work-orders.bulk.test.ts`

We test the DB transaction and authorization without going through HTTP — call the handler directly with a hand-built `Request`.

- [ ] **Step 1: Write the failing tests**

Create `src/api/work-orders.bulk.test.ts`:

```ts
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
```

- [ ] **Step 2: Add stub `bulkAddWorkOrderItems` and run tests to verify they fail**

Append to the end of `src/api/work-orders.ts`:

```ts
// POST /api/work-orders/:id/items/bulk - Bulk add items in one transaction
export async function bulkAddWorkOrderItems(req: Request): Promise<Response> {
  return Response.json({ message: "not implemented" }, { status: 500 });
}
```

Run: `bun test src/api/work-orders.bulk.test.ts`
Expected: tests fail (most return 500).

- [ ] **Step 3: Implement `bulkAddWorkOrderItems`**

Replace the stub at the bottom of `src/api/work-orders.ts` with:

```ts
// POST /api/work-orders/:id/items/bulk - Bulk add items in one transaction
export async function bulkAddWorkOrderItems(req: Request): Promise<Response> {
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  // path: /api/work-orders/:id/items/bulk → :id is at index pathParts.length - 3
  const workOrderId = parseInt(pathParts[pathParts.length - 3] || "0");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ message: "Nevalidan JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) {
    return Response.json({ message: "Polje 'items' je obavezno" }, { status: 400 });
  }

  const items = (body as { items: unknown[] }).items;
  const db = getDB();

  // Check work order exists + authorization
  const workOrder = db.query<WorkOrder, [number]>(
    "SELECT * FROM work_orders WHERE id = ?"
  ).get(workOrderId);

  if (!workOrder) {
    return Response.json({ message: "Radni nalog nije pronađen" }, { status: 404 });
  }

  if (authResult.role === "mechanic" && authResult.mechanic_id) {
    if (workOrder.mechanic_id !== authResult.mechanic_id) {
      return Response.json({ message: "Nemate pristup ovom radnom nalogu" }, { status: 403 });
    }
  }

  // Validate every item BEFORE the transaction
  const validated: Array<{ tip: "dio" | "usluga"; naziv: string; kolicina: number; jedinicna_cijena: number; popust: number; ukupna_cijena: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (!raw || typeof raw !== "object") {
      return Response.json({ message: `Stavka ${i + 1}: nevalidan format` }, { status: 400 });
    }
    const it = raw as Record<string, unknown>;

    if (it.tip !== "dio" && it.tip !== "usluga") {
      return Response.json({ message: `Stavka ${i + 1}: tip mora biti 'dio' ili 'usluga'` }, { status: 400 });
    }
    if (typeof it.naziv !== "string" || it.naziv.trim() === "") {
      return Response.json({ message: `Stavka ${i + 1}: naziv je obavezan` }, { status: 400 });
    }
    const kolicina = typeof it.kolicina === "number" && it.kolicina > 0 ? it.kolicina : 1;
    if (typeof it.jedinicna_cijena !== "number" || it.jedinicna_cijena < 0 || !isFinite(it.jedinicna_cijena)) {
      return Response.json({ message: `Stavka ${i + 1}: cijena je obavezna` }, { status: 400 });
    }
    const popust = typeof it.popust === "number" ? it.popust : 0;
    if (popust < 0 || popust > 100) {
      return Response.json({ message: `Stavka ${i + 1}: popust mora biti 0–100%` }, { status: 400 });
    }

    const subtotal = kolicina * it.jedinicna_cijena;
    const ukupnaCijena = subtotal - (subtotal * popust) / 100;

    validated.push({
      tip: it.tip,
      naziv: it.naziv.trim(),
      kolicina,
      jedinicna_cijena: it.jedinicna_cijena,
      popust,
      ukupna_cijena: ukupnaCijena,
    });
  }

  // Insert all items + recalculate total in a single transaction
  db.transaction(() => {
    for (const v of validated) {
      db.query<null, [number, string, string, number, number, number, number]>(
        `INSERT INTO work_order_items (work_order_id, tip, naziv, kolicina, jedinicna_cijena, popust, ukupna_cijena)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(workOrderId, v.tip, v.naziv, v.kolicina, v.jedinicna_cijena, v.popust, v.ukupna_cijena);
    }
    recalculateTotal(workOrderId);
  })();

  const updated = getWorkOrderWithDetails(workOrderId);
  return Response.json(updated);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/work-orders.bulk.test.ts`
Expected: 8 pass, 0 fail.

- [ ] **Step 5: Run all tests to make sure nothing else broke**

Run: `bun test`
Expected: all pass.

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/api/work-orders.ts src/api/work-orders.bulk.test.ts
git commit -m "Add bulk-add endpoint for work order items with transaction"
```

---

## Task 6: Wire up the new routes

**Files:**
- Modify: `src/index.ts:39-52` (work-orders import block) and routes block

- [ ] **Step 1: Add imports**

In `src/index.ts`, change the work-orders import (lines 39-52) to also import `bulkAddWorkOrderItems`:

```ts
import {
  getWorkOrders,
  getWorkOrderById,
  getWorkOrdersByCustomer,
  createWorkOrder,
  updateWorkOrder,
  deleteWorkOrder,
  searchWorkOrders,
  addWorkOrderItem,
  updateWorkOrderItem,
  deleteWorkOrderItem,
  bulkAddWorkOrderItems,
  exportWorkOrdersCSV,
  importWorkOrdersCSV,
} from "./api/work-orders";
```

Add a new import below it:

```ts
import { scanInvoice } from "./api/invoice-scan";
```

- [ ] **Step 2: Register routes**

In the same file, after the existing `"/api/work-orders/:orderId/items/:itemId"` route, insert:

```ts
    "/api/work-orders/:id/items/bulk": {
      POST: bulkAddWorkOrderItems,
    },
    "/api/work-orders/scan-invoice": {
      POST: scanInvoice,
    },
```

Make sure `scan-invoice` comes BEFORE `/api/work-orders/:id` to avoid route ambiguity (actually, the existing pattern shows specific routes before `:id` already — `search`, `export/csv`, `import/csv`, `by-customer/:customerId`, so add `scan-invoice` near those near line 124).

Final placement: put `"/api/work-orders/scan-invoice"` right after `"/api/work-orders/import/csv"` and put `"/api/work-orders/:id/items/bulk"` right after `"/api/work-orders/:orderId/items/:itemId"`.

- [ ] **Step 3: Sanity-check routes**

Run: `bun --hot src/index.ts &` then:

```bash
curl -s -X POST http://localhost:3000/api/work-orders/scan-invoice -H "Content-Type: application/json" -d '{}' | head -c 200
curl -s -X POST http://localhost:3000/api/work-orders/1/items/bulk -H "Content-Type: application/json" -d '{}' | head -c 200
kill %1
```

Expected: both return 401 `{"message":"Niste prijavljeni"}` — the routes exist and require auth.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "Register scan-invoice and items/bulk routes"
```

---

## Task 7: Add client API methods

**Files:**
- Modify: `src/lib/api.ts:213-231` (workOrderItemsApi block) and append a new `invoiceScanApi`

- [ ] **Step 1: Add `addBulk` to `workOrderItemsApi`**

Replace the `workOrderItemsApi` block (lines 214-231) with:

```ts
// Work Order Items API
export const workOrderItemsApi = {
  add: (workOrderId: number, data: WorkOrderItemForm) =>
    fetchApi<WorkOrderItem>(`/work-orders/${workOrderId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (workOrderId: number, itemId: number, data: WorkOrderItemForm) =>
    fetchApi<WorkOrderItem>(`/work-orders/${workOrderId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (workOrderId: number, itemId: number) =>
    fetchApi<void>(`/work-orders/${workOrderId}/items/${itemId}`, {
      method: 'DELETE',
    }),

  addBulk: (workOrderId: number, items: WorkOrderItemForm[]) =>
    fetchApi<WorkOrder>(`/work-orders/${workOrderId}/items/bulk`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
};
```

- [ ] **Step 2: Add `invoiceScanApi` at the end of `src/lib/api.ts`**

Also add an import for the new types at the top of the file (line 21 area):

```ts
import type {
  // ... existing imports unchanged
  ScanInvoiceResponse,
} from '../types';
```

Then append:

```ts
// Invoice Scan API (multipart upload — bypasses fetchApi to send FormData with CSRF)
export const invoiceScanApi = {
  scan: async (file: File): Promise<{ success: true; data: ScanInvoiceResponse } | { success: false; error: string }> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch(`${API_BASE}/work-orders/scan-invoice`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Greška na serveru' }));
        return { success: false, error: error.message || 'Greška na serveru' };
      }

      const data = await response.json() as ScanInvoiceResponse;
      return { success: true, data };
    } catch {
      return { success: false, error: 'Greška u komunikaciji sa serverom' };
    }
  },
};
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "Add invoiceScanApi.scan and workOrderItemsApi.addBulk"
```

---

## Task 8: Build the InvoiceScanDialog component

**Files:**
- Create: `src/components/work-orders/InvoiceScanDialog.tsx`

This is the largest single piece. We're rendering capture, scanning, review-table, error states all in one dialog.

- [ ] **Step 1: Create the file**

Write the full component to `src/components/work-orders/InvoiceScanDialog.tsx`:

```tsx
import { useRef, useState } from "react";
import { Camera, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, parseCurrencyInput } from "@/lib/formatters";
import { invoiceScanApi, workOrderItemsApi } from "@/lib/api";
import type { WorkOrderItemForm } from "@/types";

interface InvoiceScanDialogProps {
  workOrderId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type ReviewRow = WorkOrderItemForm & { _id: string };

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "review"; rows: ReviewRow[]; warnings: string[] }
  | { kind: "adding"; rows: ReviewRow[]; warnings: string[] };

const MAX_BYTES = 8 * 1024 * 1024;

function newRowId(): string {
  return `r-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function rowTotal(row: ReviewRow): number {
  const subtotal = row.kolicina * row.jedinicna_cijena;
  return subtotal - (subtotal * (row.popust ?? 0)) / 100;
}

export function InvoiceScanDialog({ workOrderId, open, onOpenChange, onSuccess }: InvoiceScanDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhase({ kind: "error", message: "Slika nije validna" });
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase({ kind: "error", message: "Slika je prevelika (max 8MB)" });
      return;
    }

    setPhase({ kind: "scanning" });
    const result = await invoiceScanApi.scan(file);

    if (!result.success) {
      setPhase({ kind: "error", message: result.error });
      return;
    }

    if (result.data.items.length === 0) {
      setPhase({
        kind: "error",
        message: "Nije pronađeno stavki na slici. Pokušajte sa jasnijom slikom.",
      });
      return;
    }

    const rows: ReviewRow[] = result.data.items.map(item => ({
      _id: newRowId(),
      tip: "dio",
      naziv: item.naziv,
      kolicina: item.kolicina,
      jedinicna_cijena: item.jedinicna_cijena,
      popust: item.popust,
    }));
    setPhase({ kind: "review", rows, warnings: result.data.warnings });
  };

  const updateRow = (id: string, patch: Partial<ReviewRow>) => {
    if (phase.kind !== "review") return;
    setPhase({
      ...phase,
      rows: phase.rows.map(r => (r._id === id ? { ...r, ...patch } : r)),
    });
  };

  const removeRow = (id: string) => {
    if (phase.kind !== "review") return;
    setPhase({ ...phase, rows: phase.rows.filter(r => r._id !== id) });
  };

  const handleAddAll = async () => {
    if (phase.kind !== "review") return;
    if (phase.rows.length === 0) return;

    setPhase({ kind: "adding", rows: phase.rows, warnings: phase.warnings });

    const itemsToSend: WorkOrderItemForm[] = phase.rows.map(({ _id, ...rest }) => rest);
    const result = await workOrderItemsApi.addBulk(workOrderId, itemsToSend);

    if (!result.success) {
      setPhase({
        kind: "review",
        rows: phase.rows,
        warnings: [...phase.warnings, result.error || "Greška pri dodavanju stavki"],
      });
      return;
    }

    onSuccess();
    handleClose(false);
  };

  const total =
    phase.kind === "review" || phase.kind === "adding"
      ? phase.rows.reduce((sum, r) => sum + rowTotal(r), 0)
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skeniraj račun</DialogTitle>
        </DialogHeader>

        {phase.kind === "idle" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Slikajte ili odaberite sliku računa. Stavke će biti automatski prepoznate i možete ih pregledati prije dodavanja.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => fileInputRef.current?.click()} className="w-full sm:w-auto">
              <Camera className="h-4 w-4 mr-2" />
              Odaberi sliku
            </Button>
          </div>
        )}

        {phase.kind === "scanning" && (
          <div className="py-12 text-center space-y-3">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Analiziram račun...</p>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="py-6 space-y-4">
            <div className="flex items-start gap-3 p-3 bg-destructive/10 text-destructive rounded">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <p className="text-sm">{phase.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>Zatvori</Button>
              <Button onClick={reset}>Pokušaj ponovo</Button>
            </div>
          </div>
        )}

        {(phase.kind === "review" || phase.kind === "adding") && (
          <div className="space-y-4">
            {phase.warnings.length > 0 && (
              <div className="flex items-start gap-3 p-3 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 rounded text-sm">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <ul className="space-y-1">
                  {phase.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div className="space-y-3">
              {phase.rows.map((row) => (
                <div key={row._id} className="border rounded p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs font-medium rounded ${
                            row.tip === "dio"
                              ? "bg-status-info/10 text-status-info"
                              : "bg-status-success/10 text-status-success"
                          }`}
                          onClick={() => updateRow(row._id, { tip: row.tip === "dio" ? "usluga" : "dio" })}
                          disabled={phase.kind === "adding"}
                        >
                          {row.tip === "dio" ? "Dio" : "Usluga"}
                        </button>
                      </div>
                      <Input
                        value={row.naziv}
                        onChange={(e) => updateRow(row._id, { naziv: e.target.value })}
                        placeholder="Naziv"
                        disabled={phase.kind === "adding"}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">Količina</Label>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.kolicina}
                            onChange={(e) => updateRow(row._id, { kolicina: parseFloat(e.target.value) || 1 })}
                            disabled={phase.kind === "adding"}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Cijena</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.jedinicna_cijena}
                            onChange={(e) => updateRow(row._id, { jedinicna_cijena: parseCurrencyInput(e.target.value) })}
                            disabled={phase.kind === "adding"}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Popust %</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            value={row.popust ?? 0}
                            onChange={(e) => updateRow(row._id, { popust: parseFloat(e.target.value) || 0 })}
                            disabled={phase.kind === "adding"}
                          />
                        </div>
                      </div>
                      <div className="text-right text-sm font-medium">
                        Ukupno: {formatCurrency(rowTotal(row))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(row._id)}
                      disabled={phase.kind === "adding"}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-lg font-semibold">
                UKUPNO: {formatCurrency(total)}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)} disabled={phase.kind === "adding"}>
                  Odustani
                </Button>
                <Button
                  onClick={handleAddAll}
                  disabled={phase.kind === "adding" || phase.rows.length === 0}
                >
                  {phase.kind === "adding" ? "Dodajem..." : `Dodaj sve (${phase.rows.length})`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/work-orders/InvoiceScanDialog.tsx
git commit -m "Add InvoiceScanDialog with capture, review, and bulk-add flow"
```

---

## Task 9: Wire the scan button into WorkOrderItems

**Files:**
- Modify: `src/components/work-orders/WorkOrderItems.tsx:1-2`, `:38-48`, `:99-111`, `:380-383`

- [ ] **Step 1: Add imports and state**

In `src/components/work-orders/WorkOrderItems.tsx`:

Change line 1-2 to:

```tsx
import { useState } from "react";
import { Plus, Pencil, Trash2, Camera } from "lucide-react";
```

Add the dialog import at the bottom of the import block (after the existing imports):

```tsx
import { InvoiceScanDialog } from "./InvoiceScanDialog";
```

In the component, after `const [loading, setLoading] = useState(false);` (around line 48), add:

```tsx
  const [scanOpen, setScanOpen] = useState(false);
```

- [ ] **Step 2: Add the third button**

Change the toolbar block (lines 99-111). Replace:

```tsx
      {!readOnly && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={() => openNewForm("usluga")}>
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            Usluga
          </Button>
          <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={() => openNewForm("dio")}>
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            Dio
          </Button>
        </div>
      )}
```

with:

```tsx
      {!readOnly && (
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={() => openNewForm("usluga")}>
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            Usluga
          </Button>
          <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={() => openNewForm("dio")}>
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            Dio
          </Button>
          <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={() => setScanOpen(true)}>
            <Camera className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            Skeniraj račun
          </Button>
        </div>
      )}
```

- [ ] **Step 3: Render the dialog**

Just before the final `</div>` of the component (after the existing `<Dialog>` block, around line 381), add:

```tsx
      <InvoiceScanDialog
        workOrderId={workOrderId}
        open={scanOpen}
        onOpenChange={setScanOpen}
        onSuccess={onUpdate}
      />
```

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Build front-end and run dev server briefly to verify it loads**

Run:
```bash
bun --hot src/index.ts &
sleep 3
curl -s http://localhost:3000/ | head -c 200
kill %1
```

Expected: HTML returned (root index served), no startup errors in stderr.

- [ ] **Step 6: Commit**

```bash
git add src/components/work-orders/WorkOrderItems.tsx
git commit -m "Add Skeniraj račun button to WorkOrderItems"
```

---

## Task 10: Manual E2E checklist + final commit

This task is non-coding. Walk through the feature with a real `OPENROUTER_API_KEY` set in `.env`.

- [ ] **Step 1: Set the API key**

Add to `.env` at project root (create if missing). DO NOT commit `.env`.

```
OPENROUTER_API_KEY=sk-or-v1-...your-key-here...
```

Verify `.env` is in `.gitignore`. If not, add it:

```bash
grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
git add .gitignore
git commit -m "Ensure .env is gitignored"
```

- [ ] **Step 2: Run dev server and walk through scenarios**

Run: `bun --hot src/index.ts`

Open the browser, log in (admin / admin123 if defaults are still in place), open a work order, and verify:

1. **Happy path:** Click "📷 Skeniraj račun", upload a real Bosnian parts-supplier invoice photo. Spinner shows. Review table appears with parsed items. Edit a row, toggle one to "Usluga", click "Dodaj sve". Items appear in the work order with the correct total.
2. **Camera capture (mobile):** Open from a phone (or browser dev-tools mobile emulator with a Bluetooth/USB camera). Tapping the button opens the rear camera.
3. **Empty result:** Upload a non-invoice image (e.g. car photo). Error state shows "Nije pronađeno stavki na slici."
4. **Too-large file:** Try a >8MB image. Error message "Slika je prevelika".
5. **Wrong file type:** Try selecting a PDF (if the file picker allows). Error: "Slika nije validna".
6. **Bad API key:** Temporarily set `OPENROUTER_API_KEY=garbage` and reload. Error message "OpenRouter greška" appears.
7. **Missing API key:** Remove the key entirely and restart. Error: "Servis nije konfigurisan".
8. **Network kill mid-scan:** With dev tools, throttle to "Offline" right after clicking. Error state, retry works after re-enabling.
9. **Bulk-add transaction:** In review, edit one row to have a clearly-bad value (e.g. blank naziv if the UI allows submission), click "Dodaj sve". Error toast/inline shown. Reopen the work order — no items added.
10. **Mechanic role:** Log in as a mechanic, scan an invoice on their own work order — works. Try an admin's URL — gets 403 (cannot test without route guards but the API enforces it).

Note any issues. If a fix is needed, address it and add a follow-up commit.

- [ ] **Step 3: Run the full test suite once more**

Run: `bun test`
Expected: all pass.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Final summary commit (only if any cleanup was needed)**

If E2E surfaced no issues, no additional commit. Otherwise:

```bash
git add -p   # selectively stage
git commit -m "Address findings from manual E2E"
```

---

## Self-review notes

- Spec coverage: every numbered decision and component in the spec has a corresponding task. The optional warnings banner, file-size guard, AbortController timeout, role-based access, and atomic transaction are all implemented.
- Placeholders: none. Every code block is complete.
- Type consistency: `ParsedInvoiceItem` (Task 2) matches what `parseModelResponse` returns (Task 3) and what the dialog consumes (Task 8). `BulkItemsRequest` is defined but only used as the request shape — server unwraps it inline. `ScanInvoiceResponse` flows from server → api.ts → dialog consistently.
- Test isolation: `DB_PATH=:memory:` set before any `getDB()` call in test files; `closeDB()` between tests resets the singleton.
- Routes: `scan-invoice` placed before `:id` to avoid `:id="scan-invoice"` matching; `:id/items/bulk` placed after `:orderId/items/:itemId` (different segment counts mean no conflict).
