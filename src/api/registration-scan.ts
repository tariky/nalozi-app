import type { Customer, ScanRegistrationResponse, ScannedRegistration, Vehicle } from "../types";
import { stripFences } from "./invoice-scan";
import { callOpenRouterVision, readImageUpload, type VisionMessage } from "./vision";
import { getDB } from "../db";
import { requireAuth, validateCsrf } from "./auth";
import {
  decideAutoSelect,
  matchCustomers,
  matchVehicles,
  normalizeName,
  type VehicleWithCustomer,
} from "./registration-match";
import { buildMotor, formatDisplacement, normalizeFuel, renderCodeTable, validateVin } from "./eu-codes";

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

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// The model is told never to copy the C.1.3 address line into a name, but a
// prompt is a request, not a guarantee. These shapes can only come from the
// address line or the role column, never from a person's name, so drop them.
const ROLE_WORDS = new Set(["VLASNIK", "KORISNIK", "SUVLASNIK"]);

export function personName(value: unknown): string | null {
  const name = str(value);
  if (!name) return null;
  if (/[\d,]/.test(name)) return null;
  if (ROLE_WORDS.has(name.toUpperCase())) return null;
  return name;
}

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
  if (fuelUnknown) warnings.push(`Gorivo "${str(obj.P3)}" nije prepoznato.`);
  const motor = buildMotor(formatDisplacement(obj.P1), fuel);

  // C.1 is the certificate holder and is mandatory. C.2 is the owner and is
  // optional, so it can only ever add a warning, never replace the holder.
  const holder = { ime: personName(obj.C12), prezime: personName(obj.C11) };
  const owner = ownerName(obj.C2);
  if (owner) {
    const holderKey = normalizeName(`${holder.ime ?? ""} ${holder.prezime ?? ""}`);
    // Mirrors registration-match.ts's docFullName: a name pair can arrive in
    // either field order, so a person only counts as "different" if neither
    // order matches.
    const ownerForward = normalizeName(`${owner.ime ?? ""} ${owner.prezime ?? ""}`);
    const ownerReversed = normalizeName(`${owner.prezime ?? ""} ${owner.ime ?? ""}`);
    const ownerLabel = `${owner.ime ?? ""} ${owner.prezime ?? ""}`.trim();
    if (!holderKey) {
      // C.1 is mandatory but was unreadable; C.2 still cannot substitute for
      // it, but the only legible name on the document must not vanish silently.
      warnings.push(
        `Ime nosioca vozila (C.1) nije pročitano, ali dokument navodi vlasnika (C.2): ${ownerLabel}. Provjerite ručno prije otvaranja naloga.`
      );
    } else if (holderKey !== ownerForward && holderKey !== ownerReversed) {
      const holderLabel = `${holder.ime ?? ""} ${holder.prezime ?? ""}`.trim();
      warnings.push(
        `Vozilo je registrovano na ${holderLabel}, a vlasnik je ${ownerLabel}. Provjerite na koga otvarate nalog.`
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

// Without a VIN and without plates there is nothing to search the database by.
export function hasUsableIdentifier(doc: ScannedRegistration): boolean {
  return Boolean(doc.vin_broj || doc.registarske_tablice);
}

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
