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

export function buildRegistrationMessages(dataUrl: string): VisionMessage[] {
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
