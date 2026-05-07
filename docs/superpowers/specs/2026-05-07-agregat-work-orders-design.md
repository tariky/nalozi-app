# Agregat Work Orders — Design

**Date:** 2026-05-07
**Status:** Approved (pending implementation plan)

## Summary

Add a second type of work order — **agregat nalog** — alongside the existing auto nalog. Agregat orders are for stand-alone units brought in for repair (alternator, starter, AC compressor, electrical devices) without an associated vehicle. The `work_orders` table gains a `tip_naloga` discriminator and new agregat-specific columns; existing auto orders are unchanged. The migration is purely additive (no schema rebuild) plus an automatic file-level DB backup before any DDL.

## Goals & non-goals

**Goals**
- Support work orders for car parts brought in standalone (not tied to a vehicle).
- Zero risk to production data during migration.
- Same items + time entries flow for both order types.
- Single list/search/PDF/CSV pipelines that handle both types.

**Non-goals**
- Persistent "agregat profiles" (no separate `agregati` table — agregat data is stored on the work order itself, one-shot).
- Changing the type of an existing work order after creation (read-only after creation).
- Auto-classification of order type from input.
- Separate numbering schemes (one shared `YYYY-NNNN` sequence).
- Refactoring or restructuring beyond what this feature requires.

## User-visible decisions

| Decision | Value |
|---|---|
| Order types | `auto` (existing) and `agregat` (new) |
| Agregat data location | Inline on the `work_orders` row (no separate table) |
| Agregat fields | `tip_agregata`, `marka_agregata`, `model_agregata` (opt), `serijski_broj` (opt) |
| Tip agregata | Fixed dropdown: `alnaser` / `alternator` / `klima_kompresor` / `elektricni_uredjaj` / `ostalo` |
| Creation entry points | Two header buttons: "Novi auto nalog" / "Novi agregat nalog" |
| List view | Single list with Tip badge + filter (Sve / Auto / Agregat) |
| Numbering | Single shared sequence `YYYY-NNNN` (no prefix) |
| Tip change after creation | Disabled |

## Architecture

### Schema migration (additive only)

In `src/db/index.ts` `runMigrations()`:

1. **Auto file backup before any DDL.** If `DB_PATH !== ":memory:"` AND the new columns do not yet exist (= this is the first run of the new code), copy `data/asnord.db` → `data/asnord.db.bak-<ISO timestamp>`. If copy fails (permission, disk space), migration aborts and server fails to start. Backup file is kept indefinitely; user deletes manually.
2. Add new columns:
   ```sql
   ALTER TABLE work_orders ADD COLUMN tip_naloga TEXT NOT NULL DEFAULT 'auto';
   ALTER TABLE work_orders ADD COLUMN tip_agregata TEXT;
   ALTER TABLE work_orders ADD COLUMN marka_agregata TEXT;
   ALTER TABLE work_orders ADD COLUMN model_agregata TEXT;
   ALTER TABLE work_orders ADD COLUMN serijski_broj TEXT;
   ```

Existing rows automatically receive `tip_naloga='auto'` via the column default. Existing NOT NULL constraints on `registarske_tablice`, `marka_vozila`, `model_vozila` are left intact.

### Data convention for agregat orders

Because `registarske_tablice`, `marka_vozila`, `model_vozila` remain NOT NULL, agregat orders store **empty string `''`** in those columns. Other auto-only nullable columns (`vin_broj`, `motor`, `kilometraza`) store `NULL`. The discriminator `tip_naloga` is the source of truth — code should never branch on the empty-string heuristic.

### Validation (server-side, in `createWorkOrder` / `updateWorkOrder`)

```
if data.tip_naloga === 'auto':
  required: customer_id, registarske_tablice, marka_vozila, model_vozila
  server stores agregat columns as NULL (regardless of what client sent)
if data.tip_naloga === 'agregat':
  required: customer_id, tip_agregata (in enum), marka_agregata
  server stores: registarske_tablice='', marka_vozila='', model_vozila=''
                 vin_broj=NULL, motor=NULL, kilometraza=NULL
```

`updateWorkOrder` rejects any request that tries to change `tip_naloga` from the existing value (400 "Tip naloga se ne može mijenjati nakon kreiranja").

### Search

- `getWorkOrders` accepts new optional query param `tip_naloga` ∈ `'auto'` | `'agregat'`. Without it, returns all.
- `searchWorkOrders` `q` param matches across both types: VIN, plates, customer name **OR** `serijski_broj`, `marka_agregata`, `model_agregata`. If `tip_naloga` is also passed, narrows to that type.

## Components

| File | Change |
|---|---|
| `src/db/schema.ts` | Add new columns to `createTablesSQL` so fresh DBs already have them |
| `src/db/index.ts` | `runMigrations()`: file backup + 5× ALTER TABLE ADD COLUMN |
| `src/types/index.ts` | `TipNaloga`, `TipAgregata` types; extend `WorkOrder`; replace `WorkOrderForm` with discriminated union `WorkOrderFormAuto \| WorkOrderFormAgregat` |
| `src/api/work-orders.ts` | Conditional validation, type-aware INSERT/UPDATE, new `tip_naloga` filter, search across both types, CSV export/import include new columns |
| `src/components/work-orders/WorkOrderForm.tsx` | **Renamed to `AutoWorkOrderForm.tsx`** (no functional change). Internal name updated. |
| `src/components/work-orders/AgregatWorkOrderForm.tsx` | **New** — customer picker, tip dropdown, marka/model/serial inputs, mechanic, status, opis, napomena |
| `src/components/work-orders/WorkOrderList.tsx` | Two CTA buttons in header, segmented filter (Sve/Auto/Agregat), Tip badge column/row, agregat-specific row content |
| `src/components/work-orders/WorkOrderDetail.tsx` | Title shows tip; conditional "Vozilo" or "Agregat" section |
| `src/components/work-orders/WorkOrderSearch.tsx` | Placeholder hint adapts to active filter |
| `src/components/pdf/WorkOrderPDF.tsx` | Conditional VOZILO or AGREGAT header section |
| `src/lib/api.ts` | `workOrdersApi.create` accepts the union type; no signature change otherwise |
| `src/lib/formatters.ts` | New `getTipNalogaLabel`, `getTipAgregataLabel` helpers |

The auto and agregat forms intentionally remain separate components instead of one branching form. Vehicle picker logic in the auto form is substantial; merging would create a tangled file with `if/else` everywhere. Common building blocks (mechanic select, status select, opis/napomena) are simple inputs and don't warrant a shared sub-component until duplication actually hurts.

## Data shapes

### TypeScript types

```ts
export type TipNaloga = 'auto' | 'agregat';
export type TipAgregata = 'alnaser' | 'alternator' | 'klima_kompresor' | 'elektricni_uredjaj' | 'ostalo';

export interface WorkOrder {
  id: number;
  broj_naloga: string;
  customer_id: number;
  tip_naloga: TipNaloga;
  // Auto fields (string '' for agregat orders, real values for auto)
  registarske_tablice: string;
  marka_vozila: string;
  model_vozila: string;
  vin_broj: string | null;
  motor: string | null;
  kilometraza: number | null;
  // Agregat fields (NULL for auto orders)
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
  // Joined
  customer?: Customer;
  mechanic?: Mechanic;
  items?: WorkOrderItem[];
  time_entries?: TimeEntry[];
}

export type WorkOrderFormAuto = {
  tip_naloga: 'auto';
  customer_id: number;
  registarske_tablice: string;
  marka_vozila: string;
  model_vozila: string;
  vin_broj?: string;
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

### Bosnian labels

```ts
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
```

## UI flow

### List header

```
[+ Novi auto nalog]  [+ Novi agregat nalog]               [Sve · Auto · Agregat]
```

Two buttons left, segmented filter right. Filter persists in URL search param `?tip=auto`. Default = Sve.

### List rows

Mobile rastri and desktop table both add a Tip badge:

| Tip | Auto row | Agregat row |
|---|---|---|
| Badge | 🚗 **Auto** (blue) | ⚙️ **Agregat** (orange) |
| Vehicle/Unit text | `Audi A4 · ABC-123` | `Alnaser · Bosch` (+ model if present) |
| Customer | (unchanged) | (unchanged) |
| Status, broj, datum | (unchanged) | (unchanged) |

### AgregatWorkOrderForm

```
Header: "Novi agregat nalog" / "Uredi agregat nalog"
─────────────────────────────────────────────
Klijent *           [CustomerSelect]
─────────────────────────────────────────────
Tip agregata *      [Select: Alnaser | Alternator | Klima kompresor | El. uređaj | Ostalo]
Marka *             [Input: Bosch, Valeo, ...]
Model               [Input]
Serijski broj       [Input]
─────────────────────────────────────────────
Mehaničar           [Select]
Status              [Select: Otvoren | U toku | Završen]
Opis kvara          [Textarea]
Napomena            [Textarea]
─────────────────────────────────────────────
[Odustani]                    [Sačuvaj]
```

### WorkOrderDetail

- Title: `Nalog 2026-0042 · Auto` or `Nalog 2026-0042 · Agregat`.
- Conditional section:
  - `tip_naloga === 'auto'` → existing **Vozilo** section (marka, model, registarske, VIN, motor, km).
  - `tip_naloga === 'agregat'` → new **Agregat** section (tip, marka, model, serijski).
- Items + time entries + customer + mechanic — identical for both.
- Edit button always opens the matching form (Auto or Agregat); never offers tip toggle.

### WorkOrderPDF

Header detail section conditional on tip — VOZILO block or AGREGAT block. Items table and totals identical.

## Edge cases

| Scenario | Behavior |
|---|---|
| Pre-migration row | `tip_naloga = 'auto'` via column default; existing data untouched. |
| User tries to change `tip_naloga` on edit | Form does not expose the field; server rejects with 400 if attempted. |
| Filter "Agregat" with no agregat orders | Empty state: "Nema agregat naloga". |
| Add item / scan invoice on agregat nalog | Works identically — items table has no order-type coupling. |
| Mechanic role | Authorization unchanged (filter by `mechanic_id`). Both order types respect it. |
| CSV export | Includes `tip_naloga`, `tip_agregata`, `marka_agregata`, `model_agregata`, `serijski_broj` columns. |
| CSV import (older file) | Missing new columns → defaults `tip_naloga='auto'`, agregat columns NULL. |

## Error handling

| Failure | Server | UX |
|---|---|---|
| `tip_naloga` missing/invalid | 400 "Tip naloga je nevalidan" | Inline error |
| Auto missing `registarske_tablice` | 400 "Registarske tablice su obavezne" | Inline error under field |
| Agregat missing `tip_agregata` | 400 "Tip agregata je obavezan" | Inline error |
| Agregat `tip_agregata` not in enum | 400 "Tip agregata je nevalidan" | Inline error |
| Agregat missing `marka_agregata` | 400 "Marka agregata je obavezna" | Inline error |
| Edit tries to change tip | 400 "Tip naloga se ne može mijenjati nakon kreiranja" | Toast/inline (form shouldn't allow it anyway) |
| Backup copy fails on startup | Migration aborts; server fails to start with logged error | Operator sees server log, fixes file permissions, restarts |

## Testing

### Server unit tests

`src/api/work-orders.tip-naloga.test.ts` (in-memory DB, mirrors `work-orders.bulk.test.ts` pattern):

- Create auto nalog: requires car fields (test missing → 400; complete → 201).
- Create agregat nalog: requires `tip_agregata` + `marka_agregata` (test missing → 400; complete → 201).
- Create agregat nalog: server stores `marka_vozila=''` even if client sent something.
- Create agregat nalog: agregat columns populated correctly.
- Update: cannot change `tip_naloga` (test passes new value → 400, value unchanged).
- Update agregat fields on agregat nalog: works.
- `getWorkOrders?tip_naloga=agregat`: returns only agregat orders.
- `searchWorkOrders` by `serijski_broj`: returns matching agregat order.
- `searchWorkOrders` by VIN + tip filter: agregat nalog with that VIN-like serial does NOT match (tip filter wins).

### Schema/migration tests

`src/db/migrations.test.ts`:

- Fresh `:memory:` DB → all new columns present.
- Pre-existing-state simulation: insert work_order without new columns (skipped — `:memory:` always runs createTablesSQL with new columns; emulate by manually dropping new columns and re-running runMigrations) → after migration, row has `tip_naloga='auto'`.

Backup file behavior is excluded from automated tests (file-system dependency); verified manually in E2E.

### Manual E2E

1. Server starts cleanly with existing production-like DB (file copy of real data).
2. Backup file appears at `data/asnord.db.bak-<timestamp>`.
3. Existing auto nalog opens and renders normally.
4. Create new auto nalog → appears with Auto badge in list.
5. Create new agregat nalog (Alnaser, Bosch, optional serial) → appears with Agregat badge.
6. Filter "Agregat" → only agregat orders shown.
7. Open agregat nalog → "Agregat" detail section renders, no "Vozilo" section.
8. Add part item to agregat nalog → works.
9. Scan invoice on agregat nalog → works.
10. Print PDF for both types → correct headers.
11. Export CSV → contains new columns; reimport on a fresh DB → both types preserved.
12. Mechanic user sees only their own orders, regardless of tip.
13. Try to PUT a tip change via direct API call → 400.

## Open items

None — design is complete pending the implementation plan.
