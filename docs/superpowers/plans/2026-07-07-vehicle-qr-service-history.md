# Javna servisna historija vozila (QR) — Implementacioni plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Za svako vozilo omogućiti štampanje PDF-a sa QR kodom koji vodi na javnu stranicu sa servisnom historijom tog auta, bez cijena i bez ličnih podataka.

**Architecture:** Nova tabela `vehicle_public_tokens` mapira nasumični token na `vehicle_id`. Autentificirani endpoint kreira/vraća token; javni (bez auth-a) endpoint vraća sanitizovanu historiju grupisanu po VIN-u (fallback tablice). Frontend: javna React stranica na pravom path-u `/s/:token` (zaobilazi hash-routing i login gate), plus dugme "Printaj QR karticu" po vozilu na `CustomerDetail` koje generiše QR (biblioteka `qrcode`) i PDF (`@react-pdf`).

**Tech Stack:** Bun, `bun:sqlite`, React 19, `@react-pdf/renderer`, `qrcode`, Tailwind, shadcn/ui, `bun test`.

## Global Constraints

- Runtime i alati: **Bun** (`bun test`, `bun add`, `bunx`). Ne koristiti npm/node.
- Sav korisnički tekst na **bosanskom** (dijakritici čćžšđ dozvoljeni).
- API handleri vraćaju `Response`/`Response.json(...)`; auth preko `requireAuth`/`validateCsrf` iz `src/api/auth.ts`.
- Testovi postavljaju `process.env.DB_PATH = ":memory:"` PRIJE poziva `getDB()`, i koriste `closeDB()` u `beforeEach` (obrazac iz `src/api/settings.test.ts`).
- Ruteri parsiraju `:params` ručno iz `url.pathname.split('/')` (Bun `routes` prosljeđuju sirovi `Request`).
- Javni endpoint i javna stranica **NE smiju** izložiti: bilo koje polje cijene (`jedinicna_cijena`, `popust`, `ukupna_cijena`), `napomena`, `broj_naloga`, `vin_broj`, niti podatke o klijentu (`ime`, `prezime`, `telefon`, `email`, `naziv_firme`).
- Stil UI-a: bez okvira/bordera gdje je moguće, jednostavno, mobilno-prvo.

---

### Task 1: DB tabela `vehicle_public_tokens` + tipovi

**Files:**
- Modify: `src/db/schema.ts` (dodati CREATE TABLE prije reda sa `-- Indexes`)
- Modify: `src/types/index.ts` (dodati tipove na kraj fajla)
- Test: `src/api/vehicle-tokens.test.ts` (novi — samo prvi test u ovom tasku)

**Interfaces:**
- Produces: tabela `vehicle_public_tokens(token TEXT PK, vehicle_id INTEGER UNIQUE NOT NULL, created_at TEXT)`.
- Produces tipovi:
  - `PublicServiceVisitItem { tip: 'dio' | 'usluga'; naziv: string; kolicina: number }`
  - `PublicServiceVisit { datum: string; kilometraza: number | null; opis_kvara: string | null; mehanicar: string | null; items: PublicServiceVisitItem[] }`
  - `PublicServiceHistoryData { company: { naziv: string | null; logo: string | null }; vehicle: { marka_vozila: string; model_vozila: string; registarske_tablice: string }; visits: PublicServiceVisit[] }`

- [ ] **Step 1: Write the failing test**

Create `src/api/vehicle-tokens.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";

process.env.DB_PATH = ":memory:";

beforeEach(() => {
  closeDB();
  getDB();
});

test("schema: vehicle_public_tokens table exists", () => {
  const db = getDB();
  const cols = db.query<{ name: string }, []>(
    "PRAGMA table_info(vehicle_public_tokens)"
  ).all();
  const names = cols.map((c) => c.name).sort();
  expect(names).toEqual(["created_at", "token", "vehicle_id"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/vehicle-tokens.test.ts`
Expected: FAIL — `PRAGMA table_info` returns empty array, `names` is `[]`.

- [ ] **Step 3: Add the table to schema**

In `src/db/schema.ts`, insert BEFORE the `-- Indexes for search optimization` comment:

```sql
-- Public QR tokens for vehicle service history (one token per vehicle)
CREATE TABLE IF NOT EXISTS vehicle_public_tokens (
  token TEXT PRIMARY KEY,
  vehicle_id INTEGER NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);
```

And add to the indexes block (after `idx_vehicles_customer`):

```sql
CREATE INDEX IF NOT EXISTS idx_vehicle_tokens_vehicle ON vehicle_public_tokens(vehicle_id);
```

- [ ] **Step 4: Add types**

Append to `src/types/index.ts`:

```ts
// Public service history (QR) types
export interface PublicServiceVisitItem {
  tip: 'dio' | 'usluga';
  naziv: string;
  kolicina: number;
}

export interface PublicServiceVisit {
  datum: string;
  kilometraza: number | null;
  opis_kvara: string | null;
  mehanicar: string | null;
  items: PublicServiceVisitItem[];
}

export interface PublicServiceHistoryData {
  company: { naziv: string | null; logo: string | null };
  vehicle: { marka_vozila: string; model_vozila: string; registarske_tablice: string };
  visits: PublicServiceVisit[];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/api/vehicle-tokens.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/types/index.ts src/api/vehicle-tokens.test.ts
git commit -m "feat: add vehicle_public_tokens table and public history types"
```

---

### Task 2: `createVehiclePublicToken` endpoint (idempotentan)

**Files:**
- Create: `src/api/vehicle-tokens.ts`
- Test: `src/api/vehicle-tokens.test.ts` (dodati testove)

**Interfaces:**
- Consumes: `requireAuth`, `validateCsrf` iz `./auth`; `getDB` iz `../db`.
- Produces: `export function createVehiclePublicToken(req: Request): Response` — handler za `POST /api/vehicles/:id/public-token`, vraća `{ token: string }` (200) ili `{ message }` (401/403/404).

- [ ] **Step 1: Write the failing tests**

Add to `src/api/vehicle-tokens.test.ts` (ispod postojećeg testa). Prvo proširi `beforeEach` da seedira admin sesiju i jedno vozilo, pa dodaj testove:

```ts
import { createVehiclePublicToken } from "./vehicle-tokens";

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
```

Note: ukloni prvi (schema) test-ov `beforeEach` iz Taska 1 — sada ga zamjenjuje ovaj prošireni `beforeEach`. Schema test i dalje prolazi jer tabela postoji.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/vehicle-tokens.test.ts`
Expected: FAIL — `Cannot find module './vehicle-tokens'` (fajl još ne postoji).

- [ ] **Step 3: Implement the endpoint**

Create `src/api/vehicle-tokens.ts`:

```ts
import { getDB } from '../db';
import { requireAuth, validateCsrf } from './auth';

// Generate a random, non-guessable public token (16 hex chars).
function generatePublicToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// POST /api/vehicles/:id/public-token - Create or return the public QR token for a vehicle
export function createVehiclePublicToken(req: Request): Response {
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  // Path: /api/vehicles/:id/public-token -> id is second-to-last segment
  const parts = new URL(req.url).pathname.split('/');
  const vehicleId = parseInt(parts[parts.length - 2] || '0');

  const db = getDB();
  const vehicle = db.query<{ id: number }, [number]>(
    'SELECT id FROM vehicles WHERE id = ?'
  ).get(vehicleId);
  if (!vehicle) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  const existing = db.query<{ token: string }, [number]>(
    'SELECT token FROM vehicle_public_tokens WHERE vehicle_id = ?'
  ).get(vehicleId);
  if (existing) {
    return Response.json({ token: existing.token });
  }

  const token = generatePublicToken();
  db.query<null, [string, number]>(
    'INSERT INTO vehicle_public_tokens (token, vehicle_id) VALUES (?, ?)'
  ).run(token, vehicleId);

  return Response.json({ token });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/vehicle-tokens.test.ts`
Expected: PASS (4 testa).

- [ ] **Step 5: Commit**

```bash
git add src/api/vehicle-tokens.ts src/api/vehicle-tokens.test.ts
git commit -m "feat: add authenticated endpoint to create vehicle public QR token"
```

---

### Task 3: `getPublicServiceHistory` endpoint (grupisanje + sanitizacija) + rute

**Files:**
- Modify: `src/api/vehicle-tokens.ts` (dodati handler)
- Modify: `src/index.ts` (import + registracija ruta)
- Test: `src/api/vehicle-tokens.test.ts` (dodati testove)

**Interfaces:**
- Consumes: `getDB`; tipovi `PublicServiceHistoryData` iz `../types`.
- Produces: `export function getPublicServiceHistory(req: Request): Response` — handler za `GET /api/public/service-history/:token`; **bez auth-a**. Vraća `PublicServiceHistoryData` (200) ili `{ message }` (404).

- [ ] **Step 1: Write the failing tests**

Add to `src/api/vehicle-tokens.test.ts`:

```ts
import { getPublicServiceHistory } from "./vehicle-tokens";

function publicReq(token: string): Request {
  // No cookies, no CSRF — public endpoint
  return new Request(`http://localhost/api/public/service-history/${token}`, { method: "GET" });
}

// Helper: insert a work order for the seeded vehicle's VIN
function insertOrder(opts: { broj: string; vin: string | null; plates: string; km: number | null; opis: string }): number {
  const db = getDB();
  const wo = db.query<{ id: number }, [string, number, string, string | null, string, string, number | null, string]>(
    `INSERT INTO work_orders (broj_naloga, customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila, kilometraza, opis_kvara)
     VALUES (?, (SELECT id FROM customers LIMIT 1), ?, ?, 'VW', 'Golf', ?, ?) RETURNING id`
  ).get(opts.broj, opts.plates, opts.vin, opts.km, opts.opis)!;
  return wo.id;
}

test("getPublicServiceHistory: 404 for unknown token", () => {
  const res = getPublicServiceHistory(publicReq("nope"));
  expect(res.status).toBe(404);
});

test("getPublicServiceHistory: groups orders by VIN and omits prices/personal data", async () => {
  const db = getDB();
  // Two orders, same VIN, different plates -> both must appear
  const wo1 = insertOrder({ broj: "2026-0001", vin: "VIN123456789", plates: "A12-B-345", km: 100000, opis: "Servis kočnica" });
  insertOrder({ broj: "2026-0002", vin: "VIN123456789", plates: "NEW-PLATE", km: 110000, opis: "Zamjena ulja" });
  db.query<null, [string, string, number, number, number]>(
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/vehicle-tokens.test.ts`
Expected: FAIL — `getPublicServiceHistory` is not exported.

- [ ] **Step 3: Implement the handler**

Append to `src/api/vehicle-tokens.ts`:

```ts
import type { PublicServiceHistoryData, PublicServiceVisit } from '../types';

interface VehicleRow {
  id: number;
  registarske_tablice: string;
  vin_broj: string | null;
  marka_vozila: string;
  model_vozila: string;
}

interface OrderRow {
  id: number;
  created_at: string;
  kilometraza: number | null;
  opis_kvara: string | null;
  mech_ime: string | null;
  mech_prezime: string | null;
}

// GET /api/public/service-history/:token - Public, sanitized service history (no auth)
export function getPublicServiceHistory(req: Request): Response {
  const token = new URL(req.url).pathname.split('/').pop() || '';
  const db = getDB();

  const link = db.query<{ vehicle_id: number }, [string]>(
    'SELECT vehicle_id FROM vehicle_public_tokens WHERE token = ?'
  ).get(token);
  if (!link) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  const vehicle = db.query<VehicleRow, [number]>(
    'SELECT id, registarske_tablice, vin_broj, marka_vozila, model_vozila FROM vehicles WHERE id = ?'
  ).get(link.vehicle_id);
  if (!vehicle) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  // Group by VIN when present, otherwise fall back to plates.
  const matchByVin = !!vehicle.vin_broj;
  const orders = db.query<OrderRow, [string]>(
    `SELECT wo.id, wo.created_at, wo.kilometraza, wo.opis_kvara,
            m.ime as mech_ime, m.prezime as mech_prezime
     FROM work_orders wo
     LEFT JOIN mechanics m ON wo.mechanic_id = m.id
     WHERE wo.tip_naloga = 'auto' AND wo.${matchByVin ? 'vin_broj' : 'registarske_tablice'} = ?
     ORDER BY wo.created_at DESC`
  ).all(matchByVin ? vehicle.vin_broj! : vehicle.registarske_tablice);

  const itemStmt = db.query<{ tip: 'dio' | 'usluga'; naziv: string; kolicina: number }, [number]>(
    'SELECT tip, naziv, kolicina FROM work_order_items WHERE work_order_id = ?'
  );

  const visits: PublicServiceVisit[] = orders.map((o) => ({
    datum: o.created_at,
    kilometraza: o.kilometraza,
    opis_kvara: o.opis_kvara,
    mehanicar: o.mech_ime ? `${o.mech_ime} ${o.mech_prezime ?? ''}`.trim() : null,
    items: itemStmt.all(o.id).map((it) => ({ tip: it.tip, naziv: it.naziv, kolicina: it.kolicina })),
  }));

  const company = db.query<{ naziv: string | null; logo: string | null }, []>(
    'SELECT naziv, logo FROM company_settings WHERE id = 1'
  ).get() ?? { naziv: null, logo: null };

  const payload: PublicServiceHistoryData = {
    company,
    vehicle: {
      marka_vozila: vehicle.marka_vozila,
      model_vozila: vehicle.model_vozila,
      registarske_tablice: vehicle.registarske_tablice,
    },
    visits,
  };

  return Response.json(payload);
}
```

- [ ] **Step 4: Register the routes**

In `src/index.ts`, add the import near the other API imports:

```ts
import {
  createVehiclePublicToken,
  getPublicServiceHistory,
} from "./api/vehicle-tokens";
```

Add the token route inside the Vehicles API block (after the `/api/vehicles/:id` route):

```ts
    "/api/vehicles/:id/public-token": {
      POST: createVehiclePublicToken,
    },
```

Add a new public block after the Company settings block (before the PWA static files):

```ts
    // Public service history (no auth)
    "/api/public/service-history/:token": {
      GET: getPublicServiceHistory,
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/api/vehicle-tokens.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/api/vehicle-tokens.ts src/index.ts src/api/vehicle-tokens.test.ts
git commit -m "feat: add public service-history endpoint (VIN grouping, sanitized)"
```

---

### Task 4: `qrcode` dependency + `VehicleQRPDF` komponenta

**Files:**
- Modify: `package.json` (preko `bun add`)
- Create: `src/components/pdf/VehicleQRPDF.tsx`
- Modify: `src/lib/api.ts` (dodati `vehiclesApi.createPublicToken`)

**Interfaces:**
- Consumes: `Vehicle`, `CompanySettings` iz `@/types`.
- Produces:
  - `export async function generateVehicleQRPDF(vehicle: Vehicle, company: CompanySettings | null | undefined, qrDataUrl: string, url: string): Promise<void>` — generiše i preuzima PDF.
  - `vehiclesApi.createPublicToken(id: number): Promise<ApiResponse<{ token: string }>>`

- [ ] **Step 1: Add dependencies**

Run:

```bash
bun add qrcode
bun add -d @types/qrcode
```

Expected: `package.json` dependencies sadrži `qrcode`, devDependencies `@types/qrcode`.

- [ ] **Step 2: Add the API client method**

In `src/lib/api.ts`, add to the `vehiclesApi` object (after `delete`):

```ts
  createPublicToken: (id: number) =>
    fetchApi<{ token: string }>(`/vehicles/${id}/public-token`, { method: 'POST' }),
```

- [ ] **Step 3: Create the PDF component**

Create `src/components/pdf/VehicleQRPDF.tsx`:

```tsx
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  pdf,
  Font,
} from "@react-pdf/renderer";
import type { Vehicle, CompanySettings } from "@/types";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf", fontWeight: "normal" },
    { src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf", fontWeight: "bold" },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: "Roboto", fontSize: 11, alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 40 },
  logo: { width: 48, height: 48, objectFit: "contain" },
  companyName: { fontSize: 16, fontWeight: "bold" },
  companyDetail: { fontSize: 9, color: "#666" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 6, textAlign: "center" },
  vehicle: { fontSize: 14, color: "#333", marginBottom: 4, textAlign: "center" },
  plates: { fontSize: 12, color: "#666", marginBottom: 30, textAlign: "center" },
  qr: { width: 260, height: 260, marginBottom: 24 },
  instruction: { fontSize: 12, textAlign: "center", maxWidth: 340, marginBottom: 16, color: "#333" },
  url: { fontSize: 9, color: "#888", textAlign: "center" },
  footer: { position: "absolute", bottom: 30, left: 48, right: 48, textAlign: "center", color: "#999", fontSize: 8 },
});

function canRenderLogo(logo: string | null | undefined): logo is string {
  return !!logo && /^data:image\/(png|jpe?g);base64,/.test(logo);
}

interface VehicleQRDocumentProps {
  vehicle: Vehicle;
  company?: CompanySettings | null;
  qrDataUrl: string;
  url: string;
}

function VehicleQRDocument({ vehicle, company, qrDataUrl, url }: VehicleQRDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {company && (company.naziv || canRenderLogo(company.logo)) && (
          <View style={styles.header}>
            {canRenderLogo(company.logo) && <Image style={styles.logo} src={company.logo!} />}
            <View>
              {company.naziv && <Text style={styles.companyName}>{company.naziv}</Text>}
              {company.telefon && <Text style={styles.companyDetail}>Tel: {company.telefon}</Text>}
            </View>
          </View>
        )}

        <Text style={styles.title}>Servisna historija vozila</Text>
        <Text style={styles.vehicle}>{vehicle.marka_vozila} {vehicle.model_vozila}</Text>
        <Text style={styles.plates}>{vehicle.registarske_tablice}</Text>

        <Image style={styles.qr} src={qrDataUrl} />

        <Text style={styles.instruction}>
          Skenirajte QR kod telefonom za uvid u kompletnu servisnu historiju ovog vozila.
        </Text>
        <Text style={styles.url}>{url}</Text>

        <Text style={styles.footer}>AS-NORD Nalozi | Automatski generisano</Text>
      </Page>
    </Document>
  );
}

export async function generateVehicleQRPDF(
  vehicle: Vehicle,
  company: CompanySettings | null | undefined,
  qrDataUrl: string,
  url: string
): Promise<void> {
  const blob = await pdf(
    <VehicleQRDocument vehicle={vehicle} company={company} qrDataUrl={qrDataUrl} url={url} />
  ).toBlob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `qr-servisna-historija-${vehicle.registarske_tablice}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/components/pdf/VehicleQRPDF.tsx src/lib/api.ts
git commit -m "feat: add qrcode dep and VehicleQRPDF printable card"
```

---

### Task 5: Javna stranica `PublicServiceHistory` + routing u `App.tsx`

**Files:**
- Create: `src/components/public/PublicServiceHistory.tsx`
- Modify: `src/App.tsx` (public routing prije auth gate-a)

**Interfaces:**
- Consumes: `PublicServiceHistoryData` iz `@/types`.
- Produces: `export function PublicServiceHistory({ token }: { token: string })` — samostalna stranica koja fetch-a `/api/public/service-history/:token`.

- [ ] **Step 1: Create the public page component**

Create `src/components/public/PublicServiceHistory.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { PublicServiceHistoryData } from "@/types";

function formatDate(dateString: string): string {
  const d = new Date(dateString);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getFullYear()}`;
}

function canRenderLogo(logo: string | null): logo is string {
  return !!logo && /^data:image\//.test(logo);
}

export function PublicServiceHistory({ token }: { token: string }) {
  const [data, setData] = useState<PublicServiceHistoryData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");

  useEffect(() => {
    fetch(`/api/public/service-history/${encodeURIComponent(token)}`)
      .then((res) => {
        if (!res.ok) throw new Error("notfound");
        return res.json();
      })
      .then((d: PublicServiceHistoryData) => {
        setData(d);
        setStatus("ok");
      })
      .catch(() => setStatus("notfound"));
  }, [token]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Učitavanje...
      </div>
    );
  }

  if (status === "notfound" || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-muted-foreground">Vozilo nije pronađeno.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          {canRenderLogo(data.company.logo) && (
            <img src={data.company.logo} alt="" className="h-10 w-10 object-contain" />
          )}
          {data.company.naziv && (
            <span className="text-lg font-semibold">{data.company.naziv}</span>
          )}
        </div>

        {/* Vehicle */}
        <h1 className="text-2xl font-bold mb-1">Servisna historija vozila</h1>
        <p className="text-lg">
          {data.vehicle.marka_vozila} {data.vehicle.model_vozila}
        </p>
        <p className="text-muted-foreground font-mono mb-8">
          {data.vehicle.registarske_tablice}
        </p>

        {/* Visits */}
        {data.visits.length === 0 ? (
          <p className="text-muted-foreground py-8">Nema zabilježenih servisa.</p>
        ) : (
          <div className="space-y-6">
            {data.visits.map((v, i) => (
              <div key={i} className="pb-6 border-b border-border last:border-0">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-semibold">{formatDate(v.datum)}</span>
                  {v.kilometraza != null && (
                    <span className="text-sm text-muted-foreground">
                      {v.kilometraza.toLocaleString("de-DE")} km
                    </span>
                  )}
                </div>
                {v.opis_kvara && <p className="text-sm mb-2">{v.opis_kvara}</p>}
                {v.items.length > 0 && (
                  <ul className="text-sm text-muted-foreground space-y-0.5">
                    {v.items.map((it, j) => (
                      <li key={j}>
                        {it.tip === "dio" ? "Dio" : "Usluga"}: {it.naziv}
                        {it.kolicina > 1 ? ` ×${it.kolicina}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {v.mehanicar && (
                  <p className="text-xs text-muted-foreground mt-2">Mehaničar: {v.mehanicar}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire public routing in App.tsx**

In `src/App.tsx`, add the import at the top with the other component imports:

```ts
import { PublicServiceHistory } from "@/components/public/PublicServiceHistory";
```

Replace the `export function App()` definition with:

```tsx
export function App() {
  // Public QR page: real path /s/:token, bypasses auth + hash routing entirely
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/s/")) {
    const token = window.location.pathname.slice(3).replace(/\/$/, "");
    return <PublicServiceHistory token={token} />;
  }

  return (
    <AuthProvider>
      <CompanySettingsProvider>
        <AppContent />
      </CompanySettingsProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run the app: `bun run dev`. In another terminal create a token:

```bash
# Log in to get a session + CSRF (admin/admin123), then create a token for vehicle 1.
# Easiest: use the browser once Task 6 is done. For now verify the page renders "Vozilo nije pronađeno":
```

Open `http://localhost:3000/s/nepostojeci` in the browser.
Expected: stranica prikazuje "Vozilo nije pronađeno." (bez login ekrana).

- [ ] **Step 5: Commit**

```bash
git add src/components/public/PublicServiceHistory.tsx src/App.tsx
git commit -m "feat: add public service-history page bypassing auth at /s/:token"
```

---

### Task 6: "Vozila" sekcija + dugme "Printaj QR karticu" na `CustomerDetail`

**Files:**
- Modify: `src/components/customers/CustomerDetail.tsx`

**Interfaces:**
- Consumes: `vehiclesApi.createPublicToken`, `vehiclesApi.getByCustomer` iz `@/lib/api`; `generateVehicleQRPDF` iz `@/components/pdf/VehicleQRPDF`; `useCompanySettings` iz `@/contexts/CompanySettingsContext`; default import `QRCode from "qrcode"`; `Vehicle` iz `@/types`.
- Produces: vizuelna "Vozila" sekcija s dugmetom po vozilu koje generiše QR PDF.

- [ ] **Step 1: Add imports**

In `src/components/customers/CustomerDetail.tsx`, extend imports:

```ts
import { useState, useEffect } from "react";
import { ArrowLeft, Pencil, FileText, Eye, QrCode, Car } from "lucide-react";
import QRCode from "qrcode";
import { customersApi, workOrdersApi, vehiclesApi } from "@/lib/api";
import { generateVehicleQRPDF } from "@/components/pdf/VehicleQRPDF";
import { useCompanySettings } from "@/contexts/CompanySettingsContext";
import type { Customer, WorkOrder, Vehicle } from "@/types";
```

(Keep the existing `Button`, `Badge`, table, `Skeleton`, formatter imports.)

- [ ] **Step 2: Load vehicles and add the print handler**

Inside `CustomerDetail`, add state + effect + handler (after the existing `loading` state and load effect):

```ts
  const { settings: companySettings } = useCompanySettings();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [printingId, setPrintingId] = useState<number | null>(null);

  useEffect(() => {
    vehiclesApi.getByCustomer(customerId).then((res) => {
      if (res.success && res.data) setVehicles(res.data);
    });
  }, [customerId]);

  const handlePrintQR = async (vehicle: Vehicle) => {
    setPrintingId(vehicle.id);
    try {
      const res = await vehiclesApi.createPublicToken(vehicle.id);
      if (!res.success || !res.data) {
        alert(res.error || "Greška pri generisanju QR koda");
        return;
      }
      const url = `${window.location.origin}/s/${res.data.token}`;
      const qrDataUrl = await QRCode.toDataURL(url, { width: 400, margin: 1 });
      await generateVehicleQRPDF(vehicle, companySettings, qrDataUrl, url);
    } finally {
      setPrintingId(null);
    }
  };
```

- [ ] **Step 3: Render the Vozila section**

In the returned JSX, insert this block BETWEEN the "Customer Info & Stats" grid and the "Work Orders" block:

```tsx
      {/* Vehicles */}
      {vehicles.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-foreground flex items-center gap-2 mb-4">
            <Car className="h-5 w-5" />
            Vozila ({vehicles.length})
          </h2>
          <div className="divide-y">
            {vehicles.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-3 gap-4">
                <div>
                  <div className="font-medium">{v.marka_vozila} {v.model_vozila}</div>
                  <div className="text-sm text-muted-foreground font-mono">
                    {v.registarske_tablice}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={printingId === v.id}
                  onClick={() => handlePrintQR(v)}
                >
                  <QrCode className="h-4 w-4 mr-2" />
                  {printingId === v.id ? "Generisanje..." : "Printaj QR karticu"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual end-to-end verification**

Run `bun run dev`, log in (admin/admin123). Open a customer that has a vehicle with work orders (`#customers/view/<id>`).
1. "Vozila" sekcija se prikazuje s dugmetom "Printaj QR karticu".
2. Klik na dugme preuzima PDF sa QR kodom.
3. Skeniraj QR (ili otvori URL iz PDF-a) → javna stranica prikazuje servisnu historiju BEZ cijena i BEZ imena/telefona klijenta.

- [ ] **Step 6: Commit**

```bash
git add src/components/customers/CustomerDetail.tsx
git commit -m "feat: add vehicles section with QR card print on customer detail"
```

---

## Self-Review

**Spec coverage:**
- Pristupni model (bypass login) → Task 5 (App.tsx `/s/` grana). ✅
- Token tabela + generisanje → Task 1 (schema), Task 2 (generisanje/endpoint). ✅
- Javni sanitizovani API + grupisanje po VIN/fallback tablice → Task 3. ✅
- Javna stranica → Task 5. ✅
- QR + PDF papir + dugme na CustomerDetail → Task 4 (PDF/dep), Task 6 (dugme). ✅
- Testovi (idempotentnost, VIN grupisanje, fallback, sanitizacija, 404) → Task 2 + Task 3. ✅
- Van opsega (bez rotacije tokena, bez agregata, bez SSR) → poštovano. ✅

**Placeholder scan:** Nema TBD/TODO; sav kod je konkretan.

**Type consistency:** `createVehiclePublicToken` vraća `{ token }` (Task 2) — isti oblik koristi `vehiclesApi.createPublicToken` (Task 4) i `handlePrintQR` (Task 6). `PublicServiceHistoryData`/`PublicServiceVisit` definisani u Task 1, korišteni u Task 3 (backend) i Task 5 (frontend). `generateVehicleQRPDF(vehicle, company, qrDataUrl, url)` definisan u Task 4, pozvan istim redoslijedom argumenata u Task 6. ✅
