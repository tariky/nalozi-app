import { test, expect } from "bun:test";
import { parseModelResponse, buildOcrMessages } from "./invoice-scan";

test("parses clean JSON object response", () => {
  const raw = JSON.stringify({
    items: [
      { naziv: "Filter ulja", kolicina: 1, jedinicna_cijena: 12.5, popust: 0 },
      { naziv: "Pločice", kolicina: 2, jedinicna_cijena: 45, popust: 10 },
    ],
    warnings: [],
  });
  const result = parseModelResponse(raw);
  expect(result.items.length).toBe(2);
  expect(result.items[0]!.naziv).toBe("Filter ulja");
  expect(result.items[1]!.popust).toBe(10);
  expect(result.warnings).toEqual([]);
});

test("strips markdown json fences", () => {
  const raw = '```json\n{"items":[{"naziv":"X","kolicina":1,"jedinicna_cijena":5,"popust":0}],"warnings":[]}\n```';
  const result = parseModelResponse(raw);
  expect(result.items.length).toBe(1);
});

test("strips plain markdown fences", () => {
  const raw = '```\n{"items":[],"warnings":["nothing found"]}\n```';
  const result = parseModelResponse(raw);
  expect(result.items.length).toBe(0);
  expect(result.warnings).toEqual(["nothing found"]);
});

test("defaults missing kolicina to 1 and missing popust to 0", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", jedinicna_cijena: 5 }],
    warnings: [],
  });
  const result = parseModelResponse(raw);
  expect(result.items[0]!.kolicina).toBe(1);
  expect(result.items[0]!.popust).toBe(0);
});

test("rejects items missing naziv", () => {
  const raw = JSON.stringify({
    items: [{ kolicina: 1, jedinicna_cijena: 5, popust: 0 }],
    warnings: [],
  });
  expect(() => parseModelResponse(raw)).toThrow(/naziv/);
});

test("rejects items with negative price", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", kolicina: 1, jedinicna_cijena: -5, popust: 0 }],
    warnings: [],
  });
  expect(() => parseModelResponse(raw)).toThrow(/jedinicna_cijena/);
});

test("rejects items with non-numeric kolicina", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", kolicina: "two", jedinicna_cijena: 5, popust: 0 }],
    warnings: [],
  });
  expect(() => parseModelResponse(raw)).toThrow(/kolicina/);
});

test("accepts bare array response as items", () => {
  const raw = JSON.stringify([
    { naziv: "FILTER UNUTRAŠNJEG", kolicina: 1, jedinicna_cijena: 26, popust: 0 },
    { naziv: "FILTER ZRAKA", kolicina: 1, jedinicna_cijena: 32, popust: 0 },
  ]);
  const result = parseModelResponse(raw);
  expect(result.items.length).toBe(2);
  expect(result.items[0]!.naziv).toBe("FILTER UNUTRAŠNJEG");
  expect(result.warnings).toEqual([]);
});

test("rejects when items is missing", () => {
  expect(() => parseModelResponse('{"warnings":[]}')).toThrow(/items/);
});

test("rejects when items is not an array", () => {
  expect(() => parseModelResponse('{"items":"x","warnings":[]}')).toThrow(/items/);
});

test("rejects malformed JSON", () => {
  expect(() => parseModelResponse("not json at all")).toThrow();
});

test("clamps popust to [0, 100]", () => {
  const raw = JSON.stringify({
    items: [
      { naziv: "A", kolicina: 1, jedinicna_cijena: 5, popust: 150 },
      { naziv: "B", kolicina: 1, jedinicna_cijena: 5, popust: -5 },
    ],
    warnings: [],
  });
  const result = parseModelResponse(raw);
  expect(result.items[0]!.popust).toBe(100);
  expect(result.items[1]!.popust).toBe(0);
});

test("missing warnings field defaults to empty array", () => {
  const raw = JSON.stringify({
    items: [{ naziv: "X", kolicina: 1, jedinicna_cijena: 5, popust: 0 }],
  });
  const result = parseModelResponse(raw);
  expect(result.warnings).toEqual([]);
});

test("buildOcrMessages produces correct shape with image", () => {
  const messages = buildOcrMessages("data:image/jpeg;base64,XXX");
  expect(messages.length).toBe(2);
  expect(messages[0]!.role).toBe("system");
  expect(messages[1]!.role).toBe("user");
  expect(Array.isArray(messages[1]!.content)).toBe(true);
  const userContent = messages[1]!.content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
  expect(userContent.some(c => c.type === "text")).toBe(true);
  expect(userContent.some(c => c.type === "image_url" && c.image_url?.url === "data:image/jpeg;base64,XXX")).toBe(true);
});
