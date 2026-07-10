import { test, expect } from "bun:test";
import {
  parseRegistrationResponse,
  hasUsableIdentifier,
  buildRegistrationMessages,
  personName,
} from "./registration-scan";
import { renderCodeTable } from "./eu-codes";

const FULL = {
  A: "E17-M-318",
  D1: "ŠKODA",
  D2: "3T",
  D3: "SUPERB",
  E: "TMBLF93T1F9050884",
  P1: 1968,
  P3: "DIESEL",
  C11: "Čaplja",
  C12: "Tarik",
  C2: null,
  kodovi_vidljivi: true,
  warnings: [],
};

test("parses a coded reply and assembles motor deterministically", () => {
  const { document, warnings } = parseRegistrationResponse(JSON.stringify(FULL));
  expect(document.marka_vozila).toBe("ŠKODA");
  expect(document.model_vozila).toBe("SUPERB"); // D.3 wins over D.2
  expect(document.registarske_tablice).toBe("E17-M-318");
  expect(document.vin_broj).toBe("TMBLF93T1F9050884");
  expect(document.motor).toBe("2.0 dizel"); // 1968 cm3 + DIESEL
  expect(document.vlasnik).toEqual({ ime: "Tarik", prezime: "Čaplja" });
  expect(warnings).toEqual([]);
});

test("a foreign fuel word yields the same motor string as the Bosnian one", () => {
  const french = parseRegistrationResponse(JSON.stringify({ ...FULL, P3: "GAZOLE" }));
  const german = parseRegistrationResponse(JSON.stringify({ ...FULL, P3: "DIESELKRAFTSTOFF" }));
  expect(french.document.motor).toBe("2.0 dizel");
  expect(german.document.motor).toBe("2.0 dizel");
});

test("model_vozila falls back to D.2 only when D.3 is absent", () => {
  const { document } = parseRegistrationResponse(JSON.stringify({ ...FULL, D3: null }));
  expect(document.model_vozila).toBe("3T");
});

test("strips markdown fences", () => {
  const raw = "```json\n" + JSON.stringify(FULL) + "\n```";
  const { document } = parseRegistrationResponse(raw);
  expect(document.vin_broj).toBe("TMBLF93T1F9050884");
});

test("an illegal VIN is dropped, not repaired, and warns", () => {
  const raw = JSON.stringify({ ...FULL, E: "TMBLF93T1FO050884" }); // letter O
  const { document, warnings } = parseRegistrationResponse(raw);
  expect(document.vin_broj).toBe(null);
  expect(warnings.some((w) => w.includes("VIN"))).toBe(true);
});

test("a missing VIN does not warn — only an unreadable one does", () => {
  const { warnings } = parseRegistrationResponse(JSON.stringify({ ...FULL, E: null }));
  expect(warnings.some((w) => w.includes("VIN"))).toBe(false);
});

test("a document without harmonised codes is flagged as unverified", () => {
  const { warnings } = parseRegistrationResponse(JSON.stringify({ ...FULL, kodovi_vidljivi: false }));
  expect(warnings.some((w) => w.includes("EU oznake"))).toBe(true);
});

test("C.2 different from C.1 keeps the holder and warns about the owner", () => {
  const raw = JSON.stringify({ ...FULL, C2: { ime: "Amra", prezime: "Hodžić" } });
  const { document, warnings } = parseRegistrationResponse(raw);
  expect(document.vlasnik).toEqual({ ime: "Tarik", prezime: "Čaplja" }); // C.1 wins
  expect(warnings.some((w) => w.includes("Amra Hodžić"))).toBe(true);
});

test("C.2 equal to C.1 is not a warning", () => {
  const raw = JSON.stringify({ ...FULL, C2: { ime: "TARIK", prezime: "CAPLJA" } });
  const { warnings } = parseRegistrationResponse(raw);
  expect(warnings).toEqual([]);
});

test("C.2 mismatch warning never prints the literal word null for a partial holder name", () => {
  const raw = JSON.stringify({ ...FULL, C11: "Čaplja", C12: null, C2: { ime: "Amra", prezime: "Hodžić" } });
  const { warnings } = parseRegistrationResponse(raw);
  const warning = warnings.find((w) => w.includes("Amra Hodžić"));
  expect(warning).toBeDefined();
  expect(warning).not.toContain("null");
  expect(warning).toContain("Čaplja");
});

test("C.2 with the holder's names swapped is the same person, not a mismatch", () => {
  const raw = JSON.stringify({ ...FULL, C11: "Čaplja", C12: "Tarik", C2: { ime: "Čaplja", prezime: "Tarik" } });
  const { warnings } = parseRegistrationResponse(raw);
  expect(warnings).toEqual([]);
});

test("an unreadable holder with a readable C.2 owner keeps the holder null but warns naming the owner", () => {
  const raw = JSON.stringify({ ...FULL, C11: null, C12: null, C2: { ime: "Amra", prezime: "Hodžić" } });
  const { document, warnings } = parseRegistrationResponse(raw);
  expect(document.vlasnik).toEqual({ ime: null, prezime: null }); // C.1 always wins, never substituted
  expect(warnings.length).toBe(1);
  expect(warnings[0]).toContain("Amra Hodžić");
  expect(warnings[0]).toContain("nije pročitano");
});

test("an unrecognised fuel is kept and warned about", () => {
  const { document, warnings } = parseRegistrationResponse(JSON.stringify({ ...FULL, P3: "VODIK" }));
  expect(document.motor).toBe("2.0 vodik");
  expect(warnings.some((w) => w.includes("gorivo") || w.includes("Gorivo"))).toBe(true);
});

test("turns missing, empty and non-string fields into null", () => {
  const raw = JSON.stringify({ D1: "", D3: 42, P1: "1968", C11: null, C12: null });
  const { document } = parseRegistrationResponse(raw);
  expect(document.marka_vozila).toBe(null);
  expect(document.model_vozila).toBe(null);
  expect(document.motor).toBe(null); // P1 was a string, not a number
  expect(document.vlasnik).toEqual({ ime: null, prezime: null });
});

test("keeps only string warnings from the model", () => {
  const raw = JSON.stringify({ kodovi_vidljivi: true, warnings: ["nejasan VIN", 7, null] });
  const { warnings } = parseRegistrationResponse(raw);
  expect(warnings).toEqual(["nejasan VIN"]);
});

test("rejects invalid JSON and non-objects", () => {
  expect(() => parseRegistrationResponse("not json")).toThrow();
  expect(() => parseRegistrationResponse("[1,2]")).toThrow();
});

test("hasUsableIdentifier requires a VIN or plates", () => {
  const empty = parseRegistrationResponse(JSON.stringify({ kodovi_vidljivi: true })).document;
  expect(hasUsableIdentifier(empty)).toBe(false);

  const vinOnly = parseRegistrationResponse(
    JSON.stringify({ E: "TMBLF93T1F9050884", kodovi_vidljivi: true })
  ).document;
  expect(hasUsableIdentifier(vinOnly)).toBe(true);

  const platesOnly = parseRegistrationResponse(
    JSON.stringify({ A: "E17-M-318", kodovi_vidljivi: true })
  ).document;
  expect(hasUsableIdentifier(platesOnly)).toBe(true);
});

test("buildRegistrationMessages embeds the image and the rendered code table", () => {
  const messages = buildRegistrationMessages("data:image/png;base64,AAA");
  expect(messages.length).toBe(2);
  const parts = messages[1]!.content as Array<{ type: string; text?: string }>;
  expect(parts.some((p) => p.type === "image_url")).toBe(true);

  const textPart = parts.find((p) => p.type === "text");
  expect(textPart).toBeDefined();
  // Prove the prompt embeds the actual rendered table verbatim, not just that
  // it happens to mention every code somewhere (some codes also appear inside
  // the JSON shape or the rule prose, which would pass even if the table were
  // dropped entirely).
  expect(textPart!.text).toContain(renderCodeTable());
  expect(textPart!.text).toContain("1999/37/EC");
});

test("the prompt forbids the address codes and warns about place names", () => {
  const text = JSON.stringify(buildRegistrationMessages("data:image/png;base64,AAA"));
  expect(text).toContain("C.1.3");
  expect(text).toContain("-ić"); // the trap: Bosnian place names look like surnames
  expect(text).toContain("1999/37/EC");
});

test("an address line never survives as a name", () => {
  const raw = JSON.stringify({ ...FULL, C11: "Mrkotić 180", C12: "Mrkotić, Tešanj" });
  const { document } = parseRegistrationResponse(raw);
  expect(document.vlasnik).toEqual({ ime: null, prezime: null });
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
