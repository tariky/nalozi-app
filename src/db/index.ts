import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { createTablesSQL } from "./schema";

let db: Database | null = null;
let adminSeeded = false;

export function getDB(): Database {
  if (!db) {
    // Ensure data directory exists
    try {
      mkdirSync("data", { recursive: true });
    } catch {}
    db = new Database("data/asnord.db", { create: true });
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(createTablesSQL);

    // Run migrations for existing databases
    runMigrations(db);

    // Seed admin user (async, but we don't wait for it)
    if (!adminSeeded) {
      seedAdminUser(db);
      adminSeeded = true;
    }
  }
  return db;
}

// Seed admin user if not exists
async function seedAdminUser(db: Database): Promise<void> {
  try {
    const existingAdmin = db.query<{ id: number }, []>(
      "SELECT id FROM users WHERE username = 'admin'"
    ).get();

    if (!existingAdmin) {
      // Default admin password: admin123 (should be changed after first login)
      const passwordHash = await Bun.password.hash("admin123", {
        algorithm: "bcrypt",
        cost: 10,
      });

      db.query<null, [string, string, string]>(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
      ).run("admin", passwordHash, "admin");

      console.log("✅ Admin user created (username: admin, password: admin123)");
    }
  } catch (error) {
    console.error("Failed to seed admin user:", error);
  }
}

function runMigrations(db: Database): void {
  try {
    const columns = db.query<{ name: string }, []>(
      "PRAGMA table_info(work_orders)"
    ).all();

    // Add closed_at column if it doesn't exist
    const hasClosedAt = columns.some(col => col.name === 'closed_at');
    if (!hasClosedAt) {
      db.exec("ALTER TABLE work_orders ADD COLUMN closed_at TEXT");
    }

    // Add opis_kvara column if it doesn't exist
    const hasOpisKvara = columns.some(col => col.name === 'opis_kvara');
    if (!hasOpisKvara) {
      db.exec("ALTER TABLE work_orders ADD COLUMN opis_kvara TEXT");
    }

    // Add csrf_token column to sessions if it doesn't exist
    const sessionColumns = db.query<{ name: string }, []>(
      "PRAGMA table_info(sessions)"
    ).all();
    const hasCsrfToken = sessionColumns.some(col => col.name === 'csrf_token');
    if (!hasCsrfToken) {
      db.exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT");
    }
  } catch {}
}

export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Helper to generate work order number
export function generateWorkOrderNumber(): string {
  const db = getDB();
  const year = new Date().getFullYear();
  const prefix = `${year}-`;

  // Find the highest existing number for this year
  const result = db.query<{ max_num: string | null }, [string]>(
    `SELECT MAX(broj_naloga) as max_num FROM work_orders WHERE broj_naloga LIKE ?`
  ).get(`${prefix}%`);

  let nextNum = 1;
  if (result?.max_num) {
    // Extract the number part after the year prefix (e.g., "2026-0005" -> 5)
    const numPart = result.max_num.substring(prefix.length);
    nextNum = parseInt(numPart, 10) + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}
