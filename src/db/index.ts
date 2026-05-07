import { Database } from "bun:sqlite";
import { mkdirSync, copyFileSync, existsSync } from "fs";
import { createTablesSQL } from "./schema";

let db: Database | null = null;
let adminSeeded = false;

export function getDB(): Database {
  if (!db) {
    const dbPath = process.env.DB_PATH ?? "data/asnord.db";

    // Ensure data directory exists for file-backed databases
    if (dbPath !== ":memory:") {
      try {
        mkdirSync("data", { recursive: true });
      } catch {}
    }

    db = new Database(dbPath, { create: true });
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
    const columnNames = new Set(columns.map(c => c.name));

    // Pre-existing migrations (idempotent)
    if (!columnNames.has('closed_at')) {
      db.exec("ALTER TABLE work_orders ADD COLUMN closed_at TEXT");
    }
    if (!columnNames.has('opis_kvara')) {
      db.exec("ALTER TABLE work_orders ADD COLUMN opis_kvara TEXT");
    }
    if (!columnNames.has('kilometraza')) {
      db.exec("ALTER TABLE work_orders ADD COLUMN kilometraza INTEGER");
    }

    // Detect agregat-feature migration: any of these columns missing?
    const needsAgregatMigration =
      !columnNames.has('tip_naloga') ||
      !columnNames.has('tip_agregata') ||
      !columnNames.has('marka_agregata') ||
      !columnNames.has('model_agregata') ||
      !columnNames.has('serijski_broj');

    if (needsAgregatMigration) {
      backupDatabaseFile();
      if (!columnNames.has('tip_naloga')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN tip_naloga TEXT NOT NULL DEFAULT 'auto'");
      }
      if (!columnNames.has('tip_agregata')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN tip_agregata TEXT");
      }
      if (!columnNames.has('marka_agregata')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN marka_agregata TEXT");
      }
      if (!columnNames.has('model_agregata')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN model_agregata TEXT");
      }
      if (!columnNames.has('serijski_broj')) {
        db.exec("ALTER TABLE work_orders ADD COLUMN serijski_broj TEXT");
      }
    }

    // Existing work_order_items.popust migration
    const itemColumns = db.query<{ name: string }, []>(
      "PRAGMA table_info(work_order_items)"
    ).all();
    const hasPopust = itemColumns.some(col => col.name === 'popust');
    if (!hasPopust) {
      db.exec("ALTER TABLE work_order_items ADD COLUMN popust REAL DEFAULT 0");
    }

    // Existing sessions.csrf_token migration
    const sessionColumns = db.query<{ name: string }, []>(
      "PRAGMA table_info(sessions)"
    ).all();
    const hasCsrfToken = sessionColumns.some(col => col.name === 'csrf_token');
    if (!hasCsrfToken) {
      db.exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Database backup failed")) {
      throw err;
    }
    // Other migration errors (e.g. duplicate column on re-run) are silently ignored
    // by design — pre-existing pattern.
  }
}

function backupDatabaseFile(): void {
  const dbPath = process.env.DB_PATH ?? "data/asnord.db";
  // No backup for in-memory DBs (tests)
  if (dbPath === ":memory:") return;
  // Skip if the source file doesn't exist (fresh install — nothing to back up)
  if (!existsSync(dbPath)) return;

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.bak-${ts}`;
  try {
    copyFileSync(dbPath, backupPath);
    console.log(`✅ Database backup created at ${backupPath}`);
  } catch (err) {
    console.error(`❌ Failed to create database backup at ${backupPath}:`, err);
    throw new Error(`Database backup failed; aborting migration: ${(err as Error).message}`);
  }
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
