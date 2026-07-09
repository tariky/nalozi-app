import type { ScanInvoiceResponse, ParsedInvoiceItem } from "../types";
import { requireAuth, validateCsrf } from "./auth";
import { callOpenRouterVision, readImageUpload, type VisionMessage } from "./vision";

const MODEL = "google/gemini-2.5-flash-lite";

const INSTRUCTIONS = [
  "Extract every line item from this car parts supplier invoice.",
  "",
  "Rules:",
  "1. Skip non-item rows: header rows, addresses, dates, freight/shipping, totals, tax summary, subtotals, terms.",
  "2. For 'jedinicna_cijena', use the price WITH VAT (Cijena sa PDV-om). If only one price column exists, use it.",
  "3. Output STRICT JSON with this exact shape and no extra fields, no markdown, no prose:",
  '   {"items":[{"naziv":string,"kolicina":number,"jedinicna_cijena":number,"popust":number}],"warnings":string[]}',
  "4. Use dot decimals (e.g. 12.50), never commas. Numbers must be JSON numbers, not strings.",
  "5. If quantity is missing, use 1. If discount is missing, use 0.",
  "6. Append a short note to 'warnings' for any row you skipped because data was unclear.",
].join("\n");

export function buildOcrMessages(dataUrl: string): VisionMessage[] {
  return [
    {
      role: "system",
      content: "You are an OCR parser for car parts supplier invoices in Bosnian/Croatian. Extract each line item. Return strict JSON only.",
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

// Strip markdown code fences (```json ... ``` or ``` ... ```) if the model wrapped output.
export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

export function parseModelResponse(raw: string): ScanInvoiceResponse {
  const cleaned = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Invalid JSON from model: ${(e as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model response is not an object");
  }

  const obj: Record<string, unknown> = Array.isArray(parsed)
    ? { items: parsed, warnings: [] }
    : (parsed as Record<string, unknown>);

  if (!Array.isArray(obj.items)) {
    throw new Error("Field 'items' is missing or not an array");
  }

  const items: ParsedInvoiceItem[] = obj.items.map((rawItem, idx) => {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error(`Item ${idx}: not an object`);
    }
    const it = rawItem as Record<string, unknown>;

    if (typeof it.naziv !== "string" || it.naziv.trim() === "") {
      throw new Error(`Item ${idx}: 'naziv' must be a non-empty string`);
    }

    const kolicinaRaw = it.kolicina ?? 1;
    if (typeof kolicinaRaw !== "number" || !isFinite(kolicinaRaw) || kolicinaRaw <= 0) {
      throw new Error(`Item ${idx}: 'kolicina' must be a positive number`);
    }

    if (typeof it.jedinicna_cijena !== "number" || !isFinite(it.jedinicna_cijena) || it.jedinicna_cijena < 0) {
      throw new Error(`Item ${idx}: 'jedinicna_cijena' must be a non-negative number`);
    }

    const popustRaw = it.popust ?? 0;
    if (typeof popustRaw !== "number" || !isFinite(popustRaw)) {
      throw new Error(`Item ${idx}: 'popust' must be a number`);
    }
    const popust = Math.max(0, Math.min(100, popustRaw));

    return {
      naziv: it.naziv.trim(),
      kolicina: kolicinaRaw,
      jedinicna_cijena: it.jedinicna_cijena,
      popust,
    };
  });

  const warnings: string[] = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];

  return { items, warnings };
}

export async function scanInvoice(req: Request): Promise<Response> {
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

  const vision = await callOpenRouterVision(apiKey, MODEL, buildOcrMessages(upload.dataUrl));
  if (!vision.ok) return vision.response;
  const content = vision.content;

  try {
    const parsed = parseModelResponse(content);
    return Response.json(parsed);
  } catch (err) {
    console.error("OCR parse error:", (err as Error).message, "raw:", content.slice(0, 500));
    return Response.json(
      { message: "Model nije vratio ispravan format. Pokušajte sa jasnijom slikom." },
      { status: 422 }
    );
  }
}
