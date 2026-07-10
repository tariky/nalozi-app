import { test, expect } from "bun:test";
import {
  parseRegistrationResponse,
  hasUsableIdentifier,
  buildRegistrationMessages,
  personName,
} from "./registration-scan";

test("parses a clean JSON response", () => {
  const raw = JSON.stringify({
    marka_vozila: "Volkswagen",
    model_vozila: "Golf 7",
    registarske_tablice: "A12-B-345",
    vin_broj: "WVWZZZ1KZAW000001",
    motor: "2.0 TDI",
    vlasnik: { ime: "Marko", prezime: "Marić" },
    warnings: [],
  });
  const { document, warnings } = parseRegistrationResponse(raw);
  expect(document.marka_vozila).toBe("Volkswagen");
  expect(document.vlasnik.prezime).toBe("Marić");
  expect(warnings).toEqual([]);
});

test("strips markdown fences", () => {
  const raw = '```json\n{"vin_broj":"X","vlasnik":{}}\n```';
  const { document } = parseRegistrationResponse(raw);
  expect(document.vin_broj).toBe("X");
});

test("turns missing, empty and non-string fields into null", () => {
  const raw = JSON.stringify({ marka_vozila: "", model_vozila: 42, vin_broj: "  X  " });
  const { document } = parseRegistrationResponse(raw);
  expect(document.marka_vozila).toBe(null);
  expect(document.model_vozila).toBe(null);
  expect(document.motor).toBe(null);
  expect(document.vin_broj).toBe("X");
  expect(document.vlasnik).toEqual({ ime: null, prezime: null });
});

test("keeps only string warnings", () => {
  const raw = JSON.stringify({ vlasnik: {}, warnings: ["nejasan VIN", 7, null] });
  const { warnings } = parseRegistrationResponse(raw);
  expect(warnings).toEqual(["nejasan VIN"]);
});

test("rejects invalid JSON and non-objects", () => {
  expect(() => parseRegistrationResponse("not json")).toThrow();
  expect(() => parseRegistrationResponse("[1,2]")).toThrow();
});

test("hasUsableIdentifier requires a VIN or plates", () => {
  const empty = parseRegistrationResponse(JSON.stringify({ vlasnik: {} })).document;
  expect(hasUsableIdentifier(empty)).toBe(false);

  const vinOnly = parseRegistrationResponse(JSON.stringify({ vin_broj: "X", vlasnik: {} })).document;
  expect(hasUsableIdentifier(vinOnly)).toBe(true);

  const platesOnly = parseRegistrationResponse(
    JSON.stringify({ registarske_tablice: "A12-B-345", vlasnik: {} })
  ).document;
  expect(hasUsableIdentifier(platesOnly)).toBe(true);
});

test("buildRegistrationMessages embeds the image and forbids the address", () => {
  const messages = buildRegistrationMessages("data:image/png;base64,AAA");
  expect(messages.length).toBe(2);
  const content = messages[1]!.content;
  expect(Array.isArray(content)).toBe(true);
  const parts = content as Array<{ type: string }>;
  expect(parts.some((p) => p.type === "image_url")).toBe(true);
  const text = JSON.stringify(messages);
  expect(text).toContain("address");
});

test("the prompt warns that the C.1.3 address line is not a name", () => {
  const text = JSON.stringify(buildRegistrationMessages("data:image/png;base64,AAA"));
  expect(text).toContain("C.1.3");
  // The trap: Bosnian place names are shaped like surnames.
  expect(text).toContain("-ić");
});

test("an address line never survives as a name", () => {
  const raw = JSON.stringify({
    vin_broj: "WVWZZZ1KZAW000001",
    vlasnik: { ime: "Tarik", prezime: "Mrkotić 180" },
  });
  const { document } = parseRegistrationResponse(raw);
  expect(document.vlasnik.prezime).toBe(null);
  expect(document.vlasnik.ime).toBe("Tarik");
});

test("personName rejects addresses, roles and numbers but keeps real names", () => {
  expect(personName("Mrkotić 180")).toBe(null); // house number
  expect(personName("Mrkotić, Tešanj")).toBe(null); // settlement, municipality
  expect(personName("VLASNIK")).toBe(null); // role column
  expect(personName("1405994124114")).toBe(null); // JMBG
  expect(personName("  Čaplja  ")).toBe("Čaplja");
  expect(personName("Mrkotić")).toBe("Mrkotić"); // a bare -ić word is a plausible surname
});

import { beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";
import { scanRegistration } from "./registration-scan";

process.env.DB_PATH = ":memory:";

let adminSession: string;
let adminCsrf: string;

function scanReq(opts?: { session?: string | null }): Request {
  const headers: Record<string, string> = {};
  if (opts?.session !== null) headers["Cookie"] = `session=${opts?.session ?? adminSession}`;
  headers["X-CSRF-Token"] = adminCsrf;
  return new Request("http://localhost/api/vehicles/scan-registration", { method: "POST", headers });
}

beforeEach(() => {
  closeDB();
  const db = getDB();
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM users");

  const expires = new Date(Date.now() + 86400000).toISOString();
  const admin = db
    .query<{ id: number }, [string, string, string]>(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id"
    )
    .get("admin", "fake", "admin")!;
  adminSession = "admin-session";
  adminCsrf = "admin-csrf";
  db.query<null, [string, number, string, string]>(
    "INSERT INTO sessions (id, user_id, expires_at, csrf_token) VALUES (?, ?, ?, ?)"
  ).run(adminSession, admin.id, expires, adminCsrf);
});

test("scanRegistration requires authentication", async () => {
  const res = await scanRegistration(scanReq({ session: null }));
  expect(res.status).toBe(401);
});

test("scanRegistration returns 503 when the API key is missing", async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const res = await scanRegistration(scanReq());
    expect(res.status).toBe(503);
  } finally {
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  }
});
