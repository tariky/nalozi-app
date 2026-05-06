# Invoice OCR Scan — Design

**Date:** 2026-05-06
**Status:** Approved (pending implementation plan)

## Summary

Add a feature to `WorkOrderItems` that lets the user take or upload a photo of a supplier parts invoice. The image is OCR'd by an OpenRouter vision model, parsed items are shown in an editable review table, and on confirmation all items are inserted into the work order in a single transaction.

## Goals & non-goals

**Goals**
- Speed up entering parts from a paper supplier invoice (the current flow is one item at a time via dialog).
- Keep the user in control: every parsed item is reviewable and editable before it lands in the DB.
- Atomic insertion — partial inserts on failure are not acceptable.

**Non-goals**
- Persisting scanned invoice images or OCR audit trail.
- Auto-classifying parts vs services from the image (everything defaults to `dio`; user can flip in review).
- Tax handling beyond extracting the price-with-VAT column.
- Currency conversion (assumes invoice is in KM/BAM, same as the work order).
- Improving OCR accuracy beyond what the chosen model gives — the review step is the safety net.

## User-visible decisions

| Decision | Value |
|---|---|
| Workflow | Review step before adding (editable table, "Dodaj sve") |
| Model | `qwen/qwen3.5-flash-02-23` via OpenRouter |
| API key storage | `OPENROUTER_API_KEY` in `.env`, server-side only |
| Default item type | `dio` (part); user can flip individual rows to `usluga` |
| UI placement | Third button in `WorkOrderItems` toolbar: `[+ Usluga] [+ Dio] [📷 Skeniraj račun]` |
| Price column used | `Cijena sa PDV-om` (price WITH VAT) |
| Image limit | 8MB, MIME starts with `image/` |
| OpenRouter timeout | 45s, single attempt (user retries manually) |

## Architecture

```
[Browser]                              [Bun server]                [OpenRouter]
WorkOrderItems
  └ "Skeniraj račun" button
      └ opens InvoiceScanDialog
          ├ 1. capture/upload image  ──POST multipart──▶  POST /api/work-orders/scan-invoice
          │                                                    │
          │                                                    ├─ requireAuth + validateCsrf
          │                                                    ├─ validate file (type, ≤8MB)
          │                                                    ├─ base64-encode
          │                                                    └─ POST chat/completions ─▶ qwen/qwen3.5-flash-02-23
          │                                                                                  │ (vision + JSON response)
          │                                                    ┌────────────────────────────┘
          │                                                    └─ parse JSON, validate shape
          ◀──────────── { items, warnings } ──────────────────┘
          ├ 2. user reviews/edits in editable table
          └ 3. "Dodaj sve" ──POST──▶ POST /api/work-orders/:id/items/bulk
                                          ├─ requireAuth + validateCsrf + role check
                                          ├─ db.transaction:
                                          │   ├─ INSERT each work_order_item
                                          │   └─ recalculate ukupna_cijena
                                          └─ returns updated WorkOrder
```

The OCR endpoint never touches the DB — it's a pure "image in, items out" function. The bulk-add endpoint never talks to OpenRouter. Each piece is independently testable.

## Components

### New: `src/api/invoice-scan.ts`

Single responsibility: call OpenRouter and return validated items.

- Reads `OPENROUTER_API_KEY` at request time. If missing, returns 503 `"Servis nije konfigurisan"`.
- Builds the prompt (see [OpenRouter prompt](#openrouter-prompt) below).
- Posts to `https://openrouter.ai/api/v1/chat/completions` with `AbortController` (45s).
- Validates the model's JSON against the expected shape using a small hand-rolled validator (no extra dependency).
- Exports `scanInvoice(req: Request): Promise<Response>`.

### Modified: `src/api/work-orders.ts`

Adds one new exported handler `bulkAddWorkOrderItems(req: Request): Promise<Response>`. Reuses the existing item-validation logic from `addWorkOrderItem`. Wraps all inserts and the total recalculation in a single `db.transaction()`.

### Modified: `src/index.ts`

Registers two new routes:
- `POST /api/work-orders/scan-invoice` → `scanInvoice`
- `POST /api/work-orders/:id/items/bulk` → `bulkAddWorkOrderItems`

### New: `src/components/work-orders/InvoiceScanDialog.tsx`

Self-contained dialog. Internal states: `idle | scanning | review | adding | error`. Owns the editable review table. Calls `invoiceScanApi.scan(file)` then `workOrderItemsApi.addBulk(workOrderId, rows)`. Emits `onUpdate()` on success, the parent `WorkOrderItems` triggers its existing reload.

Mobile/desktop split mirrors the existing `WorkOrderItems` pattern (compact list on mobile, table on desktop).

### Modified: `src/components/work-orders/WorkOrderItems.tsx`

Adds the third button `[📷 Skeniraj račun]` next to the existing `+ Usluga` / `+ Dio`. Renders `InvoiceScanDialog` and wires `onUpdate` to the existing `onUpdate` prop.

### Modified: `src/lib/api.ts`

Adds:
```ts
invoiceScanApi.scan(file: File): Promise<{ items: ParsedItem[]; warnings: string[] }>
workOrderItemsApi.addBulk(workOrderId: number, items: WorkOrderItemForm[]): Promise<WorkOrder>
```

## Data shapes

**OCR endpoint** — `POST /api/work-orders/scan-invoice`

Request: `multipart/form-data` with `file` field (image, ≤8MB, MIME `image/*`).

Response 200:
```ts
{
  items: Array<{
    naziv: string;
    kolicina: number;        // defaults to 1 if missing
    jedinicna_cijena: number; // unit price WITH VAT (KM)
    popust: number;          // %, defaults to 0
  }>;
  warnings: string[];
}
```

Errors: 400 (bad file), 422 (model output unparseable), 502 (OpenRouter HTTP error), 503 (env var missing), 504 (timeout).

**Bulk-add endpoint** — `POST /api/work-orders/:id/items/bulk`

Request:
```ts
{ items: WorkOrderItemForm[] }   // tip ('dio'|'usluga'), naziv, kolicina, jedinicna_cijena, popust per item
```

Response 200: the updated `WorkOrder` (same shape `getWorkOrderWithDetails` returns elsewhere). On any error the entire transaction rolls back and no items are inserted.

Authorization: same rules as `addWorkOrderItem` today — admin can bulk-add to any work order, mechanic only to their own.

## OpenRouter prompt

System role: `"You are an OCR parser for car parts supplier invoices in Bosnian/Croatian. Extract each line item. Return strict JSON only."`

User content array:
```ts
[
  { type: "text", text: instructions },
  { type: "image_url", image_url: { url: "data:image/jpeg;base64,<...>" } }
]
```

Instructions (text):
1. Skip non-item rows (header rows, totals, tax summary, freight, dates, address blocks).
2. For `jedinicna_cijena`, use `Cijena sa PDV-om` (price WITH VAT). If only one price column is present, use that.
3. Return strict JSON of shape `{ "items": [{ "naziv": string, "kolicina": number, "jedinicna_cijena": number, "popust": number }], "warnings": string[] }`. No markdown fences, no prose.
4. Use dot decimals (`12.50`), not commas. Numbers as numbers, never strings.
5. If quantity is missing, use `1`. If discount is missing, use `0`.
6. If you skip a row because data is unclear, append a short note to `warnings` explaining what you skipped.

Server validates the parsed JSON. If the model wraps output in ```json fences, strip them before parsing. Reject if `items` is missing or not an array, or any item lacks the required fields, or has non-numeric prices/quantities.

## Error handling

| Failure | Server | Client UX |
|---|---|---|
| Missing/invalid file | 400 | Toast: "Slika nije validna" |
| File too big | (client-side guard) | Toast: "Slika je prevelika (max 8MB)" |
| `OPENROUTER_API_KEY` missing | 503 "Servis nije konfigurisan" | Error state with that message |
| OpenRouter HTTP error | 502 | Error state with retry button |
| OpenRouter timeout (>45s) | 504 | Error state with retry button |
| Model returns invalid JSON | 422 (raw snippet logged server-side, not returned) | Error state: "Model nije vratio ispravan format. Pokušajte sa jasnijom slikom." |
| Model returns 0 items | 200 + empty `items` | "Nije pronađeno stavki na slici" + retry button |
| Bulk-add transaction fails | 500, full rollback | Toast; dialog stays in review state — user can retry without re-scanning |

No automatic retry loop on either endpoint. One click = one OpenRouter call.

## UI flow

```
[idle / file picker]
   │  user picks/captures image (camera on phones via capture="environment")
   ▼
[scanning]                ─ spinner + "Analiziram račun..."
   │
   ├── error → [error state] with retry button (re-pick image)
   ▼
[review table]            ─ editable rows (tip badge toggle, naziv, kolicina, cijena, popust, trash)
   │                       ─ live total preview in footer
   │                       ─ optional warnings banner
   │  user clicks "Dodaj sve N stavki"
   ▼
[adding]                  ─ disables buttons, brief spinner
   │
   ├── error → toast, stays in review state
   ▼
[done] → calls onUpdate(), closes dialog
```

File capture: `<input type="file" accept="image/*" capture="environment" />`. On phones this opens the rear camera; on desktop it opens the file picker. One control, both behaviors.

## Testing

The project has no established test setup yet. Adding `bun test` files alongside the new code.

**Server unit tests** (`src/api/invoice-scan.test.ts`):
- JSON validator rejects items with missing `naziv`, negative prices, non-numeric `kolicina`.
- Strips ```json fences if the model returns them.
- Prompt builder returns the expected message structure for given MIME.
- Mock `fetch` — never call OpenRouter from tests.

**Server unit tests** (`src/api/work-orders.bulk.test.ts`):
- Inserts N items in one transaction; verifies count + recalculated `ukupna_cijena`.
- 404 when work order doesn't exist.
- 403 when mechanic targets another mechanic's work order.
- Rolls back on bad item data; verifies no partial inserts.

**Manual E2E checks**:
1. Real photo of a Bosnian supplier invoice → review table shows reasonable items.
2. Blurry/dark image → either parses with warnings, or returns friendly error.
3. Non-invoice image → 0 items + "Nije pronađeno" message, no crash.
4. Mobile Safari + Chrome: camera capture opens rear camera.
5. Toggle a row from `dio` to `usluga` → lands correctly in DB.
6. Network kill mid-scan → error state with retry, no zombie spinner.
7. Bulk-add of valid items → work order total matches sum of items.

What we're explicitly NOT testing: OCR accuracy itself. The review step is the safety net.

## Open items

None — design is complete pending the implementation plan.
