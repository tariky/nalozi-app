import { getDB } from '../db';
import type { Vehicle, VehicleForm, Customer } from '../types';

// GET /api/vehicles/check-vin/:vin - Check if VIN exists
export function checkVin(req: Request): Response {
  const url = new URL(req.url);
  const vin = url.pathname.split('/').pop() || '';

  if (!vin || vin.length < 5) {
    return Response.json({ exists: false });
  }

  const db = getDB();
  const vehicle = db.query<Vehicle & { customer_ime?: string; customer_prezime?: string }, [string]>(
    `SELECT v.*, c.ime as customer_ime, c.prezime as customer_prezime
     FROM vehicles v
     LEFT JOIN customers c ON v.customer_id = c.id
     WHERE v.vin_broj = ?`
  ).get(vin);

  if (vehicle) {
    return Response.json({
      exists: true,
      vehicle: {
        ...vehicle,
        customer: {
          id: vehicle.customer_id,
          ime: vehicle.customer_ime,
          prezime: vehicle.customer_prezime,
        }
      }
    });
  }

  return Response.json({ exists: false });
}

// GET /api/vehicles/by-customer/:customerId - Get vehicles for a customer
export function getVehiclesByCustomer(req: Request): Response {
  const url = new URL(req.url);
  const customerId = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();
  const vehicles = db.query<Vehicle, [number]>(
    'SELECT * FROM vehicles WHERE customer_id = ? ORDER BY marka_vozila, model_vozila'
  ).all(customerId);

  return Response.json(vehicles);
}

// GET /api/vehicles/:id - Get single vehicle
export function getVehicleById(req: Request): Response {
  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();
  const vehicle = db.query<Vehicle, [number]>(
    'SELECT * FROM vehicles WHERE id = ?'
  ).get(id);

  if (!vehicle) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  return Response.json(vehicle);
}

// POST /api/vehicles - Create vehicle
export async function createVehicle(req: Request): Promise<Response> {
  const data: VehicleForm = await req.json();

  if (!data.customer_id || !data.registarske_tablice || !data.marka_vozila || !data.model_vozila) {
    return Response.json({
      message: 'Klijent, registarske tablice, marka i model su obavezni'
    }, { status: 400 });
  }

  const db = getDB();

  // Check if VIN already exists (if provided)
  if (data.vin_broj) {
    const existingVin = db.query<{ id: number }, [string]>(
      'SELECT id FROM vehicles WHERE vin_broj = ?'
    ).get(data.vin_broj);

    if (existingVin) {
      return Response.json({
        message: 'Vozilo sa ovim VIN brojem već postoji'
      }, { status: 400 });
    }
  }

  const result = db.query<{ id: number }, [number, string, string | null, string, string, string | null]>(
    `INSERT INTO vehicles (customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila, motor)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(
    data.customer_id,
    data.registarske_tablice,
    data.vin_broj || null,
    data.marka_vozila,
    data.model_vozila,
    data.motor || null
  );

  const vehicle = db.query<Vehicle, [number]>(
    'SELECT * FROM vehicles WHERE id = ?'
  ).get(result!.id);

  return Response.json(vehicle, { status: 201 });
}

// PUT /api/vehicles/:id - Update vehicle
export async function updateVehicle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');
  const data: Partial<VehicleForm> = await req.json();

  const db = getDB();

  const existing = db.query<Vehicle, [number]>(
    'SELECT * FROM vehicles WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  db.query<null, [string, string | null, string, string, string | null, number]>(
    `UPDATE vehicles SET registarske_tablice = ?, vin_broj = ?, marka_vozila = ?, model_vozila = ?, motor = ?
     WHERE id = ?`
  ).run(
    data.registarske_tablice || existing.registarske_tablice,
    data.vin_broj !== undefined ? (data.vin_broj || null) : existing.vin_broj,
    data.marka_vozila || existing.marka_vozila,
    data.model_vozila || existing.model_vozila,
    data.motor !== undefined ? (data.motor || null) : existing.motor,
    id
  );

  const vehicle = db.query<Vehicle, [number]>(
    'SELECT * FROM vehicles WHERE id = ?'
  ).get(id);

  return Response.json(vehicle);
}

// DELETE /api/vehicles/:id - Delete vehicle
export function deleteVehicle(req: Request): Response {
  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();

  const existing = db.query<Vehicle, [number]>(
    'SELECT * FROM vehicles WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Vozilo nije pronađeno' }, { status: 404 });
  }

  db.query<null, [number]>('DELETE FROM vehicles WHERE id = ?').run(id);

  return Response.json({ success: true });
}
