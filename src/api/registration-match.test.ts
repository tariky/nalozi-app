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
