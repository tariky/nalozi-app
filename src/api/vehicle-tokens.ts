import { getDB } from '../db';
import { requireAuth, validateCsrf } from './auth';
import type { PublicServiceHistoryData, PublicServiceVisit } from '../types';

// Generate a random, non-guessable public token (16 hex chars).
function generatePublicToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// POST /api/vehicles/:id/public-token - Create or return the public QR token for a vehicle
export function createVehiclePublicToken(req: Request): Response {
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  // Path: /api/vehicles/:id/public-token -> id is second-to-last segment
  const parts = new URL(req.url).pathname.split('/');
  const vehicleId = parseInt(parts[parts.length - 2] || '0');

  const db = getDB();
  const vehicle = db.query<{ id: number }, [number]>(
    'SELECT id FROM vehicles WHERE id = ?'
  ).get(vehicleId);
  if (!vehicle) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  const existing = db.query<{ token: string }, [number]>(
    'SELECT token FROM vehicle_public_tokens WHERE vehicle_id = ?'
  ).get(vehicleId);
  if (existing) {
    return Response.json({ token: existing.token });
  }

  const token = generatePublicToken();
  db.query<null, [string, number]>(
    'INSERT INTO vehicle_public_tokens (token, vehicle_id) VALUES (?, ?)'
  ).run(token, vehicleId);

  return Response.json({ token });
}

interface VehicleRow {
  id: number;
  registarske_tablice: string;
  vin_broj: string | null;
  marka_vozila: string;
  model_vozila: string;
}

interface OrderRow {
  id: number;
  created_at: string;
  kilometraza: number | null;
  opis_kvara: string | null;
  mech_ime: string | null;
  mech_prezime: string | null;
}

// GET /api/public/service-history/:token - Public, sanitized service history (no auth)
export function getPublicServiceHistory(req: Request): Response {
  const token = new URL(req.url).pathname.split('/').pop() || '';
  const db = getDB();

  const link = db.query<{ vehicle_id: number }, [string]>(
    'SELECT vehicle_id FROM vehicle_public_tokens WHERE token = ?'
  ).get(token);
  if (!link) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  const vehicle = db.query<VehicleRow, [number]>(
    'SELECT id, registarske_tablice, vin_broj, marka_vozila, model_vozila FROM vehicles WHERE id = ?'
  ).get(link.vehicle_id);
  if (!vehicle) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  // Group by VIN when present, otherwise fall back to plates.
  const matchByVin = !!vehicle.vin_broj;
  const orders = db.query<OrderRow, [string]>(
    `SELECT wo.id, wo.created_at, wo.kilometraza, wo.opis_kvara,
            m.ime as mech_ime, m.prezime as mech_prezime
     FROM work_orders wo
     LEFT JOIN mechanics m ON wo.mechanic_id = m.id
     WHERE wo.tip_naloga = 'auto' AND wo.${matchByVin ? 'vin_broj' : 'registarske_tablice'} = ?
     ORDER BY wo.created_at DESC`
  ).all(matchByVin ? vehicle.vin_broj! : vehicle.registarske_tablice);

  const itemStmt = db.query<{ tip: 'dio' | 'usluga'; naziv: string; kolicina: number }, [number]>(
    'SELECT tip, naziv, kolicina FROM work_order_items WHERE work_order_id = ?'
  );

  const visits: PublicServiceVisit[] = orders.map((o) => ({
    datum: o.created_at,
    kilometraza: o.kilometraza,
    opis_kvara: o.opis_kvara,
    mehanicar: o.mech_ime ? `${o.mech_ime} ${o.mech_prezime ?? ''}`.trim() : null,
    items: itemStmt.all(o.id).map((it) => ({ tip: it.tip, naziv: it.naziv, kolicina: it.kolicina })),
  }));

  const company = db.query<{ naziv: string | null; logo: string | null }, []>(
    'SELECT naziv, logo FROM company_settings WHERE id = 1'
  ).get() ?? { naziv: null, logo: null };

  const payload: PublicServiceHistoryData = {
    company,
    vehicle: {
      marka_vozila: vehicle.marka_vozila,
      model_vozila: vehicle.model_vozila,
      registarske_tablice: vehicle.registarske_tablice,
    },
    visits,
  };

  return Response.json(payload);
}
