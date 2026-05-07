# Agregat Work Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second work order type (`agregat`) alongside `auto`, with a discriminator column on `work_orders`, additive-only DB migration, automatic file backup, two creation entry points in the UI, and a single list with filter and Tip badge.

**Architecture:** Single-table discriminator pattern — `work_orders.tip_naloga` selects the active fields. Auto orders use the existing NOT NULL car columns; agregat orders store `''` in those columns and populate new nullable agregat columns instead. The discriminator (never the empty-string heuristic) drives all branching in code. Migration adds 5 new columns and never rebuilds the table.

**Tech Stack:** Bun + bun:sqlite + React 19 + Tailwind + shadcn (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-07-agregat-work-orders-design.md`

---

## File map

**New files:**
- `src/components/work-orders/AgregatWorkOrderForm.tsx` — form for agregat order creation/edit
- `src/api/work-orders.tip-naloga.test.ts` — server tests for both order types

**Renamed files:**
- `src/components/work-orders/WorkOrderForm.tsx` → **kept name**, internal logic unchanged. (The spec mentioned an `AutoWorkOrderForm` rename — we keep the file name to avoid the import churn it would cause across the codebase. The form remains the auto-only path.)

**Modified files:**
- `src/db/schema.ts` — new columns in `createTablesSQL`
- `src/db/index.ts` — `runMigrations()` adds backup + 5 ALTER TABLE
- `src/types/index.ts` — `TipNaloga`, `TipAgregata`, extend `WorkOrder`, replace `WorkOrderForm` with discriminated union
- `src/lib/formatters.ts` — `getTipNalogaLabel`, `getTipAgregataLabel`
- `src/api/work-orders.ts` — validation in `createWorkOrder`/`updateWorkOrder`, `tip_naloga` filter, search across both types, CSV columns
- `src/lib/api.ts` — no signature change (typed via union)
- `src/components/work-orders/WorkOrderList.tsx` — two CTA buttons, segmented filter, Tip badge
- `src/components/work-orders/WorkOrderDetail.tsx` — conditional Vozilo/Agregat section
- `src/components/pdf/WorkOrderPDF.tsx` — conditional header section
- `src/App.tsx` — route both `/work-orders/new/auto` and `/work-orders/new/agregat`

---

## Task 1: Schema additions + auto-backup migration

**Files:**
- Modify: `src/db/schema.ts:38-58` (work_orders block)
- Modify: `src/db/index.ts:55-97` (runMigrations) and add file-backup helper

- [ ] **Step 1: Add new columns to `createTablesSQL` (fresh-DB path)**

In `src/db/schema.ts`, replace the `work_orders` table definition with:

```sql
-- Work Orders table
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broj_naloga TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  tip_naloga TEXT NOT NULL DEFAULT 'auto',
  registarske_tablice TEXT NOT NULL,
  vin_broj TEXT,
  marka_vozila TEXT NOT NULL,
  model_vozila TEXT NOT NULL,
  motor TEXT,
  kilometraza INTEGER,
  tip_agregata TEXT,
  marka_agregata TEXT,
  model_agregata TEXT,
  serijski_broj TEXT,
  mechanic_id INTEGER,
  opis_kvara TEXT,
  napomena TEXT,
  status TEXT DEFAULT 'otvoren',
  ukupna_cijena REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (mechanic_id) REFERENCES mechanics(id)
);
```

- [ ] **Step 2: Add backup helper + new ALTER TABLE migrations**

In `src/db/index.ts`, after the imports (line 3), add:

```ts
import { copyFileSync, existsSync } from "fs";
```

Replace `runMigrations(db)` (lines 55-97) with:

```ts
function runMigrations(db: Database): void {
  try {
    const columns = db.query<{ name: string }, []>(
      "PRAGMA table_info(work_orders)"
    ).all();
    const columnNames = new Set(columns.map(c => c.name));

    // Pre-existing migrations (idempotent)
    if (!columnNames.has('closed_at')) {
      db.exec("ALTER TABLE work_orders ADD COLUMN closed_at TEXT");
    }
    if (!columnNames.has('opis_kvara')) {
      db.exec("ALTER TABLE work_orders ADD COLUMN opis_kvara TEXT");
    }
    if (!columnNames.has('kilometraza')) {
      db.exec("ALTER TABLE work_orders ADD COLUMN kilometraza INTEGER");
    }

    // Detect agregat-feature migration: any of these columns missing?
    const needsAgregatMigration =
      !columnNames.has('tip_naloga') ||
      !columnNames.has('tip_agregata') ||
      !columnNames.has('marka_agregata') ||
      !columnNames.has('model_agregata') ||
      !columnNames.has('serijski_broj');

    if (needsAgregatMigration) {
      backupDatabaseFile();
      if (!columnNames.has('tip_naloga')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN tip_naloga TEXT NOT NULL DEFAULT 'auto'");
      }
      if (!columnNames.has('tip_agregata')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN tip_agregata TEXT");
      }
      if (!columnNames.has('marka_agregata')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN marka_agregata TEXT");
      }
      if (!columnNames.has('model_agregata')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN model_agregata TEXT");
      }
      if (!columnNames.has('serijski_broj')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN serijski_broj TEXT");
      }
    }

    // Existing work_order_items.popust migration
    const itemColumns = db.query<{ name: string }, []>(
      "PRAGMA table_info(work_order_items)"
    ).all();
    const hasPopust = itemColumns.some(col => col.name === 'popust');
    if (!hasPopust) {
      db.exec("ALTER TABLE work_order_items ADD COLUMN popust REAL DEFAULT 0");
    }

    // Existing sessions.csrf_token migration
    const sessionColumns = db.query<{ name: string }, []>(
      "PRAGMA table_info(sessions)"
    ).all();
    const hasCsrfToken = sessionColumns.some(col => col.name === 'csrf_token');
    if (!hasCsrfToken) {
      db.exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT");
    }
  } catch {}
}

function backupDatabaseFile(): void {
  const dbPath = process.env.DB_PATH ?? "data/asnord.db";
  // No backup for in-memory DBs (tests)
  if (dbPath === ":memory:") return;
  // Skip if the source file doesn't exist (fresh install — nothing to back up)
  if (!existsSync(dbPath)) return;

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak-${ts}`;
  // copyFileSync throws on failure — caller (runMigrations) is wrapped in try/catch,
  // but for safety we want missing backup to abort. Re-throw with a clear message.
  try {
    copyFileSync(dbPath, backupPath);
    console.log(`✅ Database backup created at ${backupPath}`);
  } catch (err) {
    console.error(`❌ Failed to create database backup at ${backupPath}:`, err);
    throw new Error(`Database backup failed; aborting migration: ${(err as Error).message}`);
  }
}
```

Note: `runMigrations` currently has a top-level `try { ... } catch {}` that silently swallows errors. We keep that for backwards compatibility with already-migrated DBs that throw "duplicate column" on idempotent re-runs, but the backup-failure case re-throws which propagates out. Verify this still happens (the empty `catch {}` swallows it). To make backup-failure fatal, change the outer `catch {}` to re-throw if the message starts with "Database backup failed":

Replace the outer `} catch {}` at the bottom of `runMigrations` with:

```ts
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Database backup failed")) {
      throw err;
    }
    // Other migration errors (e.g. duplicate column on re-run) are silently ignored
    // by design — pre-existing pattern.
  }
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep -v "^build.ts" | grep -v "No index signature" | grep -v "type 'Partial"`
Expected: empty.

- [ ] **Step 4: Run server with existing DB to verify migration runs and backup is created**

```bash
ls data/asnord.db.bak-* 2>/dev/null | wc -l   # remember how many backups exist before
PORT=3099 bun --hot src/index.ts > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 3
ls data/asnord.db.bak-* 2>/dev/null | wc -l   # should be one more if migration just ran
curl -s http://localhost:3099/api/auth/me     # sanity: server up
kill $SERVER_PID; wait 2>/dev/null
grep "Database backup" /tmp/server.log        # should print the backup path
```

Expected: a new `.bak-<timestamp>` file exists, server logs the backup path, `/api/auth/me` returns 401.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/index.ts
git commit -m "Add agregat columns + automatic DB backup on migration"
```

---

## Task 2: Update TypeScript types

**Files:**
- Modify: `src/types/index.ts:33-55` (WorkOrder interface) and `:103-115` (WorkOrderForm interface)

- [ ] **Step 1: Add discriminator and label types**

In `src/types/index.ts`, just above the `WorkOrder` interface (around line 33), insert:

```ts
export type TipNaloga = 'auto' | 'agregat';
export type TipAgregata = 'alnaser' | 'alternator' | 'klima_kompresor' | 'elektricni_uredjaj' | 'ostalo';
```

- [ ] **Step 2: Extend `WorkOrder` interface**

Replace the existing `WorkOrder` interface block (lines 33-55) with:

```ts
export interface WorkOrder {
  id: number;
  broj_naloga: string;
  customer_id: number;
  tip_naloga: TipNaloga;
  // Auto fields ('' for agregat orders, real values for auto)
  registarske_tablice: string;
  marka_vozila: string;
  model_vozila: string;
  vin_broj: string | null;
  motor: string | null;
  kilometraza: number | null;
  // Agregat fields (null for auto orders)
  tip_agregata: TipAgregata | null;
  marka_agregata: string | null;
  model_agregata: string | null;
  serijski_broj: string | null;
  // Common
  mechanic_id: number | null;
  opis_kvara: string | null;
  napomena: string | null;
  status: 'otvoren' | 'u_toku' | 'zavrsen';
  ukupna_cijena: number;
  created_at: string;
  closed_at: string | null;
  // Joined data
  customer?: Customer;
  mechanic?: Mechanic;
  items?: WorkOrderItem[];
  time_entries?: TimeEntry[];
}
```

- [ ] **Step 3: Replace `WorkOrderForm` with discriminated union**

Replace the existing `WorkOrderForm` interface (lines 103-115) with:

```ts
export type WorkOrderFormAuto = {
  tip_naloga: 'auto';
  customer_id: number;
  registarske_tablice: string;
  vin_broj?: string;
  marka_vozila: string;
  model_vozila: string;
  motor?: string;
  kilometraza?: number;
  mechanic_id?: number;
  opis_kvara?: string;
  napomena?: string;
  status?: 'otvoren' | 'u_toku' | 'zavrsen';
};

export type WorkOrderFormAgregat = {
  tip_naloga: 'agregat';
  customer_id: number;
  tip_agregata: TipAgregata;
  marka_agregata: string;
  model_agregata?: string;
  serijski_broj?: string;
  mechanic_id?: number;
  opis_kvara?: string;
  napomena?: string;
  status?: 'otvoren' | 'u_toku' | 'zavrsen';
};

export type WorkOrderForm = WorkOrderFormAuto | WorkOrderFormAgregat;
```

- [ ] **Step 4: Type-check (will surface errors in dependent files; that's expected and fixed in later tasks)**

Run: `bunx tsc --noEmit 2>&1 | grep -v "^build.ts" | grep -v "No index signature" | grep -v "type 'Partial" | head -30`

Expected: errors in `src/api/work-orders.ts` and `src/components/work-orders/WorkOrderForm.tsx` because they don't yet know about the discriminator. **This is intentional** — Tasks 3 and 8 fix them. Note the failing files but proceed.

- [ ] **Step 5: Do NOT commit yet — types changes break the build until Task 3 lands. Continue to Task 3 in the same session.**

(Defer the commit until end of Task 3, where it bundles types + server fixes.)

---

## Task 3: Server validation for both order types (TDD)

**Files:**
- Create: `src/api/work-orders.tip-naloga.test.ts`
- Modify: `src/api/work-orders.ts:236-277` (`createWorkOrder`) and `:280-384` (`updateWorkOrder`)

- [ ] **Step 1: Write the failing tests**

Create `src/api/work-orders.tip-naloga.test.ts`:

```ts
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
    // missing registarske_tablice
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
    // missing tip_agregata + marka_agregata
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
    // client sneakily sends car fields — server must ignore
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
  // Backward compat: clients that don't send tip_naloga get auto
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
  // Create an auto order first
  const createRes = await createWorkOrder(makeRequest("POST", "/api/work-orders", {
    tip_naloga: "auto",
    customer_id: customerId,
    registarske_tablice: "AB-1",
    marka_vozila: "M",
    model_vozila: "X",
  }));
  const created = await createRes.json() as { id: number };

  // Try to flip it to agregat
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
```

- [ ] **Step 2: Run tests to confirm they fail (functions exist but logic is old)**

Run: `bun test src/api/work-orders.tip-naloga.test.ts 2>&1 | tail -10`
Expected: many failures because the old `createWorkOrder` doesn't read `tip_naloga`, doesn't validate agregat fields, etc.

- [ ] **Step 3: Replace `createWorkOrder` with type-aware version**

In `src/api/work-orders.ts`, replace the `createWorkOrder` function (lines 236-277) with:

```ts
const TIP_AGREGATA_VALUES = new Set(['alnaser', 'alternator', 'klima_kompresor', 'elektricni_uredjaj', 'ostalo']);

export async function createWorkOrder(req: Request): Promise<Response> {
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const data = await req.json() as Partial<WorkOrderForm> & { tip_naloga?: string };

  // Default missing tip_naloga to 'auto' for backward compatibility
  const tip = data.tip_naloga ?? 'auto';
  if (tip !== 'auto' && tip !== 'agregat') {
    return Response.json({ message: 'Tip naloga je nevalidan' }, { status: 400 });
  }

  if (!data.customer_id) {
    return Response.json({ message: 'Klijent je obavezan' }, { status: 400 });
  }

  let registarske_tablice: string;
  let vin_broj: string | null;
  let marka_vozila: string;
  let model_vozila: string;
  let motor: string | null;
  let kilometraza: number | null;
  let tip_agregata: string | null;
  let marka_agregata: string | null;
  let model_agregata: string | null;
  let serijski_broj: string | null;

  if (tip === 'auto') {
    const autoData = data as WorkOrderFormAuto;
    if (!autoData.registarske_tablice || !autoData.marka_vozila || !autoData.model_vozila) {
      return Response.json({
        message: 'Registarske tablice, marka i model vozila su obavezni za auto nalog'
      }, { status: 400 });
    }
    registarske_tablice = autoData.registarske_tablice;
    vin_broj = autoData.vin_broj || null;
    marka_vozila = autoData.marka_vozila;
    model_vozila = autoData.model_vozila;
    motor = autoData.motor || null;
    kilometraza = autoData.kilometraza ?? null;
    tip_agregata = null;
    marka_agregata = null;
    model_agregata = null;
    serijski_broj = null;
  } else {
    const agData = data as WorkOrderFormAgregat;
    if (!agData.tip_agregata || !TIP_AGREGATA_VALUES.has(agData.tip_agregata)) {
      return Response.json({ message: 'Tip agregata je obavezan i mora biti validan' }, { status: 400 });
    }
    if (!agData.marka_agregata || !agData.marka_agregata.trim()) {
      return Response.json({ message: 'Marka agregata je obavezna' }, { status: 400 });
    }
    registarske_tablice = '';
    vin_broj = null;
    marka_vozila = '';
    model_vozila = '';
    motor = null;
    kilometraza = null;
    tip_agregata = agData.tip_agregata;
    marka_agregata = agData.marka_agregata.trim();
    model_agregata = agData.model_agregata?.trim() || null;
    serijski_broj = agData.serijski_broj?.trim() || null;
  }

  const db = getDB();
  const brojNaloga = generateWorkOrderNumber();
  const createdAt = new Date().toISOString();

  const result = db.query<{ id: number }, [string, number, string, string, string | null, string, string, string | null, number | null, string | null, string | null, string | null, string | null, number | null, string | null, string | null, string, string]>(
    `INSERT INTO work_orders
     (broj_naloga, customer_id, tip_naloga, registarske_tablice, vin_broj, marka_vozila, model_vozila, motor, kilometraza, tip_agregata, marka_agregata, model_agregata, serijski_broj, mechanic_id, opis_kvara, napomena, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(
    brojNaloga,
    data.customer_id,
    tip,
    registarske_tablice,
    vin_broj,
    marka_vozila,
    model_vozila,
    motor,
    kilometraza,
    tip_agregata,
    marka_agregata,
    model_agregata,
    serijski_broj,
    data.mechanic_id ?? null,
    data.opis_kvara || null,
    data.napomena || null,
    data.status || 'otvoren',
    createdAt
  );

  const workOrder = getWorkOrderWithDetails(result!.id);
  return Response.json(workOrder, { status: 201 });
}
```

Add the imports near the top of the file (the import line that currently brings in `WorkOrder`, `WorkOrderForm` etc.):

Replace the existing types import block with:

```ts
import type { WorkOrder, WorkOrderForm, WorkOrderFormAuto, WorkOrderFormAgregat, WorkOrderItem, WorkOrderItemForm, Customer, Mechanic, TimeEntry } from '../types';
```

- [ ] **Step 4: Update `updateWorkOrder` to reject `tip_naloga` changes and accept agregat fields**

In `src/api/work-orders.ts`, inside `updateWorkOrder` (around lines 309-373), add this guard near the top, just after `existing` is loaded and authorization checked:

```ts
  // Reject tip_naloga changes
  if (data.tip_naloga !== undefined && data.tip_naloga !== existing.tip_naloga) {
    return Response.json({ message: 'Tip naloga se ne može mijenjati nakon kreiranja' }, { status: 400 });
  }
```

Then, in the same function, append agregat-field handling after the existing field blocks (just before the `if (data.status !== undefined)` block):

```ts
  if (data.tip_agregata !== undefined) {
    if (data.tip_agregata !== null && !TIP_AGREGATA_VALUES.has(data.tip_agregata)) {
      return Response.json({ message: 'Tip agregata je nevalidan' }, { status: 400 });
    }
    updates.push('tip_agregata = ?');
    values.push(data.tip_agregata ?? null);
  }
  if (data.marka_agregata !== undefined) {
    updates.push('marka_agregata = ?');
    values.push((data.marka_agregata || '').trim() || null);
  }
  if (data.model_agregata !== undefined) {
    updates.push('model_agregata = ?');
    values.push((data.model_agregata || '').trim() || null);
  }
  if (data.serijski_broj !== undefined) {
    updates.push('serijski_broj = ?');
    values.push((data.serijski_broj || '').trim() || null);
  }
```

The `data` parameter type for `updateWorkOrder` should be loosened since it now accepts mixed fields. Change `const data: Partial<WorkOrderForm> = await req.json();` to `const data: Record<string, any> = await req.json();` (the existing handler already uses `if (data.X !== undefined)` checks, so a permissive type is consistent with how it's used).

- [ ] **Step 5: Update `getWorkOrders` to filter by `tip_naloga`**

In `getWorkOrders` (around lines 53-127), find the existing `const status = url.searchParams.get('status');` line and add right below:

```ts
  const tipNaloga = url.searchParams.get('tip_naloga');
```

In the `whereClauses` building section, after the existing `status` block, add:

```ts
  if (tipNaloga === 'auto' || tipNaloga === 'agregat') {
    whereClauses.push('wo.tip_naloga = ?');
    params.push(tipNaloga);
  }
```

- [ ] **Step 6: Update `searchWorkOrders` to also match agregat fields**

In `searchWorkOrders` (around lines 130-181), expand the `WHERE` predicate to OR-match agregat columns. Replace the existing query block:

```ts
  const params: (string | number)[] = [searchPattern, searchPattern, searchPattern, searchPattern];

  if (currentUser && currentUser.role === 'mechanic' && currentUser.mechanic_id) {
    mechanicFilter = 'AND wo.mechanic_id = ?';
    params.push(currentUser.mechanic_id);
  }

  const workOrders = db.query<WorkOrder & { customer_ime: string; customer_prezime: string; customer_firma: string | null }, (string | number)[]>(
    `SELECT wo.*, c.ime as customer_ime, c.prezime as customer_prezime, c.naziv_firme as customer_firma
     FROM work_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     WHERE (wo.vin_broj LIKE ?
        OR wo.registarske_tablice LIKE ?
        OR c.ime LIKE ?
        OR c.prezime LIKE ?)
        ${mechanicFilter}
     ORDER BY wo.created_at DESC
     LIMIT 50`
  ).all(...params);
```

with:

```ts
  const params: (string | number)[] = [
    searchPattern, searchPattern, searchPattern, searchPattern, // VIN, plates, customer ime, customer prezime
    searchPattern, searchPattern, searchPattern, // serijski_broj, marka_agregata, model_agregata
  ];

  if (currentUser && currentUser.role === 'mechanic' && currentUser.mechanic_id) {
    mechanicFilter = 'AND wo.mechanic_id = ?';
    params.push(currentUser.mechanic_id);
  }

  const workOrders = db.query<WorkOrder & { customer_ime: string; customer_prezime: string; customer_firma: string | null }, (string | number)[]>(
    `SELECT wo.*, c.ime as customer_ime, c.prezime as customer_prezime, c.naziv_firme as customer_firma
     FROM work_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     WHERE (wo.vin_broj LIKE ?
        OR wo.registarske_tablice LIKE ?
        OR c.ime LIKE ?
        OR c.prezime LIKE ?
        OR wo.serijski_broj LIKE ?
        OR wo.marka_agregata LIKE ?
        OR wo.model_agregata LIKE ?)
        ${mechanicFilter}
     ORDER BY wo.created_at DESC
     LIMIT 50`
  ).all(...params);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test src/api/work-orders.tip-naloga.test.ts 2>&1 | tail -8`
Expected: 12 pass, 0 fail.

- [ ] **Step 8: Run all tests**

Run: `bun test 2>&1 | tail -8`
Expected: all pass (existing 21 + new 12 = 33).

- [ ] **Step 9: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep -v "^build.ts" | grep -v "No index signature" | grep -v "type 'Partial" | head -20`

Expected: errors only in **client-side** files (`WorkOrderForm.tsx`, `WorkOrderList.tsx`, `WorkOrderDetail.tsx`) due to the discriminated union — those are fixed in Tasks 6-9. **No server-side errors.**

- [ ] **Step 10: Commit (bundles Task 2 types + Task 3 server changes)**

```bash
git add src/types/index.ts src/api/work-orders.ts src/api/work-orders.tip-naloga.test.ts
git commit -m "Add tip_naloga discriminator + server validation for both order types"
```

---

## Task 4: CSV export/import include new columns

**Files:**
- Modify: `src/api/work-orders.ts:602-718` (export) and `:720-891` (import)

- [ ] **Step 1: Update CSV header constant in `exportWorkOrdersCSV`**

Find the `headers` array (around line 631) and replace it with:

```ts
  const headers = [
    'broj_naloga',
    'tip_naloga',
    'status',
    'created_at',
    'closed_at',
    'registarske_tablice',
    'vin_broj',
    'marka_vozila',
    'model_vozila',
    'motor',
    'kilometraza',
    'tip_agregata',
    'marka_agregata',
    'model_agregata',
    'serijski_broj',
    'opis_kvara',
    'napomena',
    'ukupna_cijena',
    'customer_ime',
    'customer_prezime',
    'customer_firma',
    'customer_telefon',
    'mechanic_ime',
    'mechanic_prezime',
    'items_json',
    'time_entries_json'
  ];
```

- [ ] **Step 2: Update the row builder to emit those values**

Find the `const row = [...]` block in `exportWorkOrdersCSV` (around line 683) and replace it with:

```ts
    const row = [
      escapeCSV(wo.broj_naloga),
      escapeCSV(wo.tip_naloga),
      escapeCSV(wo.status),
      escapeCSV(wo.created_at),
      escapeCSV(wo.closed_at),
      escapeCSV(wo.registarske_tablice),
      escapeCSV(wo.vin_broj),
      escapeCSV(wo.marka_vozila),
      escapeCSV(wo.model_vozila),
      escapeCSV(wo.motor),
      escapeCSV(wo.kilometraza),
      escapeCSV(wo.tip_agregata),
      escapeCSV(wo.marka_agregata),
      escapeCSV(wo.model_agregata),
      escapeCSV(wo.serijski_broj),
      escapeCSV(wo.opis_kvara),
      escapeCSV(wo.napomena),
      escapeCSV(wo.ukupna_cijena),
      escapeCSV(wo.customer_ime),
      escapeCSV(wo.customer_prezime),
      escapeCSV(wo.customer_firma),
      escapeCSV(wo.customer_telefon),
      escapeCSV(wo.mechanic_ime),
      escapeCSV(wo.mechanic_prezime),
      escapeCSV(JSON.stringify(items)),
      escapeCSV(JSON.stringify(timeEntries))
    ];
```

- [ ] **Step 3: Update `importWorkOrdersCSV` INSERT to include new columns**

In `importWorkOrdersCSV`, find the work-order INSERT (around line 815) and replace the entire `db.query<{id:number}, ...>('INSERT INTO work_orders ...')` block with:

```ts
        // Create work order
        const workOrderResult = db.query<{ id: number }, [string, number, string, string, string | null, string, string, string | null, number | null, string | null, string | null, string | null, string | null, number | null, string | null, string | null, string, string, string | null]>(
          `INSERT INTO work_orders
           (broj_naloga, customer_id, tip_naloga, registarske_tablice, vin_broj, marka_vozila, model_vozila, motor, kilometraza, tip_agregata, marka_agregata, model_agregata, serijski_broj, mechanic_id, opis_kvara, napomena, status, created_at, closed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        ).get(
          data.broj_naloga || '',
          customerId,
          data.tip_naloga === 'agregat' ? 'agregat' : 'auto',
          data.registarske_tablice || '',
          data.vin_broj || null,
          data.marka_vozila || '',
          data.model_vozila || '',
          data.motor || null,
          data.kilometraza ? parseInt(data.kilometraza) : null,
          data.tip_agregata || null,
          data.marka_agregata || null,
          data.model_agregata || null,
          data.serijski_broj || null,
          mechanicId,
          data.opis_kvara || null,
          data.napomena || null,
          data.status || 'otvoren',
          data.created_at || new Date().toISOString(),
          data.closed_at || null
        );
```

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep "src/api/work-orders.ts" | head -10`
Expected: no errors specifically in work-orders.ts (other client-side errors still expected, fixed later).

- [ ] **Step 5: Run all server tests**

Run: `bun test 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/work-orders.ts
git commit -m "Include agregat columns in CSV export and import"
```

---

## Task 5: Add label helpers in formatters

**Files:**
- Modify: `src/lib/formatters.ts:65-68` (existing `getItemTypeLabel`)

- [ ] **Step 1: Append the two helper functions to the bottom of `src/lib/formatters.ts`**

```ts
import type { TipNaloga, TipAgregata } from '../types';

const TIP_NALOGA_LABEL: Record<TipNaloga, string> = {
  auto: 'Auto',
  agregat: 'Agregat',
};

const TIP_AGREGATA_LABEL: Record<TipAgregata, string> = {
  alnaser: 'Alnaser',
  alternator: 'Alternator',
  klima_kompresor: 'Klima kompresor',
  elektricni_uredjaj: 'Električni uređaj',
  ostalo: 'Ostalo',
};

export function getTipNalogaLabel(tip: TipNaloga): string {
  return TIP_NALOGA_LABEL[tip] ?? tip;
}

export function getTipAgregataLabel(tip: TipAgregata | string | null | undefined): string {
  if (!tip) return '';
  return TIP_AGREGATA_LABEL[tip as TipAgregata] ?? tip;
}
```

(Place the type-only `import type` at the top of the file alongside any other imports — currently `formatters.ts` has no imports, so the import becomes the first line.)

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep "src/lib/formatters.ts" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/formatters.ts
git commit -m "Add label helpers for tip_naloga and tip_agregata"
```

---

## Task 6: Update WorkOrderForm (auto form) to set `tip_naloga: 'auto'`

**Files:**
- Modify: `src/components/work-orders/WorkOrderForm.tsx:41-53` (initial formData) and any submit logic

This file is the existing auto form. We don't rename it (avoid widespread import churn). We just thread `tip_naloga: 'auto'` through.

- [ ] **Step 1: Add `tip_naloga` to initial form state**

In `src/components/work-orders/WorkOrderForm.tsx`, replace the `useState<WorkOrderFormData>` block (around line 41) with:

```tsx
  const [formData, setFormData] = useState<WorkOrderFormAuto>({
    tip_naloga: 'auto',
    customer_id: 0,
    registarske_tablice: "",
    vin_broj: "",
    marka_vozila: "",
    model_vozila: "",
    motor: "",
    kilometraza: undefined,
    mechanic_id: initialMechanicId,
    opis_kvara: "",
    napomena: "",
    status: "otvoren",
  });
```

Update the imports at the top (around line 19):

```tsx
import type { WorkOrder, WorkOrderFormAuto, Mechanic, Customer, Vehicle } from "@/types";
```

(Remove the old `WorkOrderForm as WorkOrderFormData` alias; references in the file should switch to `WorkOrderFormAuto`. Search and replace `WorkOrderFormData` → `WorkOrderFormAuto` in this file.)

- [ ] **Step 2: When loading an existing work order for edit, ensure `tip_naloga: 'auto'` is preserved**

If the file has a `useEffect` that loads existing work orders into formData (look for `workOrdersApi.getById`), make sure the loader sets `tip_naloga: 'auto'`. If the file currently spreads `result.data` into formData, it already includes `tip_naloga` from the server. Verify by reading lines around the existing useEffect.

If the loader explicitly sets only the auto fields (not the whole `tip_naloga`), ensure it includes `tip_naloga: 'auto'`. Add it to whichever object is being set into state.

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep "src/components/work-orders/WorkOrderForm.tsx" | head -10`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/work-orders/WorkOrderForm.tsx
git commit -m "Set tip_naloga='auto' on the auto work order form"
```

---

## Task 7: Build AgregatWorkOrderForm

**Files:**
- Create: `src/components/work-orders/AgregatWorkOrderForm.tsx`

- [ ] **Step 1: Create the file**

Write to `src/components/work-orders/AgregatWorkOrderForm.tsx`:

```tsx
import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerSelect } from "@/components/customers/CustomerSelect";
import { workOrdersApi, mechanicsApi } from "@/lib/api";
import { invalidateWorkOrdersCache } from "./WorkOrderList";
import { useAuth } from "@/contexts/AuthContext";
import { getTipAgregataLabel } from "@/lib/formatters";
import type { WorkOrder, WorkOrderFormAgregat, Mechanic, Customer, TipAgregata } from "@/types";

interface AgregatWorkOrderFormProps {
  workOrderId?: number;
  onBack: () => void;
  onSaved: (workOrder: WorkOrder) => void;
}

const TIP_AGREGATA_OPTIONS: TipAgregata[] = ['alnaser', 'alternator', 'klima_kompresor', 'elektricni_uredjaj', 'ostalo'];

export function AgregatWorkOrderForm({ workOrderId, onBack, onSaved }: AgregatWorkOrderFormProps) {
  const { user, isMechanic } = useAuth();
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialMechanicId = !workOrderId && isMechanic && user?.mechanic_id ? user.mechanic_id : undefined;

  const [formData, setFormData] = useState<WorkOrderFormAgregat>({
    tip_naloga: 'agregat',
    customer_id: 0,
    tip_agregata: 'alnaser',
    marka_agregata: '',
    model_agregata: '',
    serijski_broj: '',
    mechanic_id: initialMechanicId,
    opis_kvara: '',
    napomena: '',
    status: 'otvoren',
  });

  useEffect(() => {
    mechanicsApi.getAll().then(result => {
      if (result.success && result.data) setMechanics(result.data);
    });
  }, []);

  useEffect(() => {
    if (!workOrderId) return;
    setLoading(true);
    workOrdersApi.getById(workOrderId).then(result => {
      if (result.success && result.data) {
        const wo = result.data;
        if (wo.tip_naloga !== 'agregat') {
          setError('Ovaj nalog nije agregat nalog');
          return;
        }
        setFormData({
          tip_naloga: 'agregat',
          customer_id: wo.customer_id,
          tip_agregata: (wo.tip_agregata ?? 'alnaser') as TipAgregata,
          marka_agregata: wo.marka_agregata ?? '',
          model_agregata: wo.model_agregata ?? '',
          serijski_broj: wo.serijski_broj ?? '',
          mechanic_id: wo.mechanic_id ?? undefined,
          opis_kvara: wo.opis_kvara ?? '',
          napomena: wo.napomena ?? '',
          status: wo.status,
        });
      }
      setLoading(false);
    });
  }, [workOrderId]);

  const handleCustomerChange = (customerId: number, _customer: Customer) => {
    setFormData(prev => ({ ...prev, customer_id: customerId }));
  };

  const handleSubmit = async () => {
    setError(null);

    if (!formData.customer_id) {
      setError('Klijent je obavezan');
      return;
    }
    if (!formData.marka_agregata.trim()) {
      setError('Marka agregata je obavezna');
      return;
    }

    setSaving(true);
    const result = workOrderId
      ? await workOrdersApi.update(workOrderId, formData)
      : await workOrdersApi.create(formData);
    setSaving(false);

    if (result.success && result.data) {
      invalidateWorkOrdersCache();
      onSaved(result.data);
    } else {
      setError(result.error || 'Greška pri čuvanju');
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">Učitavanje...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Nazad
        </Button>
        <h1 className="text-xl font-medium">
          {workOrderId ? 'Uredi agregat nalog' : 'Novi agregat nalog'}
        </h1>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 text-destructive rounded text-sm">{error}</div>
      )}

      <div className="space-y-4 max-w-2xl">
        <div className="space-y-2">
          <Label>Klijent *</Label>
          <CustomerSelect
            value={formData.customer_id || undefined}
            onChange={handleCustomerChange}
          />
        </div>

        <div className="space-y-2">
          <Label>Tip agregata *</Label>
          <Select
            value={formData.tip_agregata}
            onValueChange={(v) => setFormData(prev => ({ ...prev, tip_agregata: v as TipAgregata }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIP_AGREGATA_OPTIONS.map(t => (
                <SelectItem key={t} value={t}>{getTipAgregataLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Marka *</Label>
          <Input
            value={formData.marka_agregata}
            onChange={(e) => setFormData(prev => ({ ...prev, marka_agregata: e.target.value }))}
            placeholder="npr. Bosch, Valeo"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Model</Label>
            <Input
              value={formData.model_agregata ?? ''}
              onChange={(e) => setFormData(prev => ({ ...prev, model_agregata: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Serijski broj</Label>
            <Input
              value={formData.serijski_broj ?? ''}
              onChange={(e) => setFormData(prev => ({ ...prev, serijski_broj: e.target.value }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Mehaničar</Label>
          <Select
            value={formData.mechanic_id?.toString() ?? 'none'}
            onValueChange={(v) => setFormData(prev => ({ ...prev, mechanic_id: v === 'none' ? undefined : parseInt(v) }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Odaberi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— bez mehaničara —</SelectItem>
              {mechanics.map(m => (
                <SelectItem key={m.id} value={m.id.toString()}>{m.ime} {m.prezime}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={formData.status ?? 'otvoren'}
            onValueChange={(v) => setFormData(prev => ({ ...prev, status: v as 'otvoren' | 'u_toku' | 'zavrsen' }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="otvoren">Otvoren</SelectItem>
              <SelectItem value="u_toku">U toku</SelectItem>
              <SelectItem value="zavrsen">Završen</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Opis kvara</Label>
          <Textarea
            value={formData.opis_kvara ?? ''}
            onChange={(e) => setFormData(prev => ({ ...prev, opis_kvara: e.target.value }))}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label>Napomena</Label>
          <Textarea
            value={formData.napomena ?? ''}
            onChange={(e) => setFormData(prev => ({ ...prev, napomena: e.target.value }))}
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onBack}>Odustani</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Čuvanje...' : 'Sačuvaj'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep "src/components/work-orders/AgregatWorkOrderForm.tsx" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/work-orders/AgregatWorkOrderForm.tsx
git commit -m "Add AgregatWorkOrderForm for creating/editing agregat orders"
```

---

## Task 8: Update WorkOrderList — two CTA buttons + filter + Tip badge

**Files:**
- Modify: `src/components/work-orders/WorkOrderList.tsx`

Note: The existing `WorkOrderListProps` has `onNew: () => void`. We need two callbacks now (`onNewAuto`, `onNewAgregat`). This is a breaking change to the component's interface — App.tsx (Task 12) updates the call site.

- [ ] **Step 1: Update props and state**

In `src/components/work-orders/WorkOrderList.tsx`, change the `WorkOrderListProps` interface (around line 35) to:

```tsx
interface WorkOrderListProps {
  onNewAuto: () => void;
  onNewAgregat: () => void;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onPrintPDF: (workOrder: WorkOrder) => void;
}
```

Change the function signature accordingly: `export function WorkOrderList({ onNewAuto, onNewAgregat, onView, onEdit, onPrintPDF }: WorkOrderListProps) {`.

Add a tip filter state alongside the existing `statusFilter` state (around line 60):

```tsx
  const [tipFilter, setTipFilter] = useState<'all' | 'auto' | 'agregat'>('all');
```

- [ ] **Step 2: Add tip filter to data fetching**

Find where `workOrdersApi.getAll(...)` is called in the file. Update its filter argument to include the `tip` filter. The current API signature is `getAll(page, limit, filters?: { status?: string })`. Extend `src/lib/api.ts` first — see sub-step.

**Sub-step (in `src/lib/api.ts`):**

Modify `workOrdersApi.getAll` to accept `tip_naloga`:

```ts
  getAll: (page = 1, limit = 20, filters?: { status?: string; tip_naloga?: 'auto' | 'agregat' }) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters?.status) params.set('status', filters.status);
    if (filters?.tip_naloga) params.set('tip_naloga', filters.tip_naloga);
    return fetchApi<PaginatedResponse<WorkOrder>>(`/work-orders?${params}`);
  },
```

Then in the list, change the API call to pass `tip_naloga` when `tipFilter !== 'all'`:

```tsx
  // Inside the data-fetching effect (locate the existing workOrdersApi.getAll call)
  const filters: { status?: string; tip_naloga?: 'auto' | 'agregat' } = {};
  if (statusFilter !== 'all') filters.status = statusFilter;
  if (tipFilter !== 'all') filters.tip_naloga = tipFilter;
  const result = await workOrdersApi.getAll(page, limit, filters);
```

(The exact structure depends on existing code — match the existing style for `statusFilter`. The cache key must also include `tipFilter` so cached data doesn't bleed between filters. Update the `CacheEntry` interface and cache logic at the top of the file accordingly.)

- [ ] **Step 3: Replace the new-button area and add the filter and Tip column**

Find the existing `<Button>` for "Novi nalog" and replace it (and surrounding header layout) with:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Button onClick={onNewAuto} size="sm">
    <Plus className="h-4 w-4 mr-1" />
    Novi auto nalog
  </Button>
  <Button onClick={onNewAgregat} size="sm" variant="outline">
    <Plus className="h-4 w-4 mr-1" />
    Novi agregat nalog
  </Button>
  <div className="ml-auto flex gap-1">
    <Button
      size="sm"
      variant={tipFilter === 'all' ? 'default' : 'outline'}
      onClick={() => setTipFilter('all')}
    >
      Sve
    </Button>
    <Button
      size="sm"
      variant={tipFilter === 'auto' ? 'default' : 'outline'}
      onClick={() => setTipFilter('auto')}
    >
      Auto
    </Button>
    <Button
      size="sm"
      variant={tipFilter === 'agregat' ? 'default' : 'outline'}
      onClick={() => setTipFilter('agregat')}
    >
      Agregat
    </Button>
  </div>
</div>
```

In the desktop table, add a new column header `<TableHead>Tip</TableHead>` right after the existing `Broj` (or whichever) header. In each `<TableRow>`, add a corresponding `<TableCell>` showing a colored badge:

```tsx
<TableCell>
  <Badge variant="outline" className={wo.tip_naloga === 'agregat' ? 'border-orange-500 text-orange-600' : 'border-blue-500 text-blue-600'}>
    {getTipNalogaLabel(wo.tip_naloga)}
  </Badge>
</TableCell>
```

Import `getTipNalogaLabel` from `@/lib/formatters`.

In the row rendering, where the vehicle info (`marka_vozila`, `model_vozila`, `registarske_tablice`) is shown, branch on `tip_naloga`:

```tsx
{wo.tip_naloga === 'agregat' ? (
  <span>{getTipAgregataLabel(wo.tip_agregata)}{wo.marka_agregata ? ' · ' + wo.marka_agregata : ''}</span>
) : (
  <span>{wo.marka_vozila} {wo.model_vozila} · <span className="font-mono">{wo.registarske_tablice}</span></span>
)}
```

Add `getTipAgregataLabel` to the formatters import.

The mobile list rastri likewise should branch — find the equivalent block and apply the same conditional.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep "WorkOrderList" | head`
Expected: no errors.

- [ ] **Step 5: Commit (will not yet build/run because App.tsx still passes onNew, fixed in Task 12)**

```bash
git add src/components/work-orders/WorkOrderList.tsx src/lib/api.ts
git commit -m "WorkOrderList: two CTA buttons, tip filter, Tip badge"
```

---

## Task 9: Update WorkOrderDetail — conditional Vozilo/Agregat section

**Files:**
- Modify: `src/components/work-orders/WorkOrderDetail.tsx:188-198, 258-280` (vehicle sections)

- [ ] **Step 1: Update the "summary card" snippet (around line 188)**

Find the block:

```tsx
<span className="text-xs text-muted-foreground">Vozilo</span>
<p className="font-medium">{workOrder.marka_vozila} {workOrder.model_vozila}</p>
...
<p className="font-medium font-mono">{workOrder.registarske_tablice}</p>
```

Wrap it in a `tip_naloga` conditional, with an agregat alternative. Replace that whole section with:

```tsx
{workOrder.tip_naloga === 'agregat' ? (
  <>
    <div>
      <span className="text-xs text-muted-foreground">Agregat</span>
      <p className="font-medium">{getTipAgregataLabel(workOrder.tip_agregata)}</p>
    </div>
    <div>
      <span className="text-xs text-muted-foreground">Marka</span>
      <p className="font-medium">{workOrder.marka_agregata || '-'}</p>
    </div>
  </>
) : (
  <>
    <div>
      <span className="text-xs text-muted-foreground">Vozilo</span>
      <p className="font-medium">{workOrder.marka_vozila} {workOrder.model_vozila}</p>
    </div>
    <div>
      <span className="text-xs text-muted-foreground">Tablice</span>
      <p className="font-medium font-mono">{workOrder.registarske_tablice}</p>
    </div>
  </>
)}
```

- [ ] **Step 2: Replace the larger Vozilo section (around line 258-280)**

Find the `<h2>Vozilo</h2>` section and replace the whole block (header + grid of fields) with:

```tsx
{workOrder.tip_naloga === 'agregat' ? (
  <section>
    <h2 className="text-lg font-medium text-foreground mb-4">Agregat</h2>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <span className="text-xs text-muted-foreground">Tip</span>
        <p className="font-medium">{getTipAgregataLabel(workOrder.tip_agregata)}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Marka</span>
        <p className="font-medium">{workOrder.marka_agregata || '-'}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Model</span>
        <p className="font-medium">{workOrder.model_agregata || '-'}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Serijski broj</span>
        <p className="font-medium font-mono">{workOrder.serijski_broj || '-'}</p>
      </div>
    </div>
  </section>
) : (
  <section>
    <h2 className="text-lg font-medium text-foreground mb-4">Vozilo</h2>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <span className="text-xs text-muted-foreground">Marka</span>
        <p className="font-medium">{workOrder.marka_vozila}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Model</span>
        <p className="font-medium">{workOrder.model_vozila}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Tablice</span>
        <p className="font-medium font-mono">{workOrder.registarske_tablice}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">VIN</span>
        <p className="font-medium font-mono">{workOrder.vin_broj || '-'}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Motor</span>
        <p className="font-medium">{workOrder.motor || '-'}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Kilometraža</span>
        <p className="font-medium">{workOrder.kilometraza ?? '-'}</p>
      </div>
    </div>
  </section>
)}
```

(Inspect the original file around lines 258-280 for any extra fields like motor/VIN/km — keep those that were there.)

- [ ] **Step 3: Update the title bar to show tip**

Locate the title (something like `<h1>Nalog {workOrder.broj_naloga}</h1>`). Append the tip:

```tsx
<h1 className="...">Nalog {workOrder.broj_naloga} · {getTipNalogaLabel(workOrder.tip_naloga)}</h1>
```

Add `getTipNalogaLabel`, `getTipAgregataLabel` to the formatters import at the top of the file.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep "WorkOrderDetail" | head`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/work-orders/WorkOrderDetail.tsx
git commit -m "WorkOrderDetail: conditional Vozilo/Agregat sections"
```

---

## Task 10: Update WorkOrderPDF — conditional VOZILO/AGREGAT block

**Files:**
- Modify: `src/components/pdf/WorkOrderPDF.tsx`

- [ ] **Step 1: Locate the VOZILO section in the PDF**

Run: `grep -n "Vozilo\|VOZILO\|marka_vozila" src/components/pdf/WorkOrderPDF.tsx | head`

The exact location depends on the PDF layout. There will be a section that renders vehicle fields (marka, model, plates, VIN, etc.).

- [ ] **Step 2: Replace the vehicle block with conditional rendering**

Wrap the existing vehicle block in `{workOrder.tip_naloga !== 'agregat' && ( ... )}`, and add an alternative agregat block:

```tsx
{workOrder.tip_naloga === 'agregat' ? (
  <View style={styles.section}>
    <Text style={styles.sectionHeader}>AGREGAT</Text>
    <View style={styles.row}>
      <Text style={styles.label}>Tip:</Text>
      <Text style={styles.value}>{getTipAgregataLabel(workOrder.tip_agregata)}</Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.label}>Marka:</Text>
      <Text style={styles.value}>{workOrder.marka_agregata || '-'}</Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.label}>Model:</Text>
      <Text style={styles.value}>{workOrder.model_agregata || '-'}</Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.label}>Serijski broj:</Text>
      <Text style={styles.value}>{workOrder.serijski_broj || '-'}</Text>
    </View>
  </View>
) : (
  /* existing VOZILO block goes here */
)}
```

Match the existing style/structure of the file — the snippet above uses `@react-pdf/renderer` patterns (`View`, `Text`, `styles`) which are already in the file.

Add `getTipAgregataLabel` to the formatters import in this file.

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep "WorkOrderPDF" | head`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pdf/WorkOrderPDF.tsx
git commit -m "WorkOrderPDF: conditional VOZILO/AGREGAT block"
```

---

## Task 11: Wire up routing in App.tsx for both create flows

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a new page state and route handlers**

In `src/App.tsx`, change the `Page` type (around line 18) to:

```ts
type Page =
  | "work-orders"
  | "work-orders-new-auto"
  | "work-orders-new-agregat"
  | "work-orders-edit"
  | "work-orders-detail"
  | "customers"
  | "customers-detail"
  | "mechanics"
  | "analytics"
  | "users";
```

(Replaced `work-orders-new` with two specific variants.)

In the `handleHash` effect, replace the new-route branch:

```tsx
      if (mainPage === "work-orders" && subPage === "new" && id === "auto") {
        setPage("work-orders-new-auto");
        setSelectedWorkOrderId(null);
        setSelectedCustomerId(null);
      } else if (mainPage === "work-orders" && subPage === "new" && id === "agregat") {
        setPage("work-orders-new-agregat");
        setSelectedWorkOrderId(null);
        setSelectedCustomerId(null);
      } else if (mainPage === "work-orders" && subPage === "new") {
        // Backward compat: old "new" links default to auto
        setPage("work-orders-new-auto");
        setSelectedWorkOrderId(null);
        setSelectedCustomerId(null);
      }
```

(Insert this in place of the existing `mainPage === "work-orders" && subPage === "new"` branch. Keep the rest of the `if/else if` chain intact.)

- [ ] **Step 2: Update the WorkOrderList call site**

In `renderContent`, find the `case "work-orders":` block and replace it:

```tsx
      case "work-orders":
        return (
          <WorkOrderList
            onNewAuto={() => navigate("work-orders/new/auto")}
            onNewAgregat={() => navigate("work-orders/new/agregat")}
            onView={(id) => navigate(`work-orders/view/${id}`)}
            onEdit={(id) => navigate(`work-orders/edit/${id}`)}
            onPrintPDF={handlePrintPDF}
          />
        );
```

- [ ] **Step 3: Replace the `case "work-orders-new":` block with two cases**

```tsx
      case "work-orders-new-auto":
        return (
          <WorkOrderForm
            onBack={() => navigate("work-orders")}
            onSaved={(workOrder) => navigate(`work-orders/view/${workOrder.id}`)}
          />
        );

      case "work-orders-new-agregat":
        return (
          <AgregatWorkOrderForm
            onBack={() => navigate("work-orders")}
            onSaved={(workOrder) => navigate(`work-orders/view/${workOrder.id}`)}
          />
        );
```

- [ ] **Step 4: Update the edit case to dispatch to the right form based on `tip_naloga`**

The edit page needs to fetch the work order to know its tip, then render the right form. The simplest approach: load the work order in the dispatcher and branch.

Add to imports at the top:

```tsx
import { AgregatWorkOrderForm } from "@/components/work-orders/AgregatWorkOrderForm";
```

Add a state for the loaded edit-target tip:

```tsx
  const [editTipNaloga, setEditTipNaloga] = useState<'auto' | 'agregat' | null>(null);
```

In the `handleHash` effect, when navigating to edit, also fetch the tip:

```tsx
      } else if (mainPage === "work-orders" && subPage === "edit" && id) {
        setSelectedWorkOrderId(parseInt(id));
        setSelectedCustomerId(null);
        setPage("work-orders-edit");
        setEditTipNaloga(null); // reset; will be set by effect below
      }
```

Add a new `useEffect` after the hash effect that loads the tip for edit:

```tsx
  useEffect(() => {
    if (page === "work-orders-edit" && selectedWorkOrderId !== null) {
      workOrdersApi.getById(selectedWorkOrderId).then(result => {
        if (result.success && result.data) {
          setEditTipNaloga(result.data.tip_naloga);
        }
      });
    }
  }, [page, selectedWorkOrderId]);
```

Replace the `case "work-orders-edit":` block:

```tsx
      case "work-orders-edit":
        if (editTipNaloga === 'agregat') {
          return (
            <AgregatWorkOrderForm
              workOrderId={selectedWorkOrderId || undefined}
              onBack={() =>
                selectedWorkOrderId
                  ? navigate(`work-orders/view/${selectedWorkOrderId}`)
                  : navigate("work-orders")
              }
              onSaved={(workOrder) => navigate(`work-orders/view/${workOrder.id}`)}
            />
          );
        }
        // default to auto when tip not yet loaded or auto
        return (
          <WorkOrderForm
            workOrderId={selectedWorkOrderId || undefined}
            onBack={() =>
              selectedWorkOrderId
                ? navigate(`work-orders/view/${selectedWorkOrderId}`)
                : navigate("work-orders")
            }
            onSaved={(workOrder) => navigate(`work-orders/view/${workOrder.id}`)}
          />
        );
```

- [ ] **Step 5: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep -v "^build.ts" | grep -v "No index signature" | grep -v "type 'Partial" | head -20`
Expected: empty (all client-side errors resolved).

- [ ] **Step 6: Run dev server briefly**

```bash
PORT=3099 bun --hot src/index.ts > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 3
curl -s http://localhost:3099/ | head -c 200
kill $SERVER_PID; wait 2>/dev/null
tail -3 /tmp/server.log
```

Expected: HTML returned, no startup or bundle errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "Wire up routing for auto and agregat create/edit flows"
```

---

## Task 12: Manual E2E verification

This task is non-coding. Perform with a real DB (or a copy of production data).

- [ ] **Step 1: Verify backup file is created on first run**

```bash
# Take a snapshot of pre-existing backups
ls data/asnord.db.bak-* 2>/dev/null > /tmp/before-bak.txt

# Run server
PORT=3099 bun --hot src/index.ts &
SERVER_PID=$!
sleep 5

# New backup should exist
ls data/asnord.db.bak-* 2>/dev/null > /tmp/after-bak.txt
diff /tmp/before-bak.txt /tmp/after-bak.txt   # should show one new line

kill $SERVER_PID; wait 2>/dev/null
```

Expected: a new `.bak-<timestamp>` file appears.

- [ ] **Step 2: Walk through the UI**

Open the app in a browser. Log in as admin. Verify:

1. Existing auto naloge open and render normally (Vozilo section visible).
2. Click "Novi auto nalog" → existing form appears, save creates an Auto nalog with badge.
3. Click "Novi agregat nalog" → AgregatWorkOrderForm appears.
4. Create an agregat nalog: customer = X, tip = "Alnaser", marka = "Bosch", serijski = "SN-12345". Save.
5. New nalog appears in the list with "Agregat" badge and `Alnaser · Bosch` description.
6. Filter "Agregat" → only your agregat order is shown.
7. Filter "Auto" → only auto orders are shown.
8. Open the agregat nalog → "Agregat" section renders, no "Vozilo" section.
9. Edit the agregat nalog → AgregatWorkOrderForm preloads with current values, save persists changes.
10. Edit an auto nalog → WorkOrderForm (auto) preloads.
11. Add a part item to the agregat nalog (regular flow) → works.
12. Skeniraj račun on the agregat nalog → works.
13. Print PDF for the agregat nalog → header shows "AGREGAT" block, no VOZILO.
14. Export CSV → contains `tip_naloga`, `tip_agregata`, etc. columns.
15. Try to switch tip via direct PUT (curl): server rejects with 400.

- [ ] **Step 3: Run full test suite**

Run: `bun test 2>&1 | tail -5`
Expected: all pass (33 tests across 3 files).

- [ ] **Step 4: Final type-check**

Run: `bunx tsc --noEmit 2>&1 | grep -v "^build.ts" | grep -v "No index signature" | grep -v "type 'Partial" | head -10`
Expected: empty.

- [ ] **Step 5: If everything passes, no further commit. Otherwise stage and commit fixes.**

---

## Self-review notes

- **Spec coverage**: every spec section maps to a task — schema migration + backup (Task 1), types (Task 2), validation (Task 3), search/filter (Task 3), CSV (Task 4), labels (Task 5), forms (Tasks 6, 7), list (Task 8), detail (Task 9), PDF (Task 10), routing (Task 11), E2E (Task 12).
- **Placeholder scan**: each step has full code or exact commands. The only "depends on existing code" notes are in Task 8 (cache key) and Task 10 (PDF style). These are necessary because the existing files use specific patterns the implementer must preserve — full rewrite would be over-reach.
- **Type consistency**: `WorkOrderFormAuto`/`WorkOrderFormAgregat` defined in Task 2 are used identically in Tasks 6, 7. `getTipNalogaLabel`/`getTipAgregataLabel` defined in Task 5 are used in Tasks 8, 9, 10 with the same signature.
- **Migration safety**: backup runs before any DDL, fails-fast if backup fails. NOT NULL columns are never relaxed; agregat orders use empty strings — confirmed throughout.
- **Test isolation**: `DB_PATH=:memory:` set before any `getDB()` call (carried over from existing test pattern).
- **Edit flow**: `App.tsx` loads tip before rendering edit form, defaults to auto if not loaded — avoids flicker but tolerates slow load.
- **`WorkOrderForm` is NOT renamed**: a deliberate departure from the spec to minimize import churn. The spec said "rename" but the change in this plan is "thread the discriminator through the existing file" which is functionally equivalent.
