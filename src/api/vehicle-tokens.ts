import { getDB } from '../db';
import { requireAuth, validateCsrf } from './auth';

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
