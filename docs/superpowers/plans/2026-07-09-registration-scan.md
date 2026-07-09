# Registration Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph a vehicle registration document ("saobraćajna dozvola"), resolve the vehicle by canonical VIN and the customer by fuzzy name match, then open a prefilled work order.

**Architecture:** A new `POST /api/vehicles/scan-registration` endpoint mirrors the existing `src/api/invoice-scan.ts`: auth + CSRF, multipart image, OpenRouter vision call, strict JSON validation. Matching logic lives in a separate pure module (`registration-match.ts`) with no database and no network, so the rules are unit-testable. The server decides `autoSelect`; the client only renders.

**Tech Stack:** Bun, `bun:sqlite`, `Bun.serve()` routes, React 19, shadcn/ui, OpenRouter (`google/gemini-3.5-flash`), `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-09-registration-scan-design.md`

## Global Constraints

- Bun only. `bun test`, `bun add`, `bunx`. Never npm/jest/vitest.
- Model ID is exactly `google/gemini-3.5-flash`. Do not change the invoice scanner's model.
- Fuzzy matching widens the candidate list; it **never** auto-selects between two candidates.
- Name similarity threshold is exactly `0.72`. VIN near-match distance is exactly `≤ 2`.
- The owner's **address is never extracted**. Only `ime` and `prezime`.
- All user-facing strings are in Bosnian.
- `bunx tsc --noEmit` reports ~8 pre-existing errors in `build.ts`. These are not yours. Ignore them. Introduce no new ones.
- Existing tests must keep passing: `bun test` is currently 49 pass, 0 fail.
- The image-upload and OpenRouter plumbing is shared, not copied. Task 4 extracts `src/api/vision.ts` and moves `invoice-scan.ts` onto it.

## Deviations from the spec (intentional, already reasoned)

1. `decideAutoSelect` takes `(doc, vehicleCandidates)` — **not** `customerCandidates`. The spec listed a third parameter, but the customer candidate list must never influence auto-selection. Dropping the parameter makes that rule unforgeable rather than merely documented.
2. The spec's "document with no VIN and no plates → 422" test is implemented as a unit test on the exported pure guard `hasUsableIdentifier()`, because testing it through the handler would require a live OpenRouter call.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/index.ts` (modify) | Shared types for the scan payload |
| `src/api/registration-match.ts` (create) | Pure matching: normalization, Levenshtein, candidates, auto-select |
| `src/api/registration-match.test.ts` (create) | Unit tests, no DB, no network |
| `src/api/vision.ts` (create) | Shared image upload + OpenRouter vision call |
| `src/api/invoice-scan.ts` (modify) | Export `stripFences`; move onto the shared helper |
| `src/api/registration-scan.ts` (create) | HTTP handler: auth, image, OpenRouter, DB lookup, response |
| `src/api/registration-scan.test.ts` (create) | Parser + guard + handler auth/config tests |
| `src/index.ts` (modify) | Route registration |
| `src/lib/api.ts` (modify) | `registrationScanApi.scan(file)` |
| `src/components/vehicles/RegistrationScanDialog.tsx` (create) | Scan → review → confirm UI |
| `src/components/work-orders/WorkOrderList.tsx` (modify) | "Skeniraj saobraćajnu" button |
| `src/components/work-orders/WorkOrderForm.tsx` (modify) | Optional `prefill` prop |
| `src/App.tsx` (modify) | Hold prefill between list and form |

---

### Task 1: Types and normalization primitives

**Files:**
- Modify: `src/types/index.ts` (append at end of file)
- Create: `src/api/registration-match.ts`
- Test: `src/api/registration-match.test.ts`

**Interfaces:**
- Consumes: `Vehicle`, `Customer` from `src/types/index.ts`
- Produces: types `ScannedRegistration`, `VehicleMatchKind`, `VehicleCandidateCustomer`, `VehicleCandidate`, `CustomerCandidate`, `ScanRegistrationResponse`; functions `canonicalVin(raw: string): string`, `normalizePlates(raw: string): string`, `normalizeName(raw: string): string`, `levenshtein(a: string, b: string): number`, `similarity(a: string, b: string): number`

- [ ] **Step 1: Append the types**

Append to the end of `src/types/index.ts`:

```ts
// Registration document scan (saobraćajna) types
export interface ScannedRegistration {
  marka_vozila: string | null;
  model_vozila: string | null;
  registarske_tablice: string | null;
  vin_broj: string | null;
  motor: string | null;
  vlasnik: { ime: string | null; prezime: string | null };
}

export type VehicleMatchKind = 'vin_exact' | 'vin_near' | 'plates';

export interface VehicleCandidateCustomer {
  id: number;
  ime: string;
  prezime: string;
  telefon: string | null;
}

export interface VehicleCandidate {
  vehicle: Vehicle;
  customer: VehicleCandidateCustomer | null;
  match: VehicleMatchKind;
}

export interface CustomerCandidate {
  customer: Customer;
  score: number;
}

export interface ScanRegistrationResponse {
  document: ScannedRegistration;
  vehicleCandidates: VehicleCandidate[];
  customerCandidates: CustomerCandidate[];
  autoSelect: { vehicleId: number | null; customerId: number | null };
  warnings: string[];
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/api/registration-match.test.ts`:

```ts
import { test, expect } from "bun:test";
import { canonicalVin, normalizePlates, normalizeName, levenshtein, similarity } from "./registration-match";

test("canonicalVin maps VIN-illegal letters to digits", () => {
  // I, O and Q are forbidden in a real VIN, so any read of them is an OCR error.
  expect(canonicalVin("1OI-QO")).toBe("10100");
});

test("canonicalVin strips separators and uppercases", () => {
  expect(canonicalVin("wvw zzz-1k5")).toBe("WVWZZZ1K5");
});

test("normalizePlates strips dashes and spaces", () => {
  expect(normalizePlates("A12-B-345")).toBe("A12B345");
  expect(normalizePlates("a12 b 345")).toBe("A12B345");
});

test("normalizeName strips diacritics including Đ", () => {
  expect(normalizeName("Đurić")).toBe("DURIC");
  expect(normalizeName("Marić")).toBe("MARIC");
  expect(normalizeName("Šefik Čengić")).toBe("SEFIK CENGIC");
});

test("normalizeName collapses whitespace and punctuation to single spaces", () => {
  expect(normalizeName("  Marko   Marić ")).toBe("MARKO MARIC");
});

test("levenshtein counts single-character edits", () => {
  expect(levenshtein("ABC", "ABC")).toBe(0);
  expect(levenshtein("ABC", "ABD")).toBe(1);
  expect(levenshtein("ABC", "")).toBe(3);
  expect(levenshtein("", "AB")).toBe(2);
});

test("similarity is 1 for equal strings and drops with distance", () => {
  expect(similarity("MARIC", "MARIC")).toBe(1);
  expect(similarity("MARIC", "MARIK")).toBeCloseTo(0.8, 5);
  expect(similarity("", "")).toBe(1);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/api/registration-match.test.ts`
Expected: FAIL — `Cannot find module './registration-match'`

- [ ] **Step 4: Write the implementation**

Create `src/api/registration-match.ts`:

```ts
// Pure matching helpers for registration-document scanning.
// No database, no network — the matching rules must be testable in isolation.

// Đ (U+0110) and đ (U+0111) are distinct letters, not decomposable by NFD.
// Without this map, "Đurić" would never match "Duric".
const DJ_RE = /[ĐđÐ]/g;

export function normalizeName(raw: string): string {
  return raw
    .replace(DJ_RE, "D")
    .normalize("NFD")
    // \p{M} matches every combining mark, so "ć" (c + U+0301) collapses to "c".
    // Written as a property escape rather than a literal range, which would put
    // invisible combining characters into the source.
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// A real VIN never contains I, O or Q — the standard forbids them precisely
// because they are confusable with 1 and 0. Any such character is a misread.
export function canonicalVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OQ]/g, "0")
    .replace(/I/g, "1");
}

export function normalizePlates(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length]!;
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/api/registration-match.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit 2>&1 | grep -v '^build.ts' | head`
Expected: no output (only pre-existing `build.ts` errors are filtered out).

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/api/registration-match.ts src/api/registration-match.test.ts
git commit -m "feat: add registration scan types and matching primitives"
```

---

### Task 2: Candidate matching and auto-select rules

**Files:**
- Modify: `src/api/registration-match.ts` (append)
- Test: `src/api/registration-match.test.ts` (append)

**Interfaces:**
- Consumes: `canonicalVin`, `normalizePlates`, `normalizeName`, `levenshtein`, `similarity` from Task 1
- Produces:
  - `NAME_MATCH_THRESHOLD = 0.72`, `VIN_NEAR_MAX_DISTANCE = 2`
  - `type VehicleWithCustomer = Vehicle & { customer: VehicleCandidateCustomer | null }`
  - `matchVehicles(doc: ScannedRegistration, vehicles: VehicleWithCustomer[]): { candidates: VehicleCandidate[]; warnings: string[] }`
  - `matchCustomers(vlasnik: { ime: string | null; prezime: string | null }, customers: Customer[]): CustomerCandidate[]`
  - `decideAutoSelect(doc: ScannedRegistration, vehicleCandidates: VehicleCandidate[]): { vehicleId: number | null; customerId: number | null; warnings: string[] }`

- [ ] **Step 1: Write the failing tests**

Append to `src/api/registration-match.test.ts`:

```ts
import { matchVehicles, matchCustomers, decideAutoSelect } from "./registration-match";
import type { Customer, ScannedRegistration, Vehicle, VehicleCandidateCustomer } from "../types";

function doc(over: Partial<ScannedRegistration> = {}): ScannedRegistration {
  return {
    marka_vozila: "VW",
    model_vozila: "Golf",
    registarske_tablice: "A12-B-345",
    vin_broj: "WVWZZZ1KZAW000001",
    motor: "2.0 TDI",
    vlasnik: { ime: "Marko", prezime: "Marić" },
    ...over,
  };
}

function vehicle(id: number, over: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    customer_id: 1,
    registarske_tablice: "A12-B-345",
    vin_broj: "WVWZZZ1KZAW000001",
    marka_vozila: "VW",
    model_vozila: "Golf",
    motor: "2.0 TDI",
    created_at: "2026-01-01",
    ...over,
  };
}

function owner(id: number, ime: string, prezime: string): VehicleCandidateCustomer {
  return { id, ime, prezime, telefon: null };
}

function customer(id: number, ime: string, prezime: string): Customer {
  return { id, naziv_firme: null, ime, prezime, telefon: null, email: null, created_at: "2026-01-01" };
}

test("matchVehicles finds an exact VIN match", () => {
  const { candidates, warnings } = matchVehicles(doc(), [
    { ...vehicle(7), customer: owner(1, "Marko", "Marić") },
  ]);
  expect(candidates.length).toBe(1);
  expect(candidates[0]!.match).toBe("vin_exact");
  expect(candidates[0]!.vehicle.id).toBe(7);
  expect(warnings).toEqual([]);
});

test("matchVehicles treats a one-character VIN misread as near, not exact", () => {
  // Stored VIN differs from the scanned one by a single character (1 -> 2).
  const stored = vehicle(7, { vin_broj: "WVWZZZ2KZAW000001" });
  const { candidates } = matchVehicles(doc(), [{ ...stored, customer: null }]);
  expect(candidates.length).toBe(1);
  expect(candidates[0]!.match).toBe("vin_near");
});

test("matchVehicles reports a warning when two vehicles share a VIN", () => {
  const { candidates, warnings } = matchVehicles(doc(), [
    { ...vehicle(7), customer: null },
    { ...vehicle(8), customer: null },
  ]);
  expect(candidates.length).toBe(2);
  expect(candidates.every((c) => c.match === "vin_exact")).toBe(true);
  expect(warnings.length).toBe(1);
  expect(warnings[0]).toContain("isti");
});

test("matchVehicles falls back to plates when the VIN does not match", () => {
  const stored = vehicle(7, { vin_broj: "ZZZZZZ9ZZZZ999999" });
  const { candidates } = matchVehicles(doc(), [{ ...stored, customer: null }]);
  expect(candidates.length).toBe(1);
  expect(candidates[0]!.match).toBe("plates");
});

test("matchCustomers ignores diacritics and word order", () => {
  const forward = matchCustomers({ ime: "Marko", prezime: "Marić" }, [customer(1, "Marko", "Maric")]);
  expect(forward.length).toBe(1);
  expect(forward[0]!.score).toBe(1);

  const reversed = matchCustomers({ ime: "Marić", prezime: "Marko" }, [customer(1, "Marko", "Maric")]);
  expect(reversed.length).toBe(1);
});

test("matchCustomers drops candidates below the threshold", () => {
  const result = matchCustomers({ ime: "Marko", prezime: "Marić" }, [customer(1, "Amela", "Hodžić")]);
  expect(result).toEqual([]);
});

test("matchCustomers returns every namesake and never picks one", () => {
  const namesakes = [customer(1, "Marko", "Marić"), customer(2, "Marko", "Marić")];
  const result = matchCustomers({ ime: "Marko", prezime: "Marić" }, namesakes);
  expect(result.length).toBe(2);

  // No vehicle in the database -> nothing is auto-selected, however good the name match.
  const auto = decideAutoSelect(doc(), []);
  expect(auto.vehicleId).toBe(null);
  expect(auto.customerId).toBe(null);
});

test("decideAutoSelect picks the vehicle and its owner on a single exact VIN match", () => {
  const { candidates } = matchVehicles(doc(), [{ ...vehicle(7), customer: owner(3, "Marko", "Marić") }]);
  const auto = decideAutoSelect(doc(), candidates);
  expect(auto.vehicleId).toBe(7);
  expect(auto.customerId).toBe(3);
  expect(auto.warnings).toEqual([]);
});

test("decideAutoSelect refuses to pick when two vehicles match exactly", () => {
  const { candidates } = matchVehicles(doc(), [
    { ...vehicle(7), customer: owner(3, "Marko", "Marić") },
    { ...vehicle(8), customer: owner(4, "Pero", "Perić") },
  ]);
  const auto = decideAutoSelect(doc(), candidates);
  expect(auto.vehicleId).toBe(null);
  expect(auto.customerId).toBe(null);
});

test("decideAutoSelect drops the customer when the document owner disagrees", () => {
  const { candidates } = matchVehicles(doc(), [{ ...vehicle(7), customer: owner(3, "Pero", "Perić") }]);
  const auto = decideAutoSelect(doc(), candidates);
  expect(auto.vehicleId).toBe(7);
  expect(auto.customerId).toBe(null);
  expect(auto.warnings.length).toBe(1);
  expect(auto.warnings[0]).toContain("prodano");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/registration-match.test.ts`
Expected: FAIL — `matchVehicles is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

First add this import block at the **top** of `src/api/registration-match.ts`, above the existing code:

```ts
import type {
  Customer,
  CustomerCandidate,
  ScannedRegistration,
  Vehicle,
  VehicleCandidate,
  VehicleCandidateCustomer,
  VehicleMatchKind,
} from "../types";
```

Then append the rest to the end of the same file:

```ts
export const NAME_MATCH_THRESHOLD = 0.72;
export const VIN_NEAR_MAX_DISTANCE = 2;
const MAX_CUSTOMER_CANDIDATES = 5;

// Below this length a "near" VIN match is meaningless — short garbage strings
// sit within edit distance 2 of almost anything.
const VIN_MIN_NEAR_LENGTH = 8;

export type VehicleWithCustomer = Vehicle & { customer: VehicleCandidateCustomer | null };

function docFullName(vlasnik: { ime: string | null; prezime: string | null }): {
  forward: string;
  reversed: string;
} {
  const ime = vlasnik.ime ?? "";
  const prezime = vlasnik.prezime ?? "";
  return {
    forward: normalizeName(`${ime} ${prezime}`),
    reversed: normalizeName(`${prezime} ${ime}`),
  };
}

export function matchVehicles(
  doc: ScannedRegistration,
  vehicles: VehicleWithCustomer[]
): { candidates: VehicleCandidate[]; warnings: string[] } {
  const warnings: string[] = [];
  const docVin = doc.vin_broj ? canonicalVin(doc.vin_broj) : "";
  const docPlates = doc.registarske_tablice ? normalizePlates(doc.registarske_tablice) : "";

  const exact: VehicleCandidate[] = [];
  const near: VehicleCandidate[] = [];
  const byPlates: VehicleCandidate[] = [];

  for (const row of vehicles) {
    const { customer, ...vehicle } = row;
    const make = (match: VehicleMatchKind): VehicleCandidate => ({ vehicle, customer, match });
    const vin = row.vin_broj ? canonicalVin(row.vin_broj) : "";

    if (docVin && vin) {
      if (vin === docVin) {
        exact.push(make("vin_exact"));
        continue;
      }
      if (
        docVin.length >= VIN_MIN_NEAR_LENGTH &&
        vin.length >= VIN_MIN_NEAR_LENGTH &&
        levenshtein(vin, docVin) <= VIN_NEAR_MAX_DISTANCE
      ) {
        near.push(make("vin_near"));
        continue;
      }
    }

    if (docPlates && normalizePlates(row.registarske_tablice) === docPlates) {
      byPlates.push(make("plates"));
    }
  }

  if (exact.length > 1) {
    warnings.push(
      `U bazi postoji ${exact.length} vozila sa istim VIN brojem. Odaberite vozilo ručno.`
    );
  }

  return { candidates: [...exact, ...near, ...byPlates], warnings };
}

export function matchCustomers(
  vlasnik: { ime: string | null; prezime: string | null },
  customers: Customer[]
): CustomerCandidate[] {
  const { forward, reversed } = docFullName(vlasnik);
  if (!forward) return [];

  return customers
    .map((customer) => {
      const full = normalizeName(`${customer.ime} ${customer.prezime}`);
      const firma = customer.naziv_firme ? normalizeName(customer.naziv_firme) : "";
      const score = Math.max(
        similarity(forward, full),
        similarity(reversed, full),
        firma ? similarity(forward, firma) : 0
      );
      return { customer, score };
    })
    .filter((c) => c.score >= NAME_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.customer.id - b.customer.id)
    .slice(0, MAX_CUSTOMER_CANDIDATES);
}

// Note the missing customerCandidates parameter: a name match must never
// auto-select a customer, so this function is not given the name candidates
// at all.
export function decideAutoSelect(
  doc: ScannedRegistration,
  vehicleCandidates: VehicleCandidate[]
): { vehicleId: number | null; customerId: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const exact = vehicleCandidates.filter((c) => c.match === "vin_exact");
  if (exact.length !== 1) return { vehicleId: null, customerId: null, warnings };

  const chosen = exact[0]!;
  const vehicleId = chosen.vehicle.id;
  const owner = chosen.customer;
  if (!owner) return { vehicleId, customerId: null, warnings };

  const { forward, reversed } = docFullName(doc.vlasnik);
  if (!forward) return { vehicleId, customerId: owner.id, warnings };

  const ownerName = normalizeName(`${owner.ime} ${owner.prezime}`);
  const score = Math.max(similarity(forward, ownerName), similarity(reversed, ownerName));
  if (score >= NAME_MATCH_THRESHOLD) return { vehicleId, customerId: owner.id, warnings };

  const docName = `${doc.vlasnik.ime ?? ""} ${doc.vlasnik.prezime ?? ""}`.trim();
  warnings.push(
    `Vozilo je u bazi na ${owner.ime} ${owner.prezime}, a saobraćajna glasi na ${docName}. Vozilo je vjerovatno prodano.`
  );
  return { vehicleId, customerId: null, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/registration-match.test.ts`
Expected: PASS, 17 tests total.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit 2>&1 | grep -v '^build.ts' | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/api/registration-match.ts src/api/registration-match.test.ts
git commit -m "feat: add vehicle and customer candidate matching with auto-select rules"
```

---

### Task 3: Model prompt and strict response parsing

**Files:**
- Modify: `src/api/invoice-scan.ts` (export `stripFences`)
- Create: `src/api/registration-scan.ts`
- Test: `src/api/registration-scan.test.ts`

**Interfaces:**
- Consumes: `stripFences` from `./invoice-scan`; `ScannedRegistration` from `../types`
- Produces: `buildRegistrationMessages(dataUrl: string): OcrMessage[]`, `parseRegistrationResponse(raw: string): { document: ScannedRegistration; warnings: string[] }`, `hasUsableIdentifier(doc: ScannedRegistration): boolean`

- [ ] **Step 1: Export `stripFences` from the invoice scanner**

In `src/api/invoice-scan.ts`, change the existing declaration (currently at line 44) from:

```ts
function stripFences(raw: string): string {
```

to:

```ts
export function stripFences(raw: string): string {
```

Also export the message type so the new module can reuse it. Change:

```ts
interface OcrMessage {
```

to:

```ts
export interface OcrMessage {
```

Change nothing else in that file.

- [ ] **Step 2: Write the failing tests**

Create `src/api/registration-scan.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parseRegistrationResponse, hasUsableIdentifier, buildRegistrationMessages } from "./registration-scan";

test("parses a clean JSON response", () => {
  const raw = JSON.stringify({
    marka_vozila: "Volkswagen",
    model_vozila: "Golf 7",
    registarske_tablice: "A12-B-345",
    vin_broj: "WVWZZZ1KZAW000001",
    motor: "2.0 TDI",
    vlasnik: { ime: "Marko", prezime: "Marić" },
    warnings: [],
  });
  const { document, warnings } = parseRegistrationResponse(raw);
  expect(document.marka_vozila).toBe("Volkswagen");
  expect(document.vlasnik.prezime).toBe("Marić");
  expect(warnings).toEqual([]);
});

test("strips markdown fences", () => {
  const raw = '```json\n{"vin_broj":"X","vlasnik":{}}\n```';
  const { document } = parseRegistrationResponse(raw);
  expect(document.vin_broj).toBe("X");
});

test("turns missing, empty and non-string fields into null", () => {
  const raw = JSON.stringify({ marka_vozila: "", model_vozila: 42, vin_broj: "  X  " });
  const { document } = parseRegistrationResponse(raw);
  expect(document.marka_vozila).toBe(null);
  expect(document.model_vozila).toBe(null);
  expect(document.motor).toBe(null);
  expect(document.vin_broj).toBe("X");
  expect(document.vlasnik).toEqual({ ime: null, prezime: null });
});

test("keeps only string warnings", () => {
  const raw = JSON.stringify({ vlasnik: {}, warnings: ["nejasan VIN", 7, null] });
  const { warnings } = parseRegistrationResponse(raw);
  expect(warnings).toEqual(["nejasan VIN"]);
});

test("rejects invalid JSON and non-objects", () => {
  expect(() => parseRegistrationResponse("not json")).toThrow();
  expect(() => parseRegistrationResponse("[1,2]")).toThrow();
});

test("hasUsableIdentifier requires a VIN or plates", () => {
  const empty = parseRegistrationResponse(JSON.stringify({ vlasnik: {} })).document;
  expect(hasUsableIdentifier(empty)).toBe(false);

  const vinOnly = parseRegistrationResponse(JSON.stringify({ vin_broj: "X", vlasnik: {} })).document;
  expect(hasUsableIdentifier(vinOnly)).toBe(true);

  const platesOnly = parseRegistrationResponse(
    JSON.stringify({ registarske_tablice: "A12-B-345", vlasnik: {} })
  ).document;
  expect(hasUsableIdentifier(platesOnly)).toBe(true);
});

test("buildRegistrationMessages embeds the image and forbids the address", () => {
  const messages = buildRegistrationMessages("data:image/png;base64,AAA");
  expect(messages.length).toBe(2);
  const content = messages[1]!.content;
  expect(Array.isArray(content)).toBe(true);
  const parts = content as Array<{ type: string }>;
  expect(parts.some((p) => p.type === "image_url")).toBe(true);
  const text = JSON.stringify(messages);
  expect(text).toContain("address");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/api/registration-scan.test.ts`
Expected: FAIL — `Cannot find module './registration-scan'`

- [ ] **Step 4: Write the parser half of the module**

Create `src/api/registration-scan.ts` with exactly this content for now (the handler arrives in Task 4):

```ts
import type { ScannedRegistration } from "../types";
import { stripFences, type OcrMessage } from "./invoice-scan";

const INSTRUCTIONS = [
  "Extract vehicle data from this vehicle registration document (Bosnian 'saobraćajna dozvola', an EU registration certificate).",
  "",
  "EU field codes, when the document shows them:",
  "  A     = registration plates",
  "  D.1   = make",
  "  D.2   = type / model",
  "  D.3   = commercial description (often the model name)",
  "  E     = VIN / chassis number",
  "  P.1   = engine displacement in cm3",
  "  P.3   = fuel type",
  "  C.1.1 = owner surname",
  "  C.1.2 = owner given name",
  "",
  "Rules:",
  "1. Output STRICT JSON with this exact shape, no markdown, no prose:",
  '   {"marka_vozila":string|null,"model_vozila":string|null,"registarske_tablice":string|null,"vin_broj":string|null,"motor":string|null,"vlasnik":{"ime":string|null,"prezime":string|null},"warnings":string[]}',
  "2. Use null for any field you cannot read with confidence. Never guess.",
  "3. 'motor' is a short label such as '2.0 TDI' or '1.6 benzin', built from displacement and fuel or commercial description. Use null if unclear.",
  "4. Never output the owner's address, ID number, or any field not listed above.",
  "5. A VIN is 17 characters on modern documents and never contains the letters I, O or Q.",
  "6. Append a short Bosnian note to 'warnings' for each field left null because the image was unclear.",
].join("\n");

export function buildRegistrationMessages(dataUrl: string): OcrMessage[] {
  return [
    {
      role: "system",
      content:
        "You are an OCR parser for Bosnian vehicle registration documents. Extract the vehicle fields and the owner's name only. Return strict JSON only.",
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

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseRegistrationResponse(raw: string): {
  document: ScannedRegistration;
  warnings: string[];
} {
  const cleaned = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Invalid JSON from model: ${(e as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response is not an object");
  }
  const obj = parsed as Record<string, unknown>;

  const vlasnikRaw =
    obj.vlasnik && typeof obj.vlasnik === "object" && !Array.isArray(obj.vlasnik)
      ? (obj.vlasnik as Record<string, unknown>)
      : {};

  const document: ScannedRegistration = {
    marka_vozila: str(obj.marka_vozila),
    model_vozila: str(obj.model_vozila),
    registarske_tablice: str(obj.registarske_tablice),
    vin_broj: str(obj.vin_broj),
    motor: str(obj.motor),
    vlasnik: { ime: str(vlasnikRaw.ime), prezime: str(vlasnikRaw.prezime) },
  };

  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];

  return { document, warnings };
}

// Without a VIN and without plates there is nothing to search the database by.
export function hasUsableIdentifier(doc: ScannedRegistration): boolean {
  return Boolean(doc.vin_broj || doc.registarske_tablice);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/api/registration-scan.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `bun test && bunx tsc --noEmit 2>&1 | grep -v '^build.ts' | head`
Expected: all tests pass (49 pre-existing + 24 new); no typecheck output.

- [ ] **Step 7: Commit**

```bash
git add src/api/invoice-scan.ts src/api/registration-scan.ts src/api/registration-scan.test.ts
git commit -m "feat: add registration document prompt and strict response parser"
```

---

### Task 4: The endpoint, on a shared OpenRouter helper

Both scanners run the same pipeline — image upload, vision model, strict JSON —
and differ only in prompt, model and parser. Rather than copy that plumbing,
this task extracts it into `src/api/vision.ts` and moves the existing invoice
scanner onto it. `src/api/invoice-scan.test.ts` covers the invoice scanner's
pure functions and must keep passing unchanged.

**Files:**
- Create: `src/api/vision.ts`
- Modify: `src/api/invoice-scan.ts` (use the shared helper)
- Modify: `src/api/registration-scan.ts` (append the handler)
- Modify: `src/index.ts` (register the route)
- Test: `src/api/registration-scan.test.ts` (append handler tests)

**Interfaces:**
- Consumes: `matchVehicles`, `matchCustomers`, `decideAutoSelect`, `VehicleWithCustomer` from `./registration-match`; `requireAuth`, `validateCsrf` from `./auth`; `getDB` from `../db`
- Produces:
  - `src/api/vision.ts`: `VisionMessage`, `readImageUpload(req: Request): Promise<{ ok: true; dataUrl: string } | { ok: false; response: Response }>`, `callOpenRouterVision(apiKey: string, model: string, messages: VisionMessage[]): Promise<{ ok: true; content: string } | { ok: false; response: Response }>`
  - `scanRegistration(req: Request): Promise<Response>`

- [ ] **Step 1: Write the failing tests**

Append to `src/api/registration-scan.test.ts`:

```ts
import { beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { scanRegistration } from "./registration-scan";

process.env.DB_PATH = ":memory:";

let adminSession: string;
let adminCsrf: string;

function scanReq(opts?: { session?: string | null }): Request {
  const headers: Record<string, string> = {};
  if (opts?.session !== null) headers["Cookie"] = `session=${opts?.session ?? adminSession}`;
  headers["X-CSRF-Token"] = adminCsrf;
  return new Request("http://localhost/api/vehicles/scan-registration", { method: "POST", headers });
}

beforeEach(() => {
  closeDB();
  const db = getDB();
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM users");

  const expires = new Date(Date.now() + 86400000).toISOString();
  const admin = db
    .query<{ id: number }, [string, string, string]>(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
    )
    .get("admin", "fake", "admin")!;
  adminSession = "admin-session";
  adminCsrf = "admin-csrf";
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(adminSession, admin.id, expires, adminCsrf);
});

test("scanRegistration requires authentication", async () => {
  const res = await scanRegistration(scanReq({ session: null }));
  expect(res.status).toBe(401);
});

test("scanRegistration returns 503 when the API key is missing", async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const res = await scanRegistration(scanReq());
    expect(res.status).toBe(503);
  } finally {
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/registration-scan.test.ts`
Expected: FAIL — `scanRegistration is not a function`.

- [ ] **Step 3: Extract the shared vision helper**

Create `src/api/vision.ts`:

```ts
// Shared plumbing for image -> vision model -> text scans.
// The invoice scanner and the registration scanner run the same pipeline and
// differ only in prompt, model and parser.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const TIMEOUT_MS = 45_000;

export interface VisionMessage {
  role: "system" | "user";
  content:
    | string
    | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export type ImageUpload =
  | { ok: true; dataUrl: string }
  | { ok: false; response: Response };

export async function readImageUpload(req: Request): Promise<ImageUpload> {
  const invalid = () => ({
    ok: false as const,
    response: Response.json({ message: "Slika nije validna" }, { status: 400 }),
  });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return invalid();
  }

  const file = formData.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return invalid();
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      response: Response.json({ message: "Slika je prevelika (max 8MB)" }, { status: 400 }),
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return { ok: true, dataUrl: `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}` };
}

export type VisionResult =
  | { ok: true; content: string }
  | { ok: false; response: Response };

export async function callOpenRouterVision(
  apiKey: string,
  model: string,
  messages: VisionMessage[]
): Promise<VisionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return {
        ok: false,
        response: Response.json({ message: "Vrijeme za obradu isteklo" }, { status: 504 }),
      };
    }
    return {
      ok: false,
      response: Response.json({ message: "OpenRouter nedostupan" }, { status: 502 }),
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`OpenRouter HTTP ${res.status}:`, text.slice(0, 500));
    return {
      ok: false,
      response: Response.json({ message: "OpenRouter greška" }, { status: 502 }),
    };
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    return {
      ok: false,
      response: Response.json({ message: "Model nije vratio sadržaj" }, { status: 422 }),
    };
  }
  return { ok: true, content };
}
```

- [ ] **Step 4: Move the invoice scanner onto the helper**

In `src/api/invoice-scan.ts`:

Delete the `OPENROUTER_URL`, `TIMEOUT_MS` and `MAX_BYTES` constants (keep `MODEL`).

Delete the local `OcrMessage` interface (the one you exported in Task 3) and import the shared type instead. Add at the top:

```ts
import { callOpenRouterVision, readImageUpload, type VisionMessage } from "./vision";
```

Change `buildOcrMessages`'s return type from `OcrMessage[]` to `VisionMessage[]`. Its body does not change.

Replace everything in `scanInvoice` from `let formData: FormData;` down to and including the `if (!content) { ... }` block with:

```ts
  const upload = await readImageUpload(req);
  if (!upload.ok) return upload.response;

  const vision = await callOpenRouterVision(apiKey, MODEL, buildOcrMessages(upload.dataUrl));
  if (!vision.ok) return vision.response;
  const content = vision.content;
```

The auth/CSRF/apiKey block above it and the `parseModelResponse` block below it stay exactly as they are.

Run `bun test src/api/invoice-scan.test.ts` — it must still pass, unchanged.

In `src/api/registration-scan.ts`, update the Task 3 import to take the message type from the new module:

```ts
import { stripFences } from "./invoice-scan";
import type { VisionMessage } from "./vision";
```

and change `buildRegistrationMessages`'s return type from `OcrMessage[]` to `VisionMessage[]`.

- [ ] **Step 5: Append the handler**

Add these imports at the top of `src/api/registration-scan.ts`:

```ts
import type { Customer, ScanRegistrationResponse, Vehicle } from "../types";
import { getDB } from "../db";
import { requireAuth, validateCsrf } from "./auth";
import { callOpenRouterVision, readImageUpload } from "./vision";
import {
  decideAutoSelect,
  matchCustomers,
  matchVehicles,
  type VehicleWithCustomer,
} from "./registration-match";
```

(Merge the `ScannedRegistration` import with the new type import from `../types` into one statement.)

Append to the end of the file:

```ts
const MODEL = "google/gemini-3.5-flash";

interface VehicleRow extends Vehicle {
  c_id: number | null;
  c_ime: string | null;
  c_prezime: string | null;
  c_telefon: string | null;
}

// The shop's database holds hundreds of rows, not millions. Fuzzy matching
// cannot be pushed into SQL, so both tables are read in full and scored in JS.
function loadVehicles(): VehicleWithCustomer[] {
  const rows = getDB()
    .query<VehicleRow, []>(
      `SELECT v.*, c.id as c_id, c.ime as c_ime, c.prezime as c_prezime, c.telefon as c_telefon
       FROM vehicles v
       LEFT JOIN customers c ON v.customer_id = c.id`
    )
    .all();

  return rows.map((row) => {
    const { c_id, c_ime, c_prezime, c_telefon, ...vehicle } = row;
    return {
      ...vehicle,
      customer:
        c_id !== null
          ? { id: c_id, ime: c_ime ?? "", prezime: c_prezime ?? "", telefon: c_telefon }
          : null,
    };
  });
}

export async function scanRegistration(req: Request): Promise<Response> {
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ message: "Servis nije konfigurisan" }, { status: 503 });
  }

  const upload = await readImageUpload(req);
  if (!upload.ok) return upload.response;

  const vision = await callOpenRouterVision(apiKey, MODEL, buildRegistrationMessages(upload.dataUrl));
  if (!vision.ok) return vision.response;
  const content = vision.content;

  let document: ScannedRegistration;
  let warnings: string[];
  try {
    ({ document, warnings } = parseRegistrationResponse(content));
  } catch (err) {
    console.error("Registration parse error:", (err as Error).message, "raw:", content.slice(0, 500));
    return Response.json(
      { message: "Model nije vratio ispravan format. Pokušajte sa jasnijom slikom." },
      { status: 422 }
    );
  }

  if (!hasUsableIdentifier(document)) {
    return Response.json(
      { message: "Nije prepoznata saobraćajna, pokušajte sa jasnijom slikom" },
      { status: 422 }
    );
  }

  const db = getDB();
  const vehicleMatch = matchVehicles(document, loadVehicles());
  const customerCandidates = matchCustomers(
    document.vlasnik,
    db.query<Customer, []>("SELECT * FROM customers").all()
  );
  const auto = decideAutoSelect(document, vehicleMatch.candidates);

  const payload: ScanRegistrationResponse = {
    document,
    vehicleCandidates: vehicleMatch.candidates,
    customerCandidates,
    autoSelect: { vehicleId: auto.vehicleId, customerId: auto.customerId },
    warnings: [...warnings, ...vehicleMatch.warnings, ...auto.warnings],
  };
  return Response.json(payload);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/api/registration-scan.test.ts`
Expected: PASS, 9 tests. No network is touched — both handler tests return before the OpenRouter call.

- [ ] **Step 7: Register the route**

In `src/index.ts`, add the import next to the other API imports:

```ts
import { scanRegistration } from "./api/registration-scan";
```

And inside the routes object, add this **above** every `"/api/vehicles/:id..."` entry, so a static segment can never be shadowed by a `:id` parameter:

```ts
    "/api/vehicles/scan-registration": {
      POST: scanRegistration,
    },
```

- [ ] **Step 8: Run the whole suite and typecheck**

Run: `bun test && bunx tsc --noEmit 2>&1 | grep -v '^build.ts' | head`
Expected: all tests pass — including `invoice-scan.test.ts`, unchanged. No typecheck output.

- [ ] **Step 9: Commit**

```bash
git add src/api/vision.ts src/api/invoice-scan.ts src/api/registration-scan.ts src/api/registration-scan.test.ts src/index.ts
git commit -m "feat: add scan-registration endpoint on a shared vision helper"
```

---

### Task 5: API client and the scan dialog

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/components/vehicles/RegistrationScanDialog.tsx`

**Interfaces:**
- Consumes: `POST /api/vehicles/scan-registration`; `customersApi.create`, `vehiclesApi.create`, `vehiclesApi.update` from `src/lib/api.ts`
- Produces: `registrationScanApi.scan(file: File)`; component `RegistrationScanDialog` with props `{ open: boolean; onOpenChange: (open: boolean) => void; onResolved: (customerId: number, vehicle: Vehicle) => void }`

- [ ] **Step 1: Add the API client**

In `src/lib/api.ts`, add `ScanRegistrationResponse` to the existing `import type { ... } from '../types'` list.

Then insert this after the `invoiceScanApi` block (it deliberately bypasses `fetchApi`, exactly as `invoiceScanApi` does, because `FormData` must not get a JSON content-type):

```ts
// Registration document scan (multipart upload — same reason as invoiceScanApi)
export const registrationScanApi = {
  scan: async (
    file: File
  ): Promise<{ success: true; data: ScanRegistrationResponse } | { success: false; error: string }> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch(`${API_BASE}/vehicles/scan-registration`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Greška na serveru' }));
        return { success: false, error: error.message || 'Greška na serveru' };
      }

      const data = await response.json() as ScanRegistrationResponse;
      return { success: true, data };
    } catch {
      return { success: false, error: 'Greška u komunikaciji sa serverom' };
    }
  },
};
```

- [ ] **Step 2: Build the dialog**

Create `src/components/vehicles/RegistrationScanDialog.tsx`:

```tsx
import { useRef, useState } from "react";
import { Camera, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { registrationScanApi, customersApi, vehiclesApi } from "@/lib/api";
import type { ScanRegistrationResponse, Vehicle } from "@/types";

interface RegistrationScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: (customerId: number, vehicle: Vehicle) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "review"; data: ScanRegistrationResponse }
  | { kind: "saving"; data: ScanRegistrationResponse };

const MAX_BYTES = 8 * 1024 * 1024;

// "new" means: create it rather than reuse an existing row.
type Choice = number | "new";

interface VehicleFields {
  marka_vozila: string;
  model_vozila: string;
  registarske_tablice: string;
  vin_broj: string;
  motor: string;
}

const MATCH_LABEL: Record<string, string> = {
  vin_exact: "VIN se poklapa",
  vin_near: "VIN se razlikuje u par znakova",
  plates: "tablice se poklapaju",
};

export function RegistrationScanDialog({ open, onOpenChange, onResolved }: RegistrationScanDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [vehicleChoice, setVehicleChoice] = useState<Choice>("new");
  const [customerChoice, setCustomerChoice] = useState<Choice>("new");
  const [fields, setFields] = useState<VehicleFields>({
    marka_vozila: "",
    model_vozila: "",
    registarske_tablice: "",
    vin_broj: "",
    motor: "",
  });
  const [newIme, setNewIme] = useState("");
  const [newPrezime, setNewPrezime] = useState("");
  const [newTelefon, setNewTelefon] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase({ kind: "idle" });
    setVehicleChoice("new");
    setCustomerChoice("new");
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
    const result = await registrationScanApi.scan(file);
    if (!result.success) {
      setPhase({ kind: "error", message: result.error });
      return;
    }

    const { document, autoSelect } = result.data;
    setFields({
      marka_vozila: document.marka_vozila ?? "",
      model_vozila: document.model_vozila ?? "",
      registarske_tablice: document.registarske_tablice ?? "",
      vin_broj: document.vin_broj ?? "",
      motor: document.motor ?? "",
    });
    setNewIme(document.vlasnik.ime ?? "");
    setNewPrezime(document.vlasnik.prezime ?? "");
    setNewTelefon("");
    setVehicleChoice(autoSelect.vehicleId ?? "new");
    setCustomerChoice(autoSelect.customerId ?? "new");
    setPhase({ kind: "review", data: result.data });
  };

  const handleConfirm = async () => {
    if (phase.kind !== "review") return;
    const data = phase.data;
    setPhase({ kind: "saving", data });

    const fail = (message: string) => setPhase({ kind: "error", message });

    // 1. Customer: reuse the chosen row, or create one from the document.
    let customerId: number;
    if (customerChoice === "new") {
      if (!newIme.trim() || !newPrezime.trim()) {
        setPhase({ kind: "review", data });
        return;
      }
      const created = await customersApi.create({
        ime: newIme.trim(),
        prezime: newPrezime.trim(),
        telefon: newTelefon.trim() || undefined,
      });
      if (!created.success || !created.data) return fail(created.error || "Greška pri kreiranju klijenta");
      customerId = created.data.id;
    } else {
      customerId = customerChoice;
    }

    // 2. Vehicle: reuse the chosen row, or create one from the edited fields.
    let vehicle: Vehicle;
    if (vehicleChoice === "new") {
      const created = await vehiclesApi.create({
        customer_id: customerId,
        marka_vozila: fields.marka_vozila.trim(),
        model_vozila: fields.model_vozila.trim(),
        registarske_tablice: fields.registarske_tablice.trim(),
        vin_broj: fields.vin_broj.trim() || undefined,
        motor: fields.motor.trim() || undefined,
      });
      if (!created.success || !created.data) return fail(created.error || "Greška pri kreiranju vozila");
      vehicle = created.data;
    } else {
      const found = data.vehicleCandidates.find((c) => c.vehicle.id === vehicleChoice);
      if (!found) return fail("Vozilo nije pronađeno");
      vehicle = found.vehicle;

      // The car changed hands: move it to the customer standing on the document.
      if (vehicle.customer_id !== customerId) {
        const moved = await vehiclesApi.update(vehicle.id, { customer_id: customerId });
        if (!moved.success || !moved.data) return fail(moved.error || "Greška pri prebacivanju vozila");
        vehicle = moved.data;
      }
    }

    onResolved(customerId, vehicle);
    handleClose(false);
  };

  const data = phase.kind === "review" || phase.kind === "saving" ? phase.data : null;
  const saving = phase.kind === "saving";
  const canConfirm =
    !!data &&
    !saving &&
    (vehicleChoice !== "new" ||
      (fields.marka_vozila.trim() && fields.model_vozila.trim() && fields.registarske_tablice.trim())) &&
    (customerChoice !== "new" || (newIme.trim() && newPrezime.trim()));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skeniraj saobraćajnu</DialogTitle>
        </DialogHeader>

        {phase.kind === "idle" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Slikajte saobraćajnu dozvolu. Vozilo i klijent bit će prepoznati, a vi ih potvrđujete prije otvaranja naloga.
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
              Slikaj saobraćajnu
            </Button>
          </div>
        )}

        {phase.kind === "scanning" && (
          <div className="py-12 text-center space-y-3">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Čitam saobraćajnu...</p>
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

        {data && (
          <div className="space-y-6">
            {data.warnings.length > 0 && (
              <div className="flex items-start gap-3 p-3 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 rounded text-sm">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <ul className="space-y-1">
                  {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {/* Vehicle */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase">Vozilo</h3>

              {data.vehicleCandidates.map((c) => (
                <button
                  key={c.vehicle.id}
                  type="button"
                  disabled={saving}
                  onClick={() => setVehicleChoice(c.vehicle.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                    vehicleChoice === c.vehicle.id && "bg-muted"
                  )}
                >
                  <div>
                    <div className="font-medium">
                      {c.vehicle.marka_vozila} {c.vehicle.model_vozila}
                    </div>
                    <div className="text-sm text-muted-foreground font-mono">
                      {c.vehicle.registarske_tablice}
                    </div>
                    <div className="text-xs text-muted-foreground">{MATCH_LABEL[c.match]}</div>
                  </div>
                  {vehicleChoice === c.vehicle.id && <Check className="h-4 w-4 text-status-success" />}
                </button>
              ))}

              <button
                type="button"
                disabled={saving}
                onClick={() => setVehicleChoice("new")}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                  vehicleChoice === "new" && "bg-muted"
                )}
              >
                <span className="text-muted-foreground">Novo vozilo</span>
                {vehicleChoice === "new" && <Check className="h-4 w-4 text-status-success" />}
              </button>

              {vehicleChoice === "new" && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Marka *</Label>
                    <Input
                      value={fields.marka_vozila}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, marka_vozila: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Model *</Label>
                    <Input
                      value={fields.model_vozila}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, model_vozila: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tablice *</Label>
                    <Input
                      value={fields.registarske_tablice}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, registarske_tablice: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Motor</Label>
                    <Input
                      value={fields.motor}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, motor: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">VIN</Label>
                    <Input
                      value={fields.vin_broj}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, vin_broj: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Customer */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase">Klijent</h3>

              {data.customerCandidates.map((c) => (
                <button
                  key={c.customer.id}
                  type="button"
                  disabled={saving}
                  onClick={() => setCustomerChoice(c.customer.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                    customerChoice === c.customer.id && "bg-muted"
                  )}
                >
                  <div>
                    <div className="font-medium">
                      {c.customer.ime} {c.customer.prezime}
                    </div>
                    {c.customer.telefon && (
                      <div className="text-sm text-muted-foreground">{c.customer.telefon}</div>
                    )}
                  </div>
                  {customerChoice === c.customer.id && <Check className="h-4 w-4 text-status-success" />}
                </button>
              ))}

              <button
                type="button"
                disabled={saving}
                onClick={() => setCustomerChoice("new")}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                  customerChoice === "new" && "bg-muted"
                )}
              >
                <span className="text-muted-foreground">Novi klijent</span>
                {customerChoice === "new" && <Check className="h-4 w-4 text-status-success" />}
              </button>

              {customerChoice === "new" && (
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Ime *</Label>
                    <Input value={newIme} disabled={saving} onChange={(e) => setNewIme(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Prezime *</Label>
                    <Input value={newPrezime} disabled={saving} onChange={(e) => setNewPrezime(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Telefon</Label>
                    <Input value={newTelefon} disabled={saving} onChange={(e) => setNewTelefon(e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
                Odustani
              </Button>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                {saving ? "Spremam..." : "Otvori radni nalog"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit 2>&1 | grep -v '^build.ts' | head`
Expected: no output.

- [ ] **Step 4: Run the whole suite**

Run: `bun test`
Expected: all tests pass. (This task adds no tests: it is UI wiring over already-tested logic.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/components/vehicles/RegistrationScanDialog.tsx
git commit -m "feat: add registration scan dialog with candidate review"
```

---

### Task 6: Wire the button, the prefill, and the route

**Files:**
- Modify: `src/components/work-orders/WorkOrderList.tsx`
- Modify: `src/components/work-orders/WorkOrderForm.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `RegistrationScanDialog` from Task 5
- Produces: `WorkOrderList` prop `onScanned: (customerId: number, vehicle: Vehicle) => void`; `WorkOrderForm` prop `prefill?: { customerId: number; vehicle: Vehicle }`

- [ ] **Step 1: Add the button to the work order list**

In `src/components/work-orders/WorkOrderList.tsx`:

Add `ScanLine` to the existing `lucide-react` import, add `Vehicle` to the existing `@/types` type import, and add one new import line:

```tsx
import { RegistrationScanDialog } from "@/components/vehicles/RegistrationScanDialog";
```

`useState` is already imported in this file — do not add it again.

Extend the props interface (currently at line 29):

```tsx
interface WorkOrderListProps {
  onNewAuto: () => void;
  onNewAgregat: () => void;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onPrintPDF: (workOrder: WorkOrder) => void;
  onScanned: (customerId: number, vehicle: Vehicle) => void;
}
```

Update the signature (currently at line 53):

```tsx
export function WorkOrderList({ onNewAuto, onNewAgregat, onView, onEdit, onPrintPDF, onScanned }: WorkOrderListProps) {
```

Add local state next to the other `useState` calls in the component body:

```tsx
  const [scanOpen, setScanOpen] = useState(false);
```

Directly before the `<Button onClick={onNewAuto} size="sm" ...>` element (currently at line 126), add:

```tsx
            <Button onClick={() => setScanOpen(true)} size="sm" variant="outline" className="w-full sm:w-auto">
              <ScanLine className="h-4 w-4 mr-2" />
              Skeniraj saobraćajnu
            </Button>
```

And at the very end of the component's returned JSX, just before the closing tag of the outermost element, add:

```tsx
      <RegistrationScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResolved={onScanned}
      />
```

- [ ] **Step 2: Add the prefill prop to the form**

In `src/components/work-orders/WorkOrderForm.tsx`, extend the props interface (currently at line 21):

```tsx
interface WorkOrderFormProps {
  workOrderId?: number;
  prefill?: { customerId: number; vehicle: Vehicle };
  onBack: () => void;
  onSaved: (workOrder: WorkOrder) => void;
}
```

Update the signature:

```tsx
export function WorkOrderForm({ workOrderId, prefill, onBack, onSaved }: WorkOrderFormProps) {
```

Replace the three state initializers so the scanned values seed the form. Change:

```tsx
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | undefined>(undefined);
```

to:

```tsx
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(prefill?.customerId ?? null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | undefined>(prefill?.vehicle.id);
```

And change the `formData` initializer to seed from `prefill`:

```tsx
  const [formData, setFormData] = useState<WorkOrderFormAuto>({
    tip_naloga: 'auto',
    customer_id: prefill?.customerId ?? 0,
    registarske_tablice: prefill?.vehicle.registarske_tablice ?? "",
    vin_broj: prefill?.vehicle.vin_broj ?? "",
    marka_vozila: prefill?.vehicle.marka_vozila ?? "",
    model_vozila: prefill?.vehicle.model_vozila ?? "",
    motor: prefill?.vehicle.motor ?? "",
    kilometraza: undefined,
    mechanic_id: initialMechanicId,
    opis_kvara: "",
    napomena: "",
    status: "otvoren",
  });
```

Nothing else in the file changes. `CustomerSelect` already loads the customer by id when given `value`, and `VehicleSelect` already reselects by id once its list loads.

- [ ] **Step 3: Hold the prefill in App**

In `src/App.tsx`:

Add `Vehicle` to the existing `import type { ... } from "@/types"` list (create the import if the file has none).

Add state next to the other `useState` calls in `AppContent`:

```tsx
  const [scanPrefill, setScanPrefill] = useState<{ customerId: number; vehicle: Vehicle } | null>(null);
```

Inside `handleHash`, as the first statement of the function body, drop a stale prefill whenever the target is not the new-auto page:

```tsx
      const isNewAuto = hash === "work-orders/new/auto" || hash === "work-orders/new";
      if (!isNewAuto) setScanPrefill(null);
```

(Place this immediately after `const hash = ...` and before the `const [mainPage, subPage, id] = hash.split("/");` line.)

Pass the callback in the `work-orders` case:

```tsx
          <WorkOrderList
            onNewAuto={() => navigate("work-orders/new/auto")}
            onNewAgregat={() => navigate("work-orders/new/agregat")}
            onView={(id) => navigate(`work-orders/view/${id}`)}
            onEdit={(id) => navigate(`work-orders/edit/${id}`)}
            onPrintPDF={handlePrintPDF}
            onScanned={(customerId, vehicle) => {
              setScanPrefill({ customerId, vehicle });
              navigate("work-orders/new/auto");
            }}
          />
```

And consume it in the `work-orders-new-auto` case:

```tsx
      case "work-orders-new-auto":
        return (
          <WorkOrderForm
            key={scanPrefill ? `scan-${scanPrefill.vehicle.id}` : "blank"}
            prefill={scanPrefill ?? undefined}
            onBack={() => navigate("work-orders")}
            onSaved={(workOrder) => navigate(`work-orders/view/${workOrder.id}`)}
          />
        );
```

The `key` forces a fresh form when a scan lands, so the state initializers actually run.

- [ ] **Step 4: Typecheck and run the suite**

Run: `bun test && bunx tsc --noEmit 2>&1 | grep -v '^build.ts' | head`
Expected: all tests pass; no typecheck output.

- [ ] **Step 5: Verify by hand**

Start the app: `bun --hot ./src/index.ts`

Confirm, with `OPENROUTER_API_KEY` set in `.env`:
1. "Skeniraj saobraćajnu" appears next to "Novi nalog".
2. Photographing a registration document opens the review screen.
3. A vehicle already in the database is preselected; its owner is preselected too.
4. "Otvori radni nalog" lands on the new work order form with customer and vehicle filled in.

Without the key set, the dialog shows "Servis nije konfigurisan".

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/work-orders/WorkOrderList.tsx src/components/work-orders/WorkOrderForm.tsx
git commit -m "feat: launch registration scan from work orders and prefill the form"
```

---

## Out of scope

- Scanning from the "Novo vozilo" dialog inside `VehicleSelect`.
- An `adresa` column on `customers`.
- `godiste` and `gorivo` columns on `vehicles`.
- Changing the invoice scanner's model.
- Fixing `checkVin`'s `.get()` behaviour. The new endpoint uses `.all()`; `checkVin` stays as it is.
