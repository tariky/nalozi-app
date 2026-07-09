# Skeniranje saobraćajne dozvole

**Datum:** 2026-07-09

## Problem

Otvaranje radnog naloga za auto traži ručno kucanje klijenta i pet polja vozila (marka, model, tablice, VIN, motor). VIN ima 17 znakova i najčešće se prekuca. Svi ti podaci već stoje na saobraćajnoj dozvoli koju vozač donosi sa sobom.

Aplikacija već ima obrazac za ovo: `src/api/invoice-scan.ts` slika račun dobavljača i vadi stavke preko OpenRoutera.

## Rješenje

Dugme **"Skeniraj saobraćajnu"** na stranici radnih naloga. Jedna slika, jedan ekran potvrde, pa otvorena forma naloga s popunjenim klijentom i vozilom.

Ključ je što `vehicles.vin_broj` jedinstveno identificira vozilo, a vozilo nosi svog klijenta. Za auto koje je već bilo u servisu, skeniranje daje i vozilo i vlasnika bez ijednog kucanog slova. Za novo auto, ime vlasnika s dokumenta služi da se pronađe ili kreira klijent.

### Tok

```
VOZILO
  ✓ VW Golf 7 · A12-B-345          pronađeno u bazi
    (ili)
  + Novo vozilo   VW Golf 7 · A12-B-345 · WVWZZZ1K… · 2.0 TDI   [uredi]
    (ili)
  ? Slično vozilo: WVWZZZ1K5 (VIN se razlikuje u 1 znaku)
    [ To je ovo vozilo ]   [ Ipak novo ]

KLIJENT
  ✓ Pero Perić · 061-999-000
    (ili)
  ? 2 klijenta odgovaraju imenu "Marko Marić":
    ○ Marko Marić · 061-111-222
    ○ Marko Marić · 062-333-444
    ○ Novi klijent "Marko Marić"    [telefon ______]

              [ Otvori radni nalog ]
```

Potvrda kreira samo ono što nedostaje.

## Poklapanje

**Vodeće pravilo: fuzzy pretraga širi listu kandidata, nikad ne odlučuje.** Postoji da kandidat ne promakne zbog OCR greške ili dijakritike. Izbor između dva kandidata uvijek pripada korisniku.

### VIN

Standard zabranjuje slova `I`, `O` i `Q` u VIN-u — upravo zato što liče na `1` i `0`. Svako čitanje tih slova je greška, pa se pri poređenju preslikavaju:

```
O → 0     Q → 0     I → 1
```

Time najčešća OCR zamjena nestaje prije poređenja. Zatim se odbacuje sve osim slova i cifara, i sve prelazi u velika slova.

Nakon kanonizacije: egzaktno poklapanje daje `vin_exact`. Levenshtein razdaljina ≤ 2 daje `vin_near` — kandidat koji se **nudi**, ne bira.

### Tablice

Rezerva kad VIN nije čitljiv. Velika slova, uklonjene crtice i razmaci: `A12-B-345` → `A12B345`. Poklapanje daje `plates`.

### Ime vlasnika

Normalizacija skida dijakritiku, pa `Marić` odgovara `Maric`. Ali `Đ` (U+0110) je zasebno slovo i NFD ga **ne rastavlja** — traži izričito preslikavanje `Đ`→`D`, `đ`→`d`. Bez toga `Đurić` ne pogađa `Duric`.

Poredi se i `ime prezime` i `prezime ime`, jer redoslijed na dokumentu nije zajamčen, te `naziv_firme`. Sličnost je `1 - levenshtein / maxLen`, prag **0.72**, vraća se najboljih **5**.

### Kada se bira automatski

`autoSelect.vehicleId` se postavlja **samo** kad postoji tačno jedno egzaktno poklapanje VIN-a.

`autoSelect.customerId` se postavlja **samo** kad je vozilo automatski odabrano **i** ime na saobraćajnoj odgovara vlasniku tog vozila (score ≥ 0.72) **ili nije čitljivo**. Ako se poklapa loše, oba se prikazuju uz upozorenje:

> Vozilo je u bazi na *Pero Perić*, a saobraćajna glasi na *Marko Marić*. Vozilo je vjerovatno prodano.

**Klijent se nikad ne bira automatski po imenu**, ni pri savršenom poklapanju — imenjaci postoje. Dva ili više kandidata bilo gdje u lancu znači lista bez predodabranog.

### Popravak postojećeg `checkVin`

`src/api/vehicles.ts` `checkVin` radi `.get()` i tiho uzima prvi red ako u bazi postoje dva vozila s istim VIN-om. Novi resolve koristi `.all()`, vraća oba kandidata i dodaje upozorenje. `checkVin` ostaje netaknut — nije u opsegu ovog posla.

## Podaci o vlasniku

Vadi se **samo ime i prezime**, jer imaju svrhu: pronaći klijenta. Adresa se ne vadi — `customers` nema kolonu za nju, nema je gdje upisati, a najosjetljiviji je podatak na dokumentu.

Slika dokumenta se u cijelosti šalje OpenRouteru bez obzira na to koja polja model vraća. Ovo je svjesna razmjena, ista kao kod postojećeg skeniranja računa.

## API

`POST /api/vehicles/scan-registration` — auth + CSRF, multipart. Ista pravila za sliku kao scan računa: samo `image/*`, max 8 MB, timeout 45 s. Model `google/gemini-3.5-flash` preko OpenRoutera, `response_format: { type: "json_object" }`.

Jedan upload vraća dokument, kandidate i odluku:

```ts
interface ScannedRegistration {
  marka_vozila: string | null;
  model_vozila: string | null;
  registarske_tablice: string | null;
  vin_broj: string | null;
  motor: string | null;
  vlasnik: { ime: string | null; prezime: string | null };
}

interface VehicleCandidate {
  vehicle: Vehicle;
  customer: { id: number; ime: string; prezime: string; telefon: string | null } | null;
  match: 'vin_exact' | 'vin_near' | 'plates';
}

interface CustomerCandidate {
  customer: Customer;
  score: number;
}

interface ScanRegistrationResponse {
  document: ScannedRegistration;
  vehicleCandidates: VehicleCandidate[];
  customerCandidates: CustomerCandidate[];
  autoSelect: { vehicleId: number | null; customerId: number | null };
  warnings: string[];
}
```

Pravila odabira žive na serveru, u `autoSelect` — jedno mjesto, testabilno bez browsera. Klijent samo crta.

### Moduli

Granica postoji zato što je poklapanje ono što zaista treba testovima, a mreža i baza to otežavaju.

**`src/api/registration-match.ts`** — čiste funkcije, bez baze i bez mreže:

| funkcija | ulaz → izlaz |
|---|---|
| `canonicalVin(s)` | sirovi VIN → kanonski oblik |
| `normalizePlates(s)` | tablice → bez crtica i razmaka |
| `normalizeName(s)` | ime → velika slova bez dijakritike |
| `levenshtein(a, b)` | dva stringa → razdaljina |
| `matchVehicles(doc, vehicles)` | → `{ candidates: VehicleCandidate[], warnings: string[] }` |
| `matchCustomers({ ime, prezime }, customers)` | → `CustomerCandidate[]` |
| `decideAutoSelect(doc, vehicleCandidates, customerCandidates)` | → `{ vehicleId, customerId, warnings: string[] }` |

`matchVehicles` prijavljuje sudar kad dva vozila dijele VIN. `decideAutoSelect` prijavljuje neusklađenog vlasnika. Handler spaja oba skupa upozorenja u `warnings` odgovora.

**`src/api/registration-scan.ts`** — handler: auth, validacija slike, OpenRouter poziv, `parseRegistrationResponse` (striktna validacija odgovora, po uzoru na `parseModelResponse`), upit u bazu, poziv matchera.

### Greške

| status | uzrok | poruka |
|---|---|---|
| 401 | nema sesije | (auth helper) |
| 403 | loš CSRF | (auth helper) |
| 400 | nije slika, ili > 8 MB | Slika nije validna / prevelika |
| 503 | nema `OPENROUTER_API_KEY` | Servis nije konfigurisan |
| 504 | timeout | Vrijeme za obradu isteklo |
| 502 | OpenRouter nedostupan ili vrati grešku | OpenRouter greška |
| 422 | model vratio neispravan JSON | Model nije vratio ispravan format |
| 422 | dokument nema ni VIN ni tablice | Nije prepoznata saobraćajna, pokušajte sa jasnijom slikom |

Posljednji slučaj postoji jer bez VIN-a i bez tablica nema po čemu tražiti — scan je tehnički uspio, ali je bezvrijedan.

## Frontend

`src/components/vehicles/RegistrationScanDialog.tsx` — faze `idle → scanning → error → review`, isti oblik kao `InvoiceScanDialog`. U review fazi se polja vozila mogu urediti, kandidat odabrati, a klijent odabrati ili kreirati (uz polje za telefon).

Dugme na `WorkOrderList` pored "Novi nalog". Potvrda kreira klijenta i/ili vozilo ako nedostaju, pa `App` otvara `work-orders/new/auto` i prosljeđuje popunjene vrijednosti kroz novi opcioni `prefill` prop na `WorkOrderForm`.

`src/lib/api.ts` dobija `registrationScanApi.scan(file)`, koji zaobilazi `fetchApi` da bi poslao `FormData` s CSRF zaglavljem — isto kao `invoiceScanApi`.

## Testovi

`bun test`, bez mreže.

`registration-match.test.ts`:

- `canonicalVin` preslikava `O`/`Q` u `0` i `I` u `1`, briše crtice i razmake
- `normalizeName` skida dijakritiku, uključujući `Đ` → `D`
- `Marko Marić` pogađa `Marko Maric`, i u obrnutom redoslijedu `Marić Marko`
- sličnost ispod 0.72 se odbacuje
- **dva klijenta istog imena vraćaju oba kandidata i `autoSelect.customerId === null`**
- VIN s jednom greškom daje `vin_near`, ne `vin_exact`
- dva vozila s istim VIN-om vraćaju oba kandidata i upozorenje
- vlasnik koji ne odgovara vlasniku pronađenog vozila gasi `autoSelect.customerId`

`registration-scan.test.ts`:

- `parseRegistrationResponse` skida markdown ograde, odbija ne-objekt, prazna polja pretvara u `null`
- dokument bez VIN-a i bez tablica vodi u 422
- 401 bez sesije
- 503 bez `OPENROUTER_API_KEY` (bez dodirivanja mreže)

## Van opsega

- Skeniranje iz dijaloga "Novo vozilo". Komponenta ostaje takva da se tamo kasnije trivijalno ubaci, ali dva ulaza za istu stvar prije nego što se zna kako se prvi koristi ne pišemo.
- Adresa vlasnika i migracija `customers`.
- Godište i gorivo kao nove kolone na `vehicles`.
- Promjena modela za skeniranje računa.
