# Javna servisna historija vozila putem QR koda

**Datum:** 2026-07-07
**Status:** Odobreno za planiranje

## Cilj

Za svako vozilo klijenta omogućiti štampanje papira sa QR kodom. Skeniranjem QR
koda bilo ko (npr. potencijalni kupac auta) otvara **javnu** web stranicu sa
kompletnom servisnom historijom tog vozila — **bez cijena i bez ličnih podataka
vlasnika**.

## Ključne odluke

| Pitanje | Odluka |
|---|---|
| Šta se vidi javno | Datum, kilometraža, opis posla, dijelovi i usluge (nazivi), ime mehaničara. **Bez** cijena i **bez** ličnih podataka vlasnika. |
| Identitet auta | Grupisanje po VIN broju; fallback na registarske tablice ako nalog nema VIN. |
| Odakle štampanje | Sa stranice klijenta (`CustomerDetail`), dugme po vozilu. |
| Oblik linka | Nasumični token u URL-u (`/s/:token`) — ne otkriva VIN, ne može se nabrajati. |
| Oblik papira | PDF za download (konzistentno s postojećim `WorkOrderPDF`). |

## Arhitektura

### 1. Pristupni model (zaobilaženje logina)

Cijela aplikacija je iza logina (`App.tsx`: `if (!user) return <LoginPage/>`) i
koristi hash-baziran routing (`#work-orders`, `#customers/view/1`, ...).

Javna stranica koristi **pravi path** `/s/:token` (ne hash). Bun servira
`index.html` za sve nematchovane rute (`/*` → `index`), pa React aplikacija
uvijek boot-a. U `App.tsx`, **prije** `AuthProvider` gate-a:

```
if (window.location.pathname.startsWith("/s/")) {
  return <PublicServiceHistory token={pathname.slice(3)} />;
}
```

Time se javna stranica renderuje potpuno izvan auth konteksta i Layout-a.
Ostatak aplikacije ostaje netaknut.

### 2. Token (ne otkriva VIN)

Nova tabela u `src/db/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS vehicle_public_tokens (
  token TEXT PRIMARY KEY,
  vehicle_id INTEGER NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_tokens_vehicle ON vehicle_public_tokens(vehicle_id);
```

- Jedan token po vozilu (`vehicle_id UNIQUE`) — isti auto uvijek daje isti link,
  pa ponovna štampa ne mijenja QR.
- Token = nasumičnih ~10 znakova generisanih preko `crypto.getRandomValues`
  (isti stil kao `generateSessionId` u `api/auth.ts`, ali kraće).

### 3. API endpointi

**`POST /api/vehicles/:id/public-token`** (zahtijeva auth — `requireAuth`)
- Ako token za to vozilo postoji → vrati ga.
- Inače kreiraj novi i vrati `{ token }`.
- Idempotentno.

**`GET /api/public/service-history/:token`** (**bez auth-a** — javno)
- Riješi token → `vehicle_id` → vozilo (`vin_broj`, `registarske_tablice`,
  `marka_vozila`, `model_vozila`).
- Ako token ne postoji → 404.
- Historija naloga:
  - Ako vozilo ima `vin_broj` → `SELECT ... FROM work_orders WHERE vin_broj = ?`
  - Inače → `WHERE registarske_tablice = ?`
  - Sortirano po `created_at DESC`.
- Za svaki nalog učitaj stavke iz `work_order_items`.
- Odgovor (sanitizovan):

```json
{
  "company": { "naziv": "...", "logo": "..." },
  "vehicle": { "marka_vozila": "...", "model_vozila": "...", "registarske_tablice": "..." },
  "visits": [
    {
      "datum": "2026-05-01T...",
      "kilometraza": 145000,
      "opis_kvara": "Servis kočnica",
      "mehanicar": "Ime Prezime",
      "items": [
        { "tip": "dio", "naziv": "Pločice prednje", "kolicina": 1 },
        { "tip": "usluga", "naziv": "Zamjena pločica", "kolicina": 1 }
      ]
    }
  ]
}
```

- **Izostavlja se u potpunosti:** `jedinicna_cijena`, `popust`,
  `ukupna_cijena` (na nalogu i na stavkama), ime/telefon/email/firma klijenta,
  `napomena` (interne bilješke), `broj_naloga`, `vin_broj`.
- Nova ruta se registruje u `src/index.ts`:
  - `"/api/vehicles/:id/public-token": { POST: createVehiclePublicToken }`
  - `"/api/public/service-history/:token": { GET: getPublicServiceHistory }`

### 4. Javna stranica `PublicServiceHistory`

Nova komponenta `src/components/public/PublicServiceHistory.tsx`:
- Mobilno-prvi, brendiran (logo + naziv firme iz odgovora).
- Naslov: "Servisna historija vozila" + marka/model/tablice.
- Timeline posjeta (najnovije prvo): datum · kilometraža · opis · ime
  mehaničara · lista dijelova i usluga (nazivi + količina).
- Stil u skladu s aplikacijom: bez okvira/bordera, jednostavno.
- Stanja: loading (skeleton/tekst), 404 ("Vozilo nije pronađeno"), prazno
  ("Nema zabilježenih servisa").
- Fetch direktno na `/api/public/service-history/:token` (bez auth headera).

### 5. QR generisanje i PDF za štampu

- Nova dependency: **`qrcode`** (`bun add qrcode` + `@types/qrcode`) —
  generiše PNG data-URL koji `@react-pdf` pouzdano renderuje kao `Image`.
- Nova sekcija "Vozila" na `CustomerDetail` koja lista vozila klijenta
  (`GET /api/vehicles/by-customer/:customerId` već postoji), sa dugmetom
  **"Printaj QR karticu"** po vozilu.
- Flow na klik:
  1. `POST /api/vehicles/:id/public-token` → `{ token }`
  2. `url = window.location.origin + "/s/" + token`
  3. `QRCode.toDataURL(url)` → PNG data-URL
  4. Generiši i preuzmi PDF.
- Novi `src/components/pdf/VehicleQRPDF.tsx` (@react-pdf, isti stil kao
  `WorkOrderPDF`):
  - Zaglavlje: logo + naziv/kontakt firme (reuse `canRenderLogo` obrasca).
  - Naslov: "Servisna historija vozila".
  - Marka/model + registarske tablice.
  - **Veliki QR kod** (centriran).
  - Uputa: "Skenirajte QR kod za uvid u kompletnu servisnu historiju vozila".
  - Tekstualni URL ispod QR-a.
  - Footer u stilu postojećeg PDF-a.
  - Export `generateVehicleQRPDF(vehicle, company, qrDataUrl, url)`.

## Granice jedinica (isolation)

- **`api/vehicle-tokens.ts`** (novi): `createVehiclePublicToken`,
  `getPublicServiceHistory`. Zna samo za DB i sanitizaciju. Ne zna za UI.
- **`PublicServiceHistory.tsx`**: prikazuje sanitizovani JSON. Ne zna za auth.
- **`VehicleQRPDF.tsx`**: čista prezentacija; prima gotov QR data-URL. Ne
  generiše QR niti zove API.
- **QR generisanje** živi u pozivaocu (CustomerDetail handler) — PDF komponenta
  ostaje bez side-efekata.

## Testiranje

`src/api/vehicle-tokens.test.ts` (`bun test`, obrazac kao `settings.test.ts`):
1. `createVehiclePublicToken` je idempotentan — dva poziva za isto vozilo daju
   isti token.
2. `getPublicServiceHistory` grupiše naloge po VIN-u (nalozi s istim VIN-om, i
   kad su na različitim tablicama, dolaze zajedno).
3. Fallback na tablice kad vozilo nema VIN.
4. **Sanitizacija**: odgovor ne sadrži nijedno polje s cijenom niti ličnim
   podacima klijenta (provjera da `jedinicna_cijena`, `ukupna_cijena`, `telefon`,
   `email`, `napomena` nisu prisutni).
5. Nepostojeći token → 404.

## Van opsega (YAGNI)

- Nema opoziva/rotacije tokena kroz UI.
- Nema QR-a za agregate (samo vozila/auto nalozi).
- Nema server-side renderovanja javne stranice (ostaje SPA).
- Nema izmjene postojeće auth zaštite ostalih endpointa.
