import { getDB } from '../db';
import { requireAuth, requireAdmin, validateCsrf } from './auth';
import type { Mechanic, MechanicForm } from '../types';

// GET /api/mechanics - List all active mechanics
export function getMechanics(req: Request): Response {
  // Require authentication
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;

  const db = getDB();
  const mechanics = db.query<Mechanic, []>(
    'SELECT * FROM mechanics WHERE aktivan = 1 ORDER BY ime, prezime'
  ).all();
  return Response.json(mechanics);
}

// GET /api/mechanics/:id - Get single mechanic
export function getMechanicById(req: Request): Response {
  // Require authentication
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();
  const mechanic = db.query<Mechanic, [number]>(
    'SELECT * FROM mechanics WHERE id = ?'
  ).get(id);

  if (!mechanic) {
    return Response.json({ message: 'Mehaničar nije pronađen' }, { status: 404 });
  }

  return Response.json(mechanic);
}

// POST /api/mechanics - Create mechanic (admin only)
export async function createMechanic(req: Request): Promise<Response> {
  // Require admin + CSRF validation
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const data: MechanicForm = await req.json();

  if (!data.ime || !data.prezime) {
    return Response.json({ message: 'Ime i prezime su obavezni' }, { status: 400 });
  }

  const db = getDB();
  const result = db.query<{ id: number }, [string, string, string | null]>(
    `INSERT INTO mechanics (ime, prezime, telefon) VALUES (?, ?, ?) RETURNING id`
  ).get(data.ime, data.prezime, data.telefon || null);

  const mechanic = db.query<Mechanic, [number]>(
    'SELECT * FROM mechanics WHERE id = ?'
  ).get(result!.id);

  return Response.json(mechanic, { status: 201 });
}

// PUT /api/mechanics/:id - Update mechanic (admin only)
export async function updateMechanic(req: Request): Promise<Response> {
  // Require admin + CSRF validation
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');
  const data: MechanicForm = await req.json();

  if (!data.ime || !data.prezime) {
    return Response.json({ message: 'Ime i prezime su obavezni' }, { status: 400 });
  }

  const db = getDB();

  // Check if exists
  const existing = db.query<Mechanic, [number]>(
    'SELECT * FROM mechanics WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Mehaničar nije pronađen' }, { status: 404 });
  }

  db.query<null, [string, string, string | null, number]>(
    'UPDATE mechanics SET ime = ?, prezime = ?, telefon = ? WHERE id = ?'
  ).run(data.ime, data.prezime, data.telefon || null, id);

  const mechanic = db.query<Mechanic, [number]>(
    'SELECT * FROM mechanics WHERE id = ?'
  ).get(id);

  return Response.json(mechanic);
}

// DELETE /api/mechanics/:id - Soft delete (admin only)
export function deleteMechanic(req: Request): Response {
  // Require admin + CSRF validation
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();

  // Check if exists
  const existing = db.query<Mechanic, [number]>(
    'SELECT * FROM mechanics WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Mehaničar nije pronađen' }, { status: 404 });
  }

  // Soft delete
  db.query<null, [number]>(
    'UPDATE mechanics SET aktivan = 0 WHERE id = ?'
  ).run(id);

  return Response.json({ message: 'Mehaničar deaktiviran' });
}
