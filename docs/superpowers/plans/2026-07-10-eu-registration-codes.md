# EU Registration Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make registration-document scanning locate every field by its harmonised EU code rather than by its position on the page, so foreign certificates parse safely and predictably.

**Architecture:** A new pure module `src/api/eu-codes.ts` owns the code table, the fuel vocabulary, VIN validation and `motor` assembly. The prompt text is generated from that table. `src/api/registration-scan.ts` stays the HTTP handler and delegates all normalisation. The public `ScannedRegistration` shape does not change, so the database, the frontend and `registration-match.ts` are untouched.

**Tech Stack:** Bun, TypeScript, `bun test`, OpenRouter vision API.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-eu-registration-codes-design.md`
- Directive: Council Directive 1999/37/EC, Annexes replaced by 2003/127/EC. It harmonises **codes, not layout**. Never locate a field by its position.
- `ScannedRegistration` in `src/types/index.ts` MUST NOT change.
- `src/db/schema.ts` MUST NOT change. No migration.
- `registration-match.ts` MUST NOT change, including `canonicalVin()`.
- All user-facing warning strings are in Bosnian.
- Run tests with `bun test`, never `npm test`.
- A pure function must never reach the network or the database.

---

### Task 1: Pure value helpers in `eu-codes.ts`

Engine displacement, fuel vocabulary and VIN validation. No prompt, no parsing yet.

**Files:**
- Create: `src/api/eu-codes.ts`
- Create: `src/api/eu-codes.test.ts`

**Interfaces:**
- Consumes: `normalizeName` from `./registration-match` (already exported; uppercases, strips diacritics, collapses punctuation to spaces).
- Produces:
  - `formatDisplacement(cm3: unknown): string | null`
  - `normalizeFuel(raw: unknown): { fuel: string | null; unknown: boolean }`
  - `buildMotor(displacement: string | null, fuel: string | null): string | null`
  - `validateVin(raw: unknown): { vin: string | null; valid: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `src/api/eu-codes.test.ts`:

```ts
import { test, expect } from "bun:test";
import { formatDisplacement, normalizeFuel, buildMotor, validateVin } from "./eu-codes";

test("formatDisplacement turns cm3 into a litre label", () => {
  expect(formatDisplacement(1968)).toBe("2.0");
  expect(formatDisplacement(1598)).toBe("1.6");
  expect(formatDisplacement(2967)).toBe("3.0");
  expect(formatDisplacement(999)).toBe("1.0");
});

test("formatDisplacement rejects impossible or non-numeric values", () => {
  expect(formatDisplacement(99)).toBe(null);      // below 200 cm3
  expect(formatDisplacement(50000)).toBe(null);   // above 10000 cm3
  expect(formatDisplacement("1968")).toBe(null);  // model must send a number
  expect(formatDisplacement(null)).toBe(null);
  expect(formatDisplacement(NaN)).toBe(null);
});

test("normalizeFuel maps every language in the directive to one Bosnian word", () => {
  for (const raw of ["DIESEL", "Dizel", "GAZOLE", "HEAVY OIL", "Gas Oil", "nafta"]) {
    expect(normalizeFuel(raw)).toEqual({ fuel: "dizel", unknown: false });
  }
  for (const raw of ["PETROL", "ESSENCE", "Benzina", "OTTO", "unleaded"]) {
    expect(normalizeFuel(raw)).toEqual({ fuel: "benzin", unknown: false });
  }
  expect(normalizeFuel("LPG")).toEqual({ fuel: "plin", unknown: false });
  expect(normalizeFuel("CNG")).toEqual({ fuel: "metan", unknown: false });
  expect(normalizeFuel("ELECTRIC")).toEqual({ fuel: "struja", unknown: false });
  expect(normalizeFuel("Hybrid")).toEqual({ fuel: "hibrid", unknown: false });
});

test("normalizeFuel keeps an unrecognised fuel rather than losing it", () => {
  expect(normalizeFuel("VODIK")).toEqual({ fuel: "vodik", unknown: true });
});

test("normalizeFuel treats missing input as absent, not unknown", () => {
  expect(normalizeFuel(null)).toEqual({ fuel: null, unknown: false });
  expect(normalizeFuel("   ")).toEqual({ fuel: null, unknown: false });
  expect(normalizeFuel(42)).toEqual({ fuel: null, unknown: false });
});

test("buildMotor joins only the parts it has", () => {
  expect(buildMotor("2.0", "dizel")).toBe("2.0 dizel");
  expect(buildMotor("2.0", null)).toBe("2.0");
  expect(buildMotor(null, "dizel")).toBe("dizel");
  expect(buildMotor(null, null)).toBe(null);
});

test("validateVin accepts exactly 17 legal characters", () => {
  expect(validateVin("TMBLF93T1F9050884")).toEqual({ vin: "TMBLF93T1F9050884", valid: true });
  // Separators printed on the document are not part of the VIN.
  expect(validateVin(" tmblf93t1f9050884 ")).toEqual({ vin: "TMBLF93T1F9050884", valid: true });
});

test("validateVin rejects I, O, Q and wrong lengths without repairing them", () => {
  expect(validateVin("TMBLF93T1FO050884")).toEqual({ vin: null, valid: false }); // letter O
  expect(validateVin("TMBLF93T1FI050884")).toEqual({ vin: null, valid: false }); // letter I
  expect(validateVin("TMBLF93T1FQ050884")).toEqual({ vin: null, valid: false }); // letter Q
  expect(validateVin("TMBLF93T1F905088")).toEqual({ vin: null, valid: false });  // 16 chars
  expect(validateVin("")).toEqual({ vin: null, valid: false });
  expect(validateVin(null)).toEqual({ vin: null, valid: false });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/api/eu-codes.test.ts`
Expected: FAIL — `Cannot find module './eu-codes'`

- [ ] **Step 3: Write the implementation**

Create `src/api/eu-codes.ts`:

```ts
// Harmonised Community codes from Council Directive 1999/37/EC, whose Annexes
// were replaced by Directive 2003/127/EC.
//
// The directive harmonises the CODES, not the layout: a Member State may put a
// field anywhere on the page and may add its own national codes in brackets.
// Every field must therefore be located by its code, never by its position.

import { normalizeName } from "./registration-match";

// P.1 is printed in cm3. Anything outside this range is a misread, not an engine.
const MIN_CM3 = 200;
const MAX_CM3 = 10_000;

export function formatDisplacement(cm3: unknown): string | null {
  if (typeof cm3 !== "number" || !Number.isFinite(cm3)) return null;
  if (cm3 < MIN_CM3 || cm3 > MAX_CM3) return null;
  return (cm3 / 1000).toFixed(1);
}

// P.3 is printed in the language of the issuing state. The shop only ever wants
// one Bosnian word, so the translation belongs here and not in the model.
const FUEL_ALIASES: Record<string, string[]> = {
  dizel: ["DIZEL", "DIESEL", "DIESEL OIL", "GASOIL", "GAS OIL", "GAZOLE", "HEAVY OIL", "NAFTA", "DIESELKRAFTSTOFF"],
  benzin: ["BENZIN", "BENZINA", "PETROL", "GASOLINE", "ESSENCE", "OTTO", "UNLEADED", "SUPER", "EUROSUPER"],
  plin: ["LPG", "GPL", "TNG", "AUTOGAS", "PLIN"],
  metan: ["CNG", "METAN", "ERDGAS"],
  hibrid: ["HYBRID", "HIBRID"],
  struja: ["ELECTRIC", "ELEKTRO", "STROM", "EV", "ELEKTRICNI"],
};

const FUEL_LOOKUP = new Map<string, string>();
for (const [bosnian, aliases] of Object.entries(FUEL_ALIASES)) {
  for (const alias of aliases) FUEL_LOOKUP.set(alias, bosnian);
}

export function normalizeFuel(raw: unknown): { fuel: string | null; unknown: boolean } {
  if (typeof raw !== "string" || raw.trim() === "") return { fuel: null, unknown: false };

  const key = normalizeName(raw);
  const known = FUEL_LOOKUP.get(key);
  if (known) return { fuel: known, unknown: false };

  // An unrecognised fuel is still information. Keep it and let the caller warn.
  return { fuel: raw.trim().toLowerCase(), unknown: true };
}

export function buildMotor(displacement: string | null, fuel: string | null): string | null {
  const parts = [displacement, fuel].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" ") : null;
}

// ISO 3779: exactly 17 characters, and never I, O or Q — the standard forbids
// them because they are confusable with 1 and 0.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function validateVin(raw: unknown): { vin: string | null; valid: boolean } {
  if (typeof raw !== "string") return { vin: null, valid: false };

  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Deliberately no repair pass. If the model read O where the paper says 0 we
  // cannot tell which is right, and silently "fixing" it would corrupt the
  // VINs that were read correctly.
  if (!VIN_RE.test(cleaned)) return { vin: null, valid: false };
  return { vin: cleaned, valid: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/api/eu-codes.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/eu-codes.ts src/api/eu-codes.test.ts
git commit -m "feat: add pure EU registration code helpers"
```

---

### Task 2: The code table and the generated prompt

The prompt stops being hand-written prose and becomes a rendering of the code table.

**Files:**
- Modify: `src/api/eu-codes.ts` (append)
- Modify: `src/api/eu-codes.test.ts` (append)
- Modify: `src/api/registration-scan.ts` — replace the `INSTRUCTIONS` constant and `buildRegistrationMessages`
- Modify: `src/api/registration-scan.test.ts` — replace the two prompt tests

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface HarmonisedCode { code: string; key: string; meaning: string }`
  - `HARMONISED_CODES: readonly HarmonisedCode[]`
  - `FORBIDDEN_CODES: readonly { code: string; meaning: string }[]`
  - `renderCodeTable(): string`

- [ ] **Step 1: Write the failing tests**

Append to `src/api/eu-codes.test.ts`:

```ts
import { HARMONISED_CODES, FORBIDDEN_CODES, renderCodeTable } from "./eu-codes";

test("the code table carries the codes the scanner reads", () => {
  const codes = HARMONISED_CODES.map((c) => c.code);
  expect(codes).toEqual(["A", "D.1", "D.2", "D.3", "E", "P.1", "P.3", "C.1.1", "C.1.2", "C.2"]);
});

test("every code maps to a distinct JSON key", () => {
  const keys = HARMONISED_CODES.map((c) => c.key);
  expect(new Set(keys).size).toBe(keys.length);
});

test("the address codes are listed as forbidden, never as readable", () => {
  const forbidden = FORBIDDEN_CODES.map((c) => c.code);
  expect(forbidden).toContain("C.1.3");
  expect(HARMONISED_CODES.some((c) => c.code === "C.1.3")).toBe(false);
});

test("renderCodeTable prints every code with its JSON key", () => {
  const table = renderCodeTable();
  for (const { code, key } of HARMONISED_CODES) {
    expect(table).toContain(code);
    expect(table).toContain(`"${key}"`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/api/eu-codes.test.ts`
Expected: FAIL — `HARMONISED_CODES is not exported`

- [ ] **Step 3: Append the table to `src/api/eu-codes.ts`**

```ts
export interface HarmonisedCode {
  /** The code as printed on the certificate. */
  code: string;
  /** The key the model must use in its JSON reply. Dots are illegal in a bare key. */
  key: string;
  meaning: string;
}

// Annex I lists A, B, C.1 (with subfields), D.1, D.2, D.3, E, F.1, G, K, P.1,
// P.3 and S.1 as mandatory. C.2, C.3, C.4 and R are optional, which is why we
// never depend on C.2 being present.
export const HARMONISED_CODES: readonly HarmonisedCode[] = [
  { code: "A", key: "A", meaning: "registration number (the plates)" },
  { code: "D.1", key: "D1", meaning: "make, e.g. ŠKODA" },
  { code: "D.2", key: "D2", meaning: "type / variant / version, an internal code such as 3T" },
  { code: "D.3", key: "D3", meaning: "commercial description — this is the model name, e.g. SUPERB" },
  { code: "E", key: "E", meaning: "vehicle identification number (VIN)" },
  { code: "P.1", key: "P1", meaning: "engine capacity in cm3 — return a NUMBER, e.g. 1968, not a string" },
  { code: "P.3", key: "P3", meaning: "type of fuel — copy it EXACTLY as printed, in its own language, do not translate" },
  { code: "C.1.1", key: "C11", meaning: "surname or business name of the certificate holder" },
  { code: "C.1.2", key: "C12", meaning: "other name(s) of the certificate holder" },
  { code: "C.2", key: "C2", meaning: "the owner, ONLY if the document shows C.2 separately from C.1" },
] as const;

export const FORBIDDEN_CODES: readonly { code: string; meaning: string }[] = [
  { code: "C.1.3", meaning: "address of the certificate holder" },
  { code: "C.3", meaning: "address of a person authorised to use the vehicle" },
] as const;

export function renderCodeTable(): string {
  const read = HARMONISED_CODES.map(
    ({ code, key, meaning }) => `  ${code.padEnd(6)} -> "${key}"${" ".repeat(Math.max(1, 6 - key.length))}${meaning}`
  );
  const banned = FORBIDDEN_CODES.map(({ code, meaning }) => `  ${code.padEnd(6)} ${meaning} — NEVER output this`);
  return ["Codes to read:", ...read, "", "Codes that must never reach the output:", ...banned].join("\n");
}
```

- [ ] **Step 4: Run to verify the table tests pass**

Run: `bun test src/api/eu-codes.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Replace the prompt in `src/api/registration-scan.ts`**

Delete the whole existing `const INSTRUCTIONS = [...].join("\n")` block and replace it, and replace the body of `buildRegistrationMessages`:

```ts
import { renderCodeTable } from "./eu-codes";

const JSON_SHAPE =
  '{"A":string|null,"D1":string|null,"D2":string|null,"D3":string|null,"E":string|null,' +
  '"P1":number|null,"P3":string|null,"C11":string|null,"C12":string|null,' +
  '"C2":{"ime":string|null,"prezime":string|null}|null,' +
  '"kodovi_vidljivi":boolean,"warnings":string[]}';

const INSTRUCTIONS = [
  "Extract data from this vehicle registration certificate.",
  "It follows EU Directive 1999/37/EC, which harmonises the FIELD CODES but NOT their position on the page.",
  "Find every value by its printed code. Never infer a value from where it sits on the paper.",
  "",
  renderCodeTable(),
  "",
  "Rules:",
  "1. Output STRICT JSON with this exact shape, no markdown, no prose:",
  `   ${JSON_SHAPE}`,
  "2. Use null for any code that is absent or that you cannot read with confidence. Never guess.",
  "3. A Member State may print its own national codes in brackets next to the harmonised ones. Ignore anything in brackets.",
  "4. C.1.3 is the holder's ADDRESS and sits close to the name. Its words look like surnames — Bosnian",
  "   settlements and municipalities end in -ić, -ci, -nj (Mrkotić, Tešanj, Gračanica, Doboj). A word ending",
  "   in -ić on the address line is still a place. Never let it reach C11 or C12.",
  "5. A value is an ADDRESS, not a name, if it contains a digit, or a comma between two words, or repeats a",
  "   word from another address line. C11 and C12 are one word each, and never a role word (VLASNIK, KORISNIK).",
  "6. E is a VIN: exactly 17 characters on modern documents, never containing the letters I, O or Q.",
  "7. P1 must be a JSON number in cm3. P3 must be the fuel word exactly as printed — DIESEL, GAZOLE and",
  "   HEAVY OIL are all valid answers. Do not translate it and do not combine P1 and P3 yourself.",
  '8. Set "kodovi_vidljivi" to true only if the document actually prints the harmonised codes. If it does not',
  "   (an old pre-2004 certificate, or a non-EU document), set it to false and read the Bosnian layout instead:",
  "   surname on the first line of the personal-data block, given name on the second, address on the third.",
  "9. If you cannot tie a line to its C.1.1 / C.1.2 code with certainty, set BOTH C11 and C12 to null and warn.",
  "   A missing name is correct; an address in the surname is not.",
  "10. Append a short Bosnian note to 'warnings' for each code left null because the image was unclear.",
].join("\n");

export function buildRegistrationMessages(dataUrl: string): VisionMessage[] {
  return [
    {
      role: "system",
      content:
        "You are an OCR parser for EU vehicle registration certificates (Directive 1999/37/EC). " +
        "Locate each field by its harmonised code, never by its position on the page. " +
        "The holder's address (C.1.3) sits next to the name and its words look like surnames — it must never " +
        "reach a name field. Return strict JSON only.",
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
```

Note: `registration-scan.ts` imports only `renderCodeTable`. The test in Step 6 imports `HARMONISED_CODES` directly from `./eu-codes` to assert the prompt names every code.

- [ ] **Step 6: Replace the two prompt tests in `src/api/registration-scan.test.ts`**

Delete the tests named `"buildRegistrationMessages embeds the image and forbids the address"` and `"the prompt warns that the C.1.3 address line is not a name"`. Replace with:

```ts
import { HARMONISED_CODES } from "./eu-codes";

test("buildRegistrationMessages embeds the image and names every code it reads", () => {
  const messages = buildRegistrationMessages("data:image/png;base64,AAA");
  expect(messages.length).toBe(2);
  const parts = messages[1]!.content as Array<{ type: string }>;
  expect(parts.some((p) => p.type === "image_url")).toBe(true);

  const text = JSON.stringify(messages);
  for (const { code } of HARMONISED_CODES) expect(text).toContain(code);
});

test("the prompt forbids the address codes and warns about place names", () => {
  const text = JSON.stringify(buildRegistrationMessages("data:image/png;base64,AAA"));
  expect(text).toContain("C.1.3");
  expect(text).toContain("-ić"); // the trap: Bosnian place names look like surnames
  expect(text).toContain("1999/37/EC");
});
```

- [ ] **Step 7: Run the full suite**

Run: `bun test src/api/eu-codes.test.ts src/api/registration-scan.test.ts`
Expected: the two prompt tests PASS. The parser tests still PASS because Task 2 has not touched `parseRegistrationResponse`.

- [ ] **Step 8: Commit**

```bash
git add src/api/eu-codes.ts src/api/eu-codes.test.ts src/api/registration-scan.ts src/api/registration-scan.test.ts
git commit -m "feat: generate the scan prompt from the EU code table"
```

---

### Task 3: Parse the coded reply

`parseRegistrationResponse` stops reading `marka_vozila` and starts reading `D1`. It assembles `motor`, validates the VIN, and raises the four warnings.

**Files:**
- Modify: `src/api/registration-scan.ts` — `parseRegistrationResponse`
- Modify: `src/api/registration-scan.test.ts` — every test that feeds raw JSON

**Interfaces:**
- Consumes: `formatDisplacement`, `normalizeFuel`, `buildMotor`, `validateVin` from Task 1; `normalizeName` from `./registration-match`.
- Produces: `parseRegistrationResponse(raw: string): { document: ScannedRegistration; warnings: string[] }` — same signature as today. `personName` keeps its current signature and behaviour.

- [ ] **Step 1: Write the failing tests**

Replace the raw-JSON tests in `src/api/registration-scan.test.ts` (the ones named "parses a clean JSON response", "strips markdown fences", "turns missing, empty and non-string fields into null", "keeps only string warnings", "hasUsableIdentifier requires a VIN or plates", "an address line never survives as a name") with:

```ts
const FULL = {
  A: "E17-M-318",
  D1: "ŠKODA",
  D2: "3T",
  D3: "SUPERB",
  E: "TMBLF93T1F9050884",
  P1: 1968,
  P3: "DIESEL",
  C11: "Čaplja",
  C12: "Tarik",
  C2: null,
  kodovi_vidljivi: true,
  warnings: [],
};

test("parses a coded reply and assembles motor deterministically", () => {
  const { document, warnings } = parseRegistrationResponse(JSON.stringify(FULL));
  expect(document.marka_vozila).toBe("ŠKODA");
  expect(document.model_vozila).toBe("SUPERB"); // D.3 wins over D.2
  expect(document.registarske_tablice).toBe("E17-M-318");
  expect(document.vin_broj).toBe("TMBLF93T1F9050884");
  expect(document.motor).toBe("2.0 dizel"); // 1968 cm3 + DIESEL
  expect(document.vlasnik).toEqual({ ime: "Tarik", prezime: "Čaplja" });
  expect(warnings).toEqual([]);
});

test("a foreign fuel word yields the same motor string as the Bosnian one", () => {
  const french = parseRegistrationResponse(JSON.stringify({ ...FULL, P3: "GAZOLE" }));
  const german = parseRegistrationResponse(JSON.stringify({ ...FULL, P3: "DIESELKRAFTSTOFF" }));
  expect(french.document.motor).toBe("2.0 dizel");
  expect(german.document.motor).toBe("2.0 dizel");
});

test("model_vozila falls back to D.2 only when D.3 is absent", () => {
  const { document } = parseRegistrationResponse(JSON.stringify({ ...FULL, D3: null }));
  expect(document.model_vozila).toBe("3T");
});

test("strips markdown fences", () => {
  const raw = "```json\n" + JSON.stringify(FULL) + "\n```";
  const { document } = parseRegistrationResponse(raw);
  expect(document.vin_broj).toBe("TMBLF93T1F9050884");
});

test("an illegal VIN is dropped, not repaired, and warns", () => {
  const raw = JSON.stringify({ ...FULL, E: "TMBLF93T1FO050884" }); // letter O
  const { document, warnings } = parseRegistrationResponse(raw);
  expect(document.vin_broj).toBe(null);
  expect(warnings.some((w) => w.includes("VIN"))).toBe(true);
});

test("a missing VIN does not warn — only an unreadable one does", () => {
  const { warnings } = parseRegistrationResponse(JSON.stringify({ ...FULL, E: null }));
  expect(warnings.some((w) => w.includes("VIN"))).toBe(false);
});

test("a document without harmonised codes is flagged as unverified", () => {
  const { warnings } = parseRegistrationResponse(JSON.stringify({ ...FULL, kodovi_vidljivi: false }));
  expect(warnings.some((w) => w.includes("EU oznake"))).toBe(true);
});

test("C.2 different from C.1 keeps the holder and warns about the owner", () => {
  const raw = JSON.stringify({ ...FULL, C2: { ime: "Amra", prezime: "Hodžić" } });
  const { document, warnings } = parseRegistrationResponse(raw);
  expect(document.vlasnik).toEqual({ ime: "Tarik", prezime: "Čaplja" }); // C.1 wins
  expect(warnings.some((w) => w.includes("Amra Hodžić"))).toBe(true);
});

test("C.2 equal to C.1 is not a warning", () => {
  const raw = JSON.stringify({ ...FULL, C2: { ime: "TARIK", prezime: "CAPLJA" } });
  const { warnings } = parseRegistrationResponse(raw);
  expect(warnings).toEqual([]);
});

test("an unrecognised fuel is kept and warned about", () => {
  const { document, warnings } = parseRegistrationResponse(JSON.stringify({ ...FULL, P3: "VODIK" }));
  expect(document.motor).toBe("2.0 vodik");
  expect(warnings.some((w) => w.includes("gorivo") || w.includes("Gorivo"))).toBe(true);
});

test("turns missing, empty and non-string fields into null", () => {
  const raw = JSON.stringify({ D1: "", D3: 42, P1: "1968", C11: null, C12: null });
  const { document } = parseRegistrationResponse(raw);
  expect(document.marka_vozila).toBe(null);
  expect(document.model_vozila).toBe(null);
  expect(document.motor).toBe(null); // P1 was a string, not a number
  expect(document.vlasnik).toEqual({ ime: null, prezime: null });
});

test("keeps only string warnings from the model", () => {
  const raw = JSON.stringify({ kodovi_vidljivi: true, warnings: ["nejasan VIN", 7, null] });
  const { warnings } = parseRegistrationResponse(raw);
  expect(warnings).toEqual(["nejasan VIN"]);
});

test("rejects invalid JSON and non-objects", () => {
  expect(() => parseRegistrationResponse("not json")).toThrow();
  expect(() => parseRegistrationResponse("[1,2]")).toThrow();
});

test("hasUsableIdentifier requires a VIN or plates", () => {
  const empty = parseRegistrationResponse(JSON.stringify({ kodovi_vidljivi: true })).document;
  expect(hasUsableIdentifier(empty)).toBe(false);

  const vinOnly = parseRegistrationResponse(
    JSON.stringify({ E: "TMBLF93T1F9050884", kodovi_vidljivi: true })
  ).document;
  expect(hasUsableIdentifier(vinOnly)).toBe(true);

  const platesOnly = parseRegistrationResponse(
    JSON.stringify({ A: "E17-M-318", kodovi_vidljivi: true })
  ).document;
  expect(hasUsableIdentifier(platesOnly)).toBe(true);
});

test("an address line never survives as a name", () => {
  const raw = JSON.stringify({ ...FULL, C11: "Mrkotić 180", C12: "Mrkotić, Tešanj" });
  const { document } = parseRegistrationResponse(raw);
  expect(document.vlasnik).toEqual({ ime: null, prezime: null });
});
```

Keep the existing `personName` test and the `scanRegistration` auth / 503 tests unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/api/registration-scan.test.ts`
Expected: FAIL — `document.marka_vozila` is `null`, because the parser still looks for a key named `marka_vozila`.

- [ ] **Step 3: Rewrite `parseRegistrationResponse`**

In `src/api/registration-scan.ts`, extend the imports and replace the function body. `str`, `personName` and `ROLE_WORDS` stay exactly as they are.

```ts
import { buildMotor, formatDisplacement, normalizeFuel, validateVin } from "./eu-codes";
import { normalizeName } from "./registration-match";

const WARN_NO_CODES = "Dokument nema EU oznake polja; podaci su nepotvrđeni, provjerite ih.";
const WARN_VIN = "VIN nije pouzdano pročitan, unesite ga ručno.";

function ownerName(value: unknown): { ime: string | null; prezime: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const ime = personName(obj.ime);
  const prezime = personName(obj.prezime);
  return ime || prezime ? { ime, prezime } : null;
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

  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];

  // E: an illegal VIN is dropped. A VIN the document simply does not show is
  // absent, not unreadable, so it earns no warning.
  const rawVin = str(obj.E);
  const { vin } = validateVin(rawVin);
  if (rawVin && !vin) warnings.push(WARN_VIN);

  // P.1 + P.3: the model reports them raw; the label is assembled here so the
  // same car always produces the same string, whatever language the paper is in.
  const { fuel, unknown: fuelUnknown } = normalizeFuel(obj.P3);
  if (fuelUnknown) warnings.push(`Vrsta goriva "${str(obj.P3)}" nije prepoznata.`);
  const motor = buildMotor(formatDisplacement(obj.P1), fuel);

  // C.1 is the certificate holder and is mandatory. C.2 is the owner and is
  // optional, so it can only ever add a warning, never replace the holder.
  const holder = { ime: personName(obj.C12), prezime: personName(obj.C11) };
  const owner = ownerName(obj.C2);
  if (owner) {
    const holderKey = normalizeName(`${holder.ime ?? ""} ${holder.prezime ?? ""}`);
    const ownerKey = normalizeName(`${owner.ime ?? ""} ${owner.prezime ?? ""}`);
    if (holderKey && ownerKey && holderKey !== ownerKey) {
      const ownerLabel = `${owner.ime ?? ""} ${owner.prezime ?? ""}`.trim();
      warnings.push(
        `Vozilo je registrovano na ${holder.ime} ${holder.prezime}, a vlasnik je ${ownerLabel}. Provjerite na koga otvarate nalog.`
      );
    }
  }

  if (obj.kodovi_vidljivi === false) warnings.push(WARN_NO_CODES);

  const document: ScannedRegistration = {
    marka_vozila: str(obj.D1),
    // D.3 is the commercial description (SUPERB); D.2 is an internal type code
    // (3T) that means nothing to a mechanic. Prefer D.3.
    model_vozila: str(obj.D3) ?? str(obj.D2),
    registarske_tablice: str(obj.A),
    vin_broj: vin,
    motor,
    vlasnik: holder,
  };

  return { document, warnings };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test src/api/registration-scan.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `bun test`
Expected: PASS. `registration-match.test.ts` must be untouched and green.

- [ ] **Step 6: Commit**

```bash
git add src/api/registration-scan.ts src/api/registration-scan.test.ts
git commit -m "feat: parse registration replies by EU code, validate VIN, assemble motor"
```

---

### Task 4: Verify against the real photograph

Unit tests prove the parser. Only a real call proves the prompt. `scanRegistration` itself needs no change — this task is verification.

**Files:**
- Create: `scripts/verify-registration-scan.ts` (throwaway; delete before merging, or keep if the shop wants a smoke test)

**Interfaces:**
- Consumes: `buildRegistrationMessages` from `registration-scan.ts`, `callOpenRouterVision` from `vision.ts`, `parseRegistrationResponse`.
- Produces: nothing importable.

- [ ] **Step 1: Write the script**

```ts
// Sends one real photo through the live prompt and prints the parsed document.
// Usage: bun scripts/verify-registration-scan.ts <path-to-photo.jpg>
import { buildRegistrationMessages, parseRegistrationResponse } from "../src/api/registration-scan";
import { callOpenRouterVision } from "../src/api/vision";

const path = process.argv[2];
if (!path) throw new Error("usage: bun scripts/verify-registration-scan.ts <photo>");

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

for (let i = 0; i < 3; i++) {
  const res = await callOpenRouterVision(
    process.env.OPENROUTER_API_KEY!,
    "google/gemini-3.5-flash",
    buildRegistrationMessages(dataUrl)
  );
  if (!res.ok) {
    console.log(`run ${i + 1}: HTTP`, res.response.status);
    continue;
  }
  const { document, warnings } = parseRegistrationResponse(res.content);
  console.log(`run ${i + 1}:`, JSON.stringify(document), warnings);
}
```

- [ ] **Step 2: Run it against the known photo**

Run: `bun scripts/verify-registration-scan.ts ~/Downloads/IMG20260709170529.jpeg`

Expected, on all three runs:
```
{"marka_vozila":"ŠKODA","model_vozila":"SUPERB","registarske_tablice":"E17-M-318",
 "vin_broj":"TMBLF93T1F9050884","motor":"2.0 dizel",
 "vlasnik":{"ime":"TARIK","prezime":"ČAPLJA"}} []
```

`motor` must be `"2.0 dizel"` on every run — that is the whole point of moving assembly into code. `vlasnik.prezime` must never be `MRKOTIĆ` or `TEŠANJ`.

If a run returns `vin_broj: null` with a VIN warning, check whether the model misread a character; a single misread is a model limitation, not a plan failure. If it happens on every run, the image is too poor and the VIN legitimately cannot be read.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-registration-scan.ts
git commit -m "chore: add registration scan smoke script"
```

---

## Self-Review

**Spec coverage.** Architecture and the `eu-codes.ts` module — Task 1 and 2. Code table driving the prompt — Task 2. Model reply shape — Task 2 (`JSON_SHAPE`) and Task 3 (parsing). `motor` assembly with the fuel map — Task 1, exercised in Task 3. VIN validation — Task 1, wired in Task 3. Four warnings — Task 3. Document without codes — Task 2 (rule 8) and Task 3 (`WARN_NO_CODES`). `C.2` handling — Task 3. Testing section — the tests are distributed across Tasks 1–3, and the `personName` and `hasUsableIdentifier` tests are explicitly preserved. Out-of-scope codes are not implemented anywhere, correctly.

**Type consistency.** `normalizeFuel` returns `{ fuel, unknown }` and both fields are read in Task 3. `validateVin` returns `{ vin, valid }`; Task 3 uses `vin` and derives the warning from `rawVin && !vin` rather than from `valid`, which is equivalent — `valid` is retained because the test asserts on it. `formatDisplacement` takes `unknown` so `obj.P1` can be passed straight through without a cast. `buildMotor(string|null, string|null)` matches both call sites.

**Known gap.** `str()` returns `null` for an empty string, so `str(obj.D3) ?? str(obj.D2)` falls back correctly for both `null` and `""`.
