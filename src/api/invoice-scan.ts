import type { ScanInvoiceResponse, ParsedInvoiceItem } from "../types";

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
