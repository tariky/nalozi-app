import { getDB } from '../db';
import type { Customer, CustomerForm } from '../types';

// GET /api/customers - List customers with optional search and pagination
export function getCustomers(req: Request): Response {
  const url = new URL(req.url);
  const search = url.searchParams.get('search');
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const offset = (page - 1) * limit;

  const db = getDB();

  let customers: Customer[];
  let total: number;

  if (search) {
    const searchPattern = `%${search}%`;
    total = db.query<{ count: number }, [string, string, string, string]>(
      `SELECT COUNT(*) as count FROM customers
       WHERE ime LIKE ? OR prezime LIKE ? OR naziv_firme LIKE ? OR telefon LIKE ?`
    ).get(searchPattern, searchPattern, searchPattern, searchPattern)!.count;

    customers = db.query<Customer, [string, string, string, string, number, number]>(
      `SELECT * FROM customers
       WHERE ime LIKE ? OR prezime LIKE ? OR naziv_firme LIKE ? OR telefon LIKE ?
       ORDER BY ime, prezime
       LIMIT ? OFFSET ?`
    ).all(searchPattern, searchPattern, searchPattern, searchPattern, limit, offset);
  } else {
    total = db.query<{ count: number }, []>(
      'SELECT COUNT(*) as count FROM customers'
    ).get()!.count;

    customers = db.query<Customer, [number, number]>(
      'SELECT * FROM customers ORDER BY ime, prezime LIMIT ? OFFSET ?'
    ).all(limit, offset);
  }

  return Response.json({
    items: customers,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

// GET /api/customers/:id - Get single customer
export function getCustomerById(req: Request): Response {
  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();
  const customer = db.query<Customer, [number]>(
    'SELECT * FROM customers WHERE id = ?'
  ).get(id);

  if (!customer) {
    return Response.json({ message: 'Klijent nije pronađen' }, { status: 404 });
  }

  return Response.json(customer);
}

// POST /api/customers - Create customer
export async function createCustomer(req: Request): Promise<Response> {
  const data: CustomerForm = await req.json();

  if (!data.ime || !data.prezime) {
    return Response.json({ message: 'Ime i prezime su obavezni' }, { status: 400 });
  }

  const db = getDB();
  const result = db.query<{ id: number }, [string | null, string, string, string | null, string | null]>(
    `INSERT INTO customers (naziv_firme, ime, prezime, telefon, email)
     VALUES (?, ?, ?, ?, ?) RETURNING id`
  ).get(
    data.naziv_firme || null,
    data.ime,
    data.prezime,
    data.telefon || null,
    data.email || null
  );

  const customer = db.query<Customer, [number]>(
    'SELECT * FROM customers WHERE id = ?'
  ).get(result!.id);

  return Response.json(customer, { status: 201 });
}

// PUT /api/customers/:id - Update customer
export async function updateCustomer(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');
  const data: CustomerForm = await req.json();

  if (!data.ime || !data.prezime) {
    return Response.json({ message: 'Ime i prezime su obavezni' }, { status: 400 });
  }

  const db = getDB();

  // Check if exists
  const existing = db.query<Customer, [number]>(
    'SELECT * FROM customers WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Klijent nije pronađen' }, { status: 404 });
  }

  db.query<null, [string | null, string, string, string | null, string | null, number]>(
    `UPDATE customers SET naziv_firme = ?, ime = ?, prezime = ?, telefon = ?, email = ?
     WHERE id = ?`
  ).run(
    data.naziv_firme || null,
    data.ime,
    data.prezime,
    data.telefon || null,
    data.email || null,
    id
  );

  const customer = db.query<Customer, [number]>(
    'SELECT * FROM customers WHERE id = ?'
  ).get(id);

  return Response.json(customer);
}
