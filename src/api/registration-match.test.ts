import { test, expect } from "bun:test";
import { canonicalVin, normalizePlates, normalizeName, levenshtein, similarity } from "./registration-match";

test("canonicalVin maps VIN-illegal letters to digits", () => {
  // I, O and Q are forbidden in a real VIN, so any read of them is an OCR error.
  expect(canonicalVin("1OI-QO")).toBe("10100");
});

test("canonicalVin strips separators and uppercases", () => {
  expect(canonicalVin("wvw zzz-1k5")).toBe("WVWZZZ1K5");
});

test("normalizePlates strips dashes and spaces", () => {
  expect(normalizePlates("A12-B-345")).toBe("A12B345");
  expect(normalizePlates("a12 b 345")).toBe("A12B345");
});

test("normalizeName strips diacritics including Đ", () => {
  expect(normalizeName("Đurić")).toBe("DURIC");
  expect(normalizeName("Marić")).toBe("MARIC");
  expect(normalizeName("Šefik Čengić")).toBe("SEFIK CENGIC");
});

test("normalizeName collapses whitespace and punctuation to single spaces", () => {
  expect(normalizeName("  Marko   Marić ")).toBe("MARKO MARIC");
});

test("levenshtein counts single-character edits", () => {
  expect(levenshtein("ABC", "ABC")).toBe(0);
  expect(levenshtein("ABC", "ABD")).toBe(1);
  expect(levenshtein("ABC", "")).toBe(3);
  expect(levenshtein("", "AB")).toBe(2);
});

test("similarity is 1 for equal strings and drops with distance", () => {
  expect(similarity("MARIC", "MARIC")).toBe(1);
  expect(similarity("MARIC", "MARIK")).toBeCloseTo(0.8, 5);
  expect(similarity("", "")).toBe(1);
});

import { matchVehicles, matchCustomers, decideAutoSelect } from "./registration-match";
import type { Customer, ScannedRegistration, Vehicle, VehicleCandidateCustomer } from "../types";

function doc(over: Partial<ScannedRegistration> = {}): ScannedRegistration {
  return {
    marka_vozila: "VW",
    model_vozila: "Golf",
    registarske_tablice: "A12-B-345",
    vin_broj: "WVWZZZ1KZAW000001",
    motor: "2.0 TDI",
    vlasnik: { ime: "Marko", prezime: "Marić" },
    ...over,
  };
}

function vehicle(id: number, over: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    customer_id: 1,
    registarske_tablice: "A12-B-345",
    vin_broj: "WVWZZZ1KZAW000001",
    marka_vozila: "VW",
    model_vozila: "Golf",
    motor: "2.0 TDI",
    created_at: "2026-01-01",
    ...over,
  };
}

function owner(id: number, ime: string, prezime: string): VehicleCandidateCustomer {
  return { id, ime, prezime, telefon: null };
}

function customer(id: number, ime: string, prezime: string): Customer {
  return { id, naziv_firme: null, ime, prezime, telefon: null, email: null, created_at: "2026-01-01" };
}

test("matchVehicles finds an exact VIN match", () => {
  const { candidates, warnings } = matchVehicles(doc(), [
    { ...vehicle(7), customer: owner(1, "Marko", "Marić") },
  ]);
  expect(candidates.length).toBe(1);
  expect(candidates[0]!.match).toBe("vin_exact");
  expect(candidates[0]!.vehicle.id).toBe(7);
  expect(warnings).toEqual([]);
});

test("matchVehicles treats a one-character VIN misread as near, not exact", () => {
  // Stored VIN differs from the scanned one by a single character (1 -> 2).
  const stored = vehicle(7, { vin_broj: "WVWZZZ2KZAW000001" });
  const { candidates } = matchVehicles(doc(), [{ ...stored, customer: null }]);
  expect(candidates.length).toBe(1);
  expect(candidates[0]!.match).toBe("vin_near");
});

test("matchVehicles reports a warning when two vehicles share a VIN", () => {
  const { candidates, warnings } = matchVehicles(doc(), [
    { ...vehicle(7), customer: null },
    { ...vehicle(8), customer: null },
  ]);
  expect(candidates.length).toBe(2);
  expect(candidates.every((c) => c.match === "vin_exact")).toBe(true);
  expect(warnings.length).toBe(1);
  expect(warnings[0]).toContain("isti");
});

test("matchVehicles falls back to plates when the VIN does not match", () => {
  const stored = vehicle(7, { vin_broj: "ZZZZZZ9ZZZZ999999" });
  const { candidates } = matchVehicles(doc(), [{ ...stored, customer: null }]);
  expect(candidates.length).toBe(1);
  expect(candidates[0]!.match).toBe("plates");
});

test("matchCustomers ignores diacritics and word order", () => {
  const forward = matchCustomers({ ime: "Marko", prezime: "Marić" }, [customer(1, "Marko", "Maric")]);
  expect(forward.length).toBe(1);
  expect(forward[0]!.score).toBe(1);

  const reversed = matchCustomers({ ime: "Marić", prezime: "Marko" }, [customer(1, "Marko", "Maric")]);
  expect(reversed.length).toBe(1);
});

test("matchCustomers drops candidates below the threshold", () => {
  const result = matchCustomers({ ime: "Marko", prezime: "Marić" }, [customer(1, "Amela", "Hodžić")]);
  expect(result).toEqual([]);
});

test("matchCustomers returns every namesake and never picks one", () => {
  const namesakes = [customer(1, "Marko", "Marić"), customer(2, "Marko", "Marić")];
  const result = matchCustomers({ ime: "Marko", prezime: "Marić" }, namesakes);
  expect(result.length).toBe(2);

  // No vehicle in the database -> nothing is auto-selected, however good the name match.
  const auto = decideAutoSelect(doc(), []);
  expect(auto.vehicleId).toBe(null);
  expect(auto.customerId).toBe(null);
});

test("decideAutoSelect picks the vehicle and its owner on a single exact VIN match", () => {
  const { candidates } = matchVehicles(doc(), [{ ...vehicle(7), customer: owner(3, "Marko", "Marić") }]);
  const auto = decideAutoSelect(doc(), candidates);
  expect(auto.vehicleId).toBe(7);
  expect(auto.customerId).toBe(3);
  expect(auto.warnings).toEqual([]);
});

test("decideAutoSelect refuses to pick when two vehicles match exactly", () => {
  const { candidates } = matchVehicles(doc(), [
    { ...vehicle(7), customer: owner(3, "Marko", "Marić") },
    { ...vehicle(8), customer: owner(4, "Pero", "Perić") },
  ]);
  const auto = decideAutoSelect(doc(), candidates);
  expect(auto.vehicleId).toBe(null);
  expect(auto.customerId).toBe(null);
});

test("decideAutoSelect drops the customer when the document owner disagrees", () => {
  const { candidates } = matchVehicles(doc(), [{ ...vehicle(7), customer: owner(3, "Pero", "Perić") }]);
  const auto = decideAutoSelect(doc(), candidates);
  expect(auto.vehicleId).toBe(7);
  expect(auto.customerId).toBe(null);
  expect(auto.warnings.length).toBe(1);
  expect(auto.warnings[0]).toContain("prodano");
});

test("decideAutoSelect accepts the stored owner when the document owner name is unreadable", () => {
  const { candidates } = matchVehicles(doc({ vlasnik: { ime: null, prezime: null } }), [
    { ...vehicle(7), customer: owner(3, "Pero", "Perić") },
  ]);
  const auto = decideAutoSelect(doc({ vlasnik: { ime: null, prezime: null } }), candidates);
  expect(auto.vehicleId).toBe(7);
  expect(auto.customerId).toBe(3);
  expect(auto.warnings).toEqual([]);
});
