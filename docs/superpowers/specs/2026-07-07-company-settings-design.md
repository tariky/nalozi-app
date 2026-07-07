# Postavke firme (naziv, kontakt, logo) — dizajn

Datum: 2026-07-07

## Cilj

Omogućiti administratoru da definiše podatke autoservisa (naziv firme, telefon,
email, adresa, ID/PDV broj, web stranica) i učita logo. Ti podaci se koriste u
zaglavlju PDF radnog naloga, u gornjoj navigaciji i na login stranici.

Aplikacija je jednokorisnička (jedan servis), pa se čuva jedan zapis postavki.

## Zahtjevi

- Uređivanje postavki: **samo admin**.
- Čitanje postavki: **samo prijavljeni korisnici** (nema javnog pristupa).
- Polja firme: `naziv`, `telefon`, `email`, `adresa`, `id_broj` (PDV/JIB), `web`, `logo`.
- Logo se učitava iz fajla (PNG/JPG/SVG), prikazuje se preview prije spremanja.
- Prikaz podataka na: PDF radnog naloga, TopNav. Login stranica ostaje na
  statičkom `logo.svg` (podaci firme su zaštićeni, ne čitaju se prije prijave).

## Odluke o dizajnu

### Pohrana logo-a: base64 data-URI u bazi

Logo se čuva kao data-URI string u tabeli postavki (ne kao fajl na disku).

- Razlog: radi svugdje bez novog endpointa za posluživanje fajlova —
  `@react-pdf` `Image` prima data-URI, isto i `<img>` u nav/loginu. Backup baze
  (postojeći `backupDatabaseFile`) automatski uključuje logo.
- Logoi su mali; ograničavamo na max 200KB nakon enkodiranja.
- Odbačena alternativa: fajl na disku + putanja — zahtijeva novi route i
  komplikuje backup, nepotrebno za jednu malu sliku.

## Arhitektura

### 1. Baza — tabela `company_settings`

Single-row tabela (`id = 1`). Dodaje se kroz postojeći `createTablesSQL`
(`CREATE TABLE IF NOT EXISTS`) i idempotentnu logiku u `runMigrations`.

```sql
CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  naziv TEXT,
  telefon TEXT,
  email TEXT,
  adresa TEXT,
  id_broj TEXT,
  web TEXT,
  logo TEXT,               -- data-URI (base64) ili NULL
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Pri prvom pokretanju osigurati postojanje reda `id=1` (INSERT OR IGNORE sa
praznim vrijednostima), da GET uvijek vraća objekt.

### 2. API — `src/api/settings.ts`

- `GET /api/settings/company` — vraća jedini zapis. **Zahtijeva autentikaciju**
  (svi prijavljeni korisnici, kao ostali zaštićeni GET-ovi).
- `PUT /api/settings/company` — sprema postavke. **Samo admin**, uz CSRF
  provjeru kao ostali mutacijski pozivi. Validira veličinu logo stringa (max 200KB).

Login stranica je prije autentikacije i ne dohvata postavke — ostaje na
statičkom `logo.svg` fallback-u. Svi podaci firme su tako zaštićeni iza auth-a.

### 3. Frontend — stranica Postavke

`src/components/settings/CompanySettings.tsx`:

- Nova admin-only stavka `Postavke` u `TopNav` i `MobileNav` (uz filter po ulozi,
  kao postojeći `users`).
- Nova ruta/`case` u `App.tsx` (`settings`).
- Forma sa svim tekstualnim poljima + logo upload:
  - `<input type="file" accept="image/png,image/jpeg,image/svg+xml">`.
  - Fajl se čita u browseru (`FileReader.readAsDataURL`), prikazuje preview,
    validira tip i veličinu (max 200KB), šalje u PUT kao data-URI string.
  - Dugme za uklanjanje logo-a (postavlja `logo = null`).
- Koristi postojeće `ui` komponente (input, button, card) i obrazac formi kao
  `MechanicForm`/`CustomerForm`.

### 4. Context — `CompanySettingsContext`

`src/contexts/CompanySettingsContext.tsx`:

- Dohvati postavke jednom nakon prijave, dijeli ih kroz aplikaciju (nav, PDF).
- `refresh()` nakon spremanja u Postavkama.
- Login stranica ne koristi context niti dohvata postavke (prije prijave je).

### 5. Korištenje podataka

- **PDF** (`WorkOrderPDF.tsx`): funkcija za generisanje PDF-a prima
  `companySettings`; zaglavlje prikazuje logo (ako postoji) + naziv, adresu,
  telefon, email, PDV pored/iznad naslova "RADNI NALOG". Pozivalac (detalj
  naloga) prosljeđuje postavke iz context-a.
- **TopNav**: logo iz postavki s fallback-om na postojeći `logo.svg`; naziv firme
  pored logo-a ako je postavljen.
- **Login**: bez izmjena — ostaje statički `logo.svg` (podaci zaštićeni iza auth-a).

## Rukovanje greškama

- GET uvijek vraća objekt (red `id=1` zagarantovan), polja mogu biti prazna →
  UI koristi fallback vrijednosti.
- PUT: 403 ako nije admin; 400 ako logo prelazi limit ili je nevažeći tip;
  validacija emaila/URL-a je meka (upozorenje, ne blokira).
- Logo koji nije slika ili je prevelik odbija se na klijentu prije slanja i
  ponovo provjerava na serveru.

## Testiranje

- API test (`src/api/settings.test.ts`): GET vraća default red; PUT kao admin
  sprema i vraća ažurirane vrijednosti; PUT kao ne-admin → 403; PUT s prevelikim
  logo-om → 400; GET bez sesije → 401.
- Ručna provjera: upload logo-a → prikaz u nav i PDF-u.

## Van opsega (YAGNI)

- Više firmi / multi-tenant.
- Verzionisanje ili historija postavki.
- Zaseban CDN/file-store za slike.
