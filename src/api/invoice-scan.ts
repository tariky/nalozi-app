import type { ScanInvoiceResponse, ParsedInvoiceItem } from "../types";
import { requireAuth, validateCsrf } from "./auth";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3.6-flash";
const TIMEOUT_MS = 45_000;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

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

interface OcrMessage {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export function buildOcrMessages(dataUrl: string): OcrMessage[] {
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
function stripFences(raw: string): string {
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

  const obj = parsed as Record<string, unknown>;

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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ message: "Slika nije validna" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ message: "Slika nije validna" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ message: "Slika nije validna" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ message: "Slika je prevelika (max 8MB)" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${file.type};base64,${base64}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let openrouterRes: Response;
  try {
    openrouterRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildOcrMessages(dataUrl),
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      return Response.json({ message: "Vrijeme za obradu isteklo" }, { status: 504 });
    }
    return Response.json({ message: "OpenRouter nedostupan" }, { status: 502 });
  }
  clearTimeout(timer);

  if (!openrouterRes.ok) {
    const text = await openrouterRes.text().catch(() => "");
    console.error(`OpenRouter HTTP ${openrouterRes.status}:`, text.slice(0, 500));
    return Response.json({ message: "OpenRouter greška" }, { status: 502 });
  }

  const json = await openrouterRes.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    return Response.json({ message: "Model nije vratio sadržaj" }, { status: 422 });
  }

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
