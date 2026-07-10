# Harmonizirani EU kodovi u skeniranju saobraćajne

**Datum:** 2026-07-10

## Problem

Skener saobraćajne (`src/api/registration-scan.ts`) čita bosanski obrazac tako što se oslanja na **raspored linija**: prezime na prvoj liniji bloka `C`, ime na drugoj, adresa na trećoj. To radi dok su svi dokumenti bosanski.

Kad u servis dođe auto sa stranom saobraćajnom, pretpostavka puca. Direktiva Vijeća 1999/37/EZ (aneksi zamijenjeni Direktivom 2003/127/EZ) harmonizira **kodove**, ali izričito ne propisuje fizički raspored polja na papiru, i dozvoljava državama članicama da dodaju vlastite nacionalne kodove u zagradama. Dvije saobraćajne iz dvije države nose iste oznake na različitim mjestima.

Uz to, model danas sam sklapa polje `motor`. Na istoj slici, u tri uzastopna poziva, vratio je `"2.0 DIZEL"`, `"2.0 DIZEL"` i `"1968 dizel"`. Kod `P.3` (vrsta goriva) ispisuje se na jeziku države izdavanja: `DIESEL`, `DIZEL`, `GAZOLE`, `HEAVY OIL`. Slobodno sklapanje znači da isti motor u bazu ulazi kao više različitih zapisa.

Konačno, `vin_broj` se snima sirov, onako kako ga model vrati. VIN sa slovom `O` je po ISO 3779 nemoguć, ali danas prolazi u bazu i trajno kvari pretragu po VIN-u.

## Rješenje

Direktiva se koristi kao **rječnik za čitanje dokumenta**, ne kao model podataka. Baza, tipovi i UI ostaju netaknuti; mijenja se odakle podaci dolaze i koliko strogo se provjeravaju.

Tri pomaka:

1. Model traži podatke **po oznakama** (`E`, `D.1`, `C.1.1`), ne po poziciji.
2. Model vraća **sirove vrijednosti** kodova; `motor` sklapa kod, deterministički.
3. VIN se **validira** prije nego uđe u bazu.

Javni oblik `ScannedRegistration` se ne mijenja. `registration-match.ts`, `RegistrationScanDialog.tsx` i shema baze ostaju kakvi jesu.

## Arhitektura

Novi čist modul `src/api/eu-codes.ts` — bez mreže, bez baze, u cijelosti testabilan:

- `HARMONISED_CODES` — tabela kodova koje čitamo, izvor istine iz koje se **generiše tekst prompta**. Dodavanje koda `B` ili `R` sutra je jedan red u tabeli, ne prepravka prompta.
- `FUEL_MAP` — višejezična mapa `P.3` → bosanski naziv goriva.
- `normalizeFuel(raw)`, `formatDisplacement(cm3)`, `buildMotor(cm3, fuel)`
- `validateVin(raw)`

`registration-scan.ts` ostaje HTTP handler i uvozi ovaj modul. Postojeći `personName()` filter ostaje kao zadnja brana protiv adrese u prezimenu.

### Kodovi koje čitamo

| Kod | Značenje | Kuda ide |
|---|---|---|
| `A` | registarska oznaka | `registarske_tablice` |
| `D.1` | marka | `marka_vozila` |
| `D.3` | komercijalni opis | `model_vozila` (primarno) |
| `D.2` | tip / varijanta | `model_vozila` (samo ako `D.3` nema) |
| `E` | broj šasije | `vin_broj` |
| `P.1` | zapremina u cm³ | `motor` |
| `P.3` | vrsta goriva | `motor` |
| `C.1.1` | prezime imaoca | `vlasnik.prezime` |
| `C.1.2` | ime imaoca | `vlasnik.ime` |
| `C.1.3` | **adresa imaoca** | nikuda — izričito zabranjeno |
| `C.2` | vlasnik, ako nije imalac | samo upozorenje |

`D.3` ima prednost nad `D.2` jer je `D.2` interna tipska oznaka (`3T` za Škodu Superb), beskorisna serviseru. Nacionalni kodovi u zagradama se ignorišu.

Obavezni kodovi po aneksu su `A`, `B`, `C.1` s podpoljima, `D.1`, `D.2`, `D.3`, `E`, `F.1`, `G`, `K`, `P.1`, `P.3`, `S.1`. `C.2`, `C.3`, `C.4` i `R` su opcioni — zato se na `C.2` nikad ne oslanjamo.

## Oblik odgovora modela

```json
{ "A": "E17-M-318", "D1": "ŠKODA", "D2": "3T", "D3": "SUPERB",
  "E": "TMBLF93T1F9050884", "P1": 1968, "P3": "DIESEL",
  "C11": "ČAPLJA", "C12": "TARIK",
  "C2": null,
  "kodovi_vidljivi": true,
  "warnings": [] }
```

`P1` je broj, ne string. `P3` je tekst **onako kako piše na papiru** — prijevod je posao koda, ne modela. `C2` je `{ime, prezime}` ili `null`.

## Sklapanje `motor`

`formatDisplacement`: `cm3 / 1000`, zaokruženo na jednu decimalu. `1968 → "2.0"`, `1598 → "1.6"`, `2967 → "3.0"`. Van raspona 200–10000 cm³ → `null` (misread).

`normalizeFuel`, mapa:

| bosanski | prihvata |
|---|---|
| `dizel` | DIZEL, DIESEL, GASOIL, GAZOLE, HEAVY OIL, NAFTA, DIESELKRAFTSTOFF |
| `benzin` | BENZIN, BENZINA, PETROL, GASOLINE, ESSENCE, OTTO, UNLEADED |
| `plin` | LPG, GPL, TNG, AUTOGAS, PLIN |
| `metan` | CNG, METAN, ERDGAS |
| `hibrid` | HYBRID, HIBRID |
| `struja` | ELECTRIC, ELEKTRO, STROM, EV |

Nepoznato gorivo se **zadržava kako jeste** uz upozorenje. Radije nepoznat string nego izgubljen podatak.

`buildMotor` spaja neprazne dijelove: `"2.0 dizel"`. Ako ima samo gorivo → `"dizel"`. Ako nema ničega → `null`.

Postojeći redovi u bazi imaju `motor` oblika `"2.0 TDI"`. Novi zapisi će biti `"2.0 dizel"`. `motor` se ni po čemu ne poredi ni ne pretražuje, pa nesklad ne smeta i ne migriramo.

## Validacija VIN-a

`validateVin` prihvata **tačno 17 znakova** iz skupa `[A-HJ-NPR-Z0-9]` (bez `I`, `O`, `Q`). Sve ostalo → `null` + upozorenje da se VIN unese ručno.

Pročitani VIN se **nikad ne ispravlja**. Ako model vrati `O` umjesto `0`, ne znamo koje je od dvoje tačno; tiho "ispravljanje" bi pokvarilo i ispravno pročitane VIN-ove.

**Poznata posljedica:** vozila starija od 1981. imaju kraći VIN i dobiće `vin_broj: null` uz upozorenje. Vozilo se i dalje nalazi i snima preko tablica; VIN se unosi ručno. Prihvaćeno svjesno.

`canonicalVin()` u `registration-match.ts` ostaje netaknut. On normalizuje VIN-ove **samo radi poređenja**, u memoriji, i nikad ne mijenja ono što se snima. Nakon stroge validacije dokumentov VIN kroz njega prolazi nepromijenjen; VIN-ovi iz baze, koji su možda upisani ranije ili ručno, i dalje imaju koristi od normalizacije.

## Upozorenja

| Situacija | Upozorenje |
|---|---|
| `kodovi_vidljivi: false` | Dokument nema EU oznake; podaci su nepotvrđeni, provjerite ih. |
| `C.2` postoji i ≠ `C.1` | Vozilo je registrovano na imaoca, a vlasnik je druga osoba (leasing?). |
| VIN ne prolazi validaciju | VIN nije pouzdano pročitan, unesite ga ručno. |
| Nepoznato gorivo | Vrsta goriva nije prepoznata. |

## Dokument bez oznaka

Stara saobraćajna prije 2004., ili dokument van EU sistema (švicarski, turski), nema harmonizirane kodove. Tada model postavlja `kodovi_vidljivi: false` i vraća se na poznati bosanski raspored (prezime, ime, pa adresa). Odgovor uvijek nosi upozorenje da su podaci nepotvrđeni.

Ako model ne može pouzdano vezati liniju za oznaku, oba imena ostaju `null` uz upozorenje. Prazno prezime je ispravno stanje; adresa u prezimenu nije.

## Testiranje

Sve novo je čisto i testira se bez mreže, `bun test`:

- `formatDisplacement` — 1968→"2.0", 1598→"1.6", 99→null, 50000→null
- `normalizeFuel` — DIESEL/GAZOLE/HEAVY OIL→"dizel", ESSENCE→"benzin", nepoznato→prolazi uz warning
- `buildMotor` — obje vrijednosti, samo jedna, nijedna
- `validateVin` — 17 ispravnih; slovo `O`; 16 znakova; prazno
- `C.2` različit od `C.1` → tačno jedno upozorenje, `vlasnik` ostaje `C.1`
- `kodovi_vidljivi: false` → upozorenje prisutno
- prompt sadrži svaki kod iz `HARMONISED_CODES` i zabranu za `C.1.3`
- `personName` i dalje odbija `"Mrkotić 180"`, `"Mrkotić, Tešanj"`, `"VLASNIK"`

Postojeći test za `hasUsableIdentifier` mora i dalje prolaziti: VIN **ili** tablice su dovoljni.

## Izvan obima

Ne čuvamo `B` (prva registracija), `F.1`/`G` (mase), `K` (homologacija), `R` (boja), `S.1` (sjedišta), `C.4` (uloga). Tabela `HARMONISED_CODES` je napravljena tako da se dodaju kasnije bez prepravke prompta, ali svaki od njih traži migraciju sheme i polje u UI-u, što ovaj spec ne radi.

Ne prepoznajemo državu izdavanja i ne čuvamo je.
