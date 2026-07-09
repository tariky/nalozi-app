import type {
  Customer,
  CustomerCandidate,
  ScannedRegistration,
  Vehicle,
  VehicleCandidate,
  VehicleCandidateCustomer,
  VehicleMatchKind,
} from "../types";

// Pure matching helpers for registration-document scanning.
// No database, no network — the matching rules must be testable in isolation.

// Đ (U+0110) and đ (U+0111) are distinct letters, not decomposable by NFD.
// Without this map, "Đurić" would never match "Duric".
const DJ_RE = /[ĐđÐð]/g;

export function normalizeName(raw: string): string {
  return raw
    .replace(DJ_RE, "D")
    .normalize("NFD")
    // \p{M} matches every combining mark, so "ć" (c + U+0301) collapses to "c".
    // Written as a property escape rather than a literal range, which would put
    // invisible combining characters into the source.
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// A real VIN never contains I, O or Q — the standard forbids them precisely
// because they are confusable with 1 and 0. Any such character is a misread.
export function canonicalVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OQ]/g, "0")
    .replace(/I/g, "1");
}

export function normalizePlates(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length]!;
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export const NAME_MATCH_THRESHOLD = 0.72;
export const VIN_NEAR_MAX_DISTANCE = 2;
const MAX_CUSTOMER_CANDIDATES = 5;

// Below this length a "near" VIN match is meaningless — short garbage strings
// sit within edit distance 2 of almost anything.
const VIN_MIN_NEAR_LENGTH = 8;

export type VehicleWithCustomer = Vehicle & { customer: VehicleCandidateCustomer | null };

function docFullName(vlasnik: { ime: string | null; prezime: string | null }): {
  forward: string;
  reversed: string;
} {
  const ime = vlasnik.ime ?? "";
  const prezime = vlasnik.prezime ?? "";
  return {
    forward: normalizeName(`${ime} ${prezime}`),
    reversed: normalizeName(`${prezime} ${ime}`),
  };
}

export function matchVehicles(
  doc: ScannedRegistration,
  vehicles: VehicleWithCustomer[]
): { candidates: VehicleCandidate[]; warnings: string[] } {
  const warnings: string[] = [];
  const docVin = doc.vin_broj ? canonicalVin(doc.vin_broj) : "";
  const docPlates = doc.registarske_tablice ? normalizePlates(doc.registarske_tablice) : "";

  const exact: VehicleCandidate[] = [];
  const near: VehicleCandidate[] = [];
  const byPlates: VehicleCandidate[] = [];

  for (const row of vehicles) {
    const { customer, ...vehicle } = row;
    const make = (match: VehicleMatchKind): VehicleCandidate => ({ vehicle, customer, match });
    const vin = row.vin_broj ? canonicalVin(row.vin_broj) : "";

    if (docVin && vin) {
      if (docVin.length >= VIN_MIN_NEAR_LENGTH && vin === docVin) {
        exact.push(make("vin_exact"));
        continue;
      }
      if (
        docVin.length >= VIN_MIN_NEAR_LENGTH &&
        vin.length >= VIN_MIN_NEAR_LENGTH &&
        levenshtein(vin, docVin) <= VIN_NEAR_MAX_DISTANCE
      ) {
        near.push(make("vin_near"));
        continue;
      }
    }

    if (docPlates && normalizePlates(row.registarske_tablice) === docPlates) {
      byPlates.push(make("plates"));
    }
  }

  if (exact.length > 1) {
    warnings.push(
      `U bazi postoji ${exact.length} vozila sa istim VIN brojem. Odaberite vozilo ručno.`
    );
  }

  return { candidates: [...exact, ...near, ...byPlates], warnings };
}

export function matchCustomers(
  vlasnik: { ime: string | null; prezime: string | null },
  customers: Customer[]
): CustomerCandidate[] {
  const { forward, reversed } = docFullName(vlasnik);
  if (!forward) return [];

  return customers
    .map((customer) => {
      const full = normalizeName(`${customer.ime} ${customer.prezime}`);
      const firma = customer.naziv_firme ? normalizeName(customer.naziv_firme) : "";
      const score = Math.max(
        similarity(forward, full),
        similarity(reversed, full),
        firma ? similarity(forward, firma) : 0
      );
      return { customer, score };
    })
    .filter((c) => c.score >= NAME_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.customer.id - b.customer.id)
    .slice(0, MAX_CUSTOMER_CANDIDATES);
}

// Note the missing customerCandidates parameter: a name match must never
// auto-select a customer, so this function is not given the name candidates
// at all.
export function decideAutoSelect(
  doc: ScannedRegistration,
  vehicleCandidates: VehicleCandidate[]
): { vehicleId: number | null; customerId: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const exact = vehicleCandidates.filter((c) => c.match === "vin_exact");
  if (exact.length !== 1) return { vehicleId: null, customerId: null, warnings };

  const chosen = exact[0]!;
  const vehicleId = chosen.vehicle.id;
  const owner = chosen.customer;
  if (!owner) return { vehicleId, customerId: null, warnings };

  const { forward, reversed } = docFullName(doc.vlasnik);
  if (!forward) return { vehicleId, customerId: owner.id, warnings };

  const ownerName = normalizeName(`${owner.ime} ${owner.prezime}`);
  const score = Math.max(similarity(forward, ownerName), similarity(reversed, ownerName));
  if (score >= NAME_MATCH_THRESHOLD) return { vehicleId, customerId: owner.id, warnings };

  const docName = `${doc.vlasnik.ime ?? ""} ${doc.vlasnik.prezime ?? ""}`.trim();
  warnings.push(
    `Vozilo je u bazi na ${owner.ime} ${owner.prezime}, a saobraćajna glasi na ${docName}. Vozilo je vjerovatno prodano.`
  );
  return { vehicleId, customerId: null, warnings };
}
