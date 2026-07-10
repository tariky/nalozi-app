import type { Customer, ScanRegistrationResponse, ScannedRegistration, Vehicle } from "../types";
import { stripFences } from "./invoice-scan";
import { callOpenRouterVision, readImageUpload, type VisionMessage } from "./vision";
import { getDB } from "../db";
import { requireAuth, validateCsrf } from "./auth";
import {
  decideAutoSelect,
  matchCustomers,
  matchVehicles,
  type VehicleWithCustomer,
} from "./registration-match";

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
  "  C.1.1 = owner surname (prezime)",
  "  C.1.2 = owner given name (ime)",
  "  C.1.3 = owner ADDRESS — never a name",
  "",
  "The personal-data block (C / LIČNI PODACI) always runs in this fixed order:",
  "  line 1  C.1.1  surname      e.g. ČAPLJA",
  "  line 2  C.1.2  given name   e.g. TARIK",
  "  line 3  C.1.3  address      e.g. MRKOTIĆ 180  /  MRKOTIĆ, TEŠANJ",
  "The address usually wraps onto two lines (street + house number, then settlement, municipality).",
  "It may be followed by a 13-digit personal number (JMBG) and a role word such as VLASNIK or KORISNIK.",
  "",
  "Rules:",
  "1. Output STRICT JSON with this exact shape, no markdown, no prose:",
  '   {"marka_vozila":string|null,"model_vozila":string|null,"registarske_tablice":string|null,"vin_broj":string|null,"motor":string|null,"vlasnik":{"ime":string|null,"prezime":string|null},"warnings":string[]}',
  "2. Use null for any field you cannot read with confidence. Never guess.",
  "3. 'motor' is a short label such as '2.0 TDI' or '1.6 benzin', built from displacement and fuel or commercial description. Use null if unclear.",
  "4. Never output the owner's address, ID number, or any field not listed above.",
  "5. A VIN is 17 characters on modern documents and never contains the letters I, O or Q.",
  "6. Append a short Bosnian note to 'warnings' for each field left null because the image was unclear.",
  "",
  "CRITICAL — do not put the address into the name. This is the most common error:",
  "7. 'prezime' is ONLY the C.1.1 line, 'ime' is ONLY the C.1.2 line. The third line is the address, never a name.",
  "8. Bosnian settlement and municipality names look exactly like surnames — many end in -ić, -ci, -nj",
  "   (Mrkotić, Tešanj, Gračanica, Doboj, Lukavac). A word ending in -ić on the address line is still a place.",
  "9. A line is the ADDRESS, not a name, if any of these hold: it contains a digit or house number;",
  "   it contains a comma separating two words; it repeats a word from another address line;",
  "   it sits below the given-name line. Discard such lines entirely.",
  "10. 'ime' and 'prezime' are exactly one word each. Never join two words, and never output a role word",
  "    (VLASNIK, KORISNIK, SUVLASNIK) or a number as a name.",
  "11. If the photo is rotated, blurred, or you cannot anchor a line to its C.1.1 / C.1.2 label with certainty,",
  "    set BOTH 'ime' and 'prezime' to null and warn. A missing name is correct; an address in 'prezime' is not.",
].join("\n");

export function buildRegistrationMessages(dataUrl: string): VisionMessage[] {
  return [
    {
      role: "system",
      content:
        "You are an OCR parser for Bosnian vehicle registration documents. Extract the vehicle fields and the owner's name only. " +
        "The owner's address sits directly below the name and its words look like surnames — never let it reach 'ime' or 'prezime'. " +
        "Return strict JSON only.",
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
    vlasnik: { ime: personName(vlasnikRaw.ime), prezime: personName(vlasnikRaw.prezime) },
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
