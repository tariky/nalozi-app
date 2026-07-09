#!/usr/bin/env bun
/**
 * Create (or reset) an admin user.
 *
 *   bun run src/scripts/create-admin.ts <username> <password>
 *   bun run src/scripts/create-admin.ts <username> <password> --force
 *
 * Credentials may also come from ADMIN_USERNAME / ADMIN_PASSWORD so they
 * never have to appear in shell history. Without --force, an existing
 * username is left untouched rather than having its password overwritten.
 */
import { getDB, closeDB } from "../db";

const args = process.argv.slice(2);
const force = args.includes("--force");
const positional = args.filter((a) => !a.startsWith("--"));

const username = positional[0] ?? process.env.ADMIN_USERNAME;
const password = positional[1] ?? process.env.ADMIN_PASSWORD;

if (!username || !password) {
  console.error("Usage: bun run src/scripts/create-admin.ts <username> <password> [--force]");
  console.error("   or: ADMIN_USERNAME=... ADMIN_PASSWORD=... bun run src/scripts/create-admin.ts");
  process.exit(1);
}

if (password.length < 4) {
  console.error("❌ Lozinka mora imati najmanje 4 karaktera.");
  process.exit(1);
}

const db = getDB();
console.log(`Baza: ${process.env.DB_PATH ?? "data/asnord.db"}`);

const existing = db
  .query<{ id: number; role: string }, [string]>("SELECT id, role FROM users WHERE username = ?")
  .get(username);

if (existing && !force) {
  console.error(`❌ Korisnik "${username}" već postoji (id=${existing.id}, uloga=${existing.role}).`);
  console.error(`   Za promjenu lozinke ponovi komandu sa --force.`);
  closeDB();
  process.exit(1);
}

const passwordHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });

if (existing) {
  db.query<null, [string, number]>(
    "UPDATE users SET password_hash = ?, role = 'admin', mechanic_id = NULL WHERE id = ?",
  ).run(passwordHash, existing.id);

  // Old sessions still authenticate with the old password's session id.
  db.query<null, [number]>("DELETE FROM sessions WHERE user_id = ?").run(existing.id);

  console.log(`✅ Lozinka resetovana za admina "${username}" (id=${existing.id}). Postojeće sesije su odjavljene.`);
} else {
  const created = db
    .query<{ id: number }, [string, string]>(
      "INSERT INTO users (username, password_hash, role, mechanic_id) VALUES (?, ?, 'admin', NULL) RETURNING id",
    )
    .get(username, passwordHash);

  console.log(`✅ Admin "${username}" kreiran (id=${created!.id}).`);
}

closeDB();
