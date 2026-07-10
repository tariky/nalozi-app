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
  // (cm3 / 1000).toFixed(1) looks correct but isn't: dividing by 1000 first can
  // land on a binary fraction just below the true .x5 boundary (e.g. 1150/1000
  // is stored as 1.149999...99), so toFixed(1) rounds down instead of up.
  // Rounding to the nearest integer tenth-of-litre before the final divide
  // keeps the value on an exact halfway point until toFixed does the rounding.
  return (Math.round(cm3 / 100) / 10).toFixed(1);
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

// A vision model reports an illegible or blank P.3 field with a placeholder
// rather than leaving it empty. Most of these (e.g. "---", "-", ".") already
// normalize to the empty string once punctuation is stripped, but "N/A" keeps
// its letters ("N A") and "nepoznato" is a whole word, so they need an
// explicit entry here to be told apart from a real, if unrecognised, fuel.
const PLACEHOLDER_KEYS = new Set(["N A", "NEPOZNATO"]);

export function normalizeFuel(raw: unknown): { fuel: string | null; unknown: boolean } {
  if (typeof raw !== "string" || raw.trim() === "") return { fuel: null, unknown: false };

  const key = normalizeName(raw);
  if (key === "" || PLACEHOLDER_KEYS.has(key)) return { fuel: null, unknown: false };

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
