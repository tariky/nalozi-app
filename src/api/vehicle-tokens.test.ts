import { test, expect, beforeEach } from "bun:test";
import { getDB, closeDB } from "../db";

process.env.DB_PATH = ":memory:";

beforeEach(() => {
  closeDB();
  getDB();
});

test("schema: vehicle_public_tokens table exists", () => {
  const db = getDB();
  const cols = db.query<{ name: string }, []>(
    "PRAGMA table_info(vehicle_public_tokens)"
  ).all();
  const names = cols.map((c) => c.name).sort();
  expect(names).toEqual(["created_at", "token", "vehicle_id"]);
});
