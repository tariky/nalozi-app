import { getDB, generateWorkOrderNumber } from '../db';
import { getCurrentUser, requireAuth, validateCsrf } from './auth';
import type { WorkOrder, WorkOrderForm, WorkOrderItem, WorkOrderItemForm, Customer, Mechanic, TimeEntry } from '../types';

// Helper to get work order with related data
function getWorkOrderWithDetails(id: number): WorkOrder | null {
  const db = getDB();

  const workOrder = db.query<WorkOrder, [number]>(
    'SELECT * FROM work_orders WHERE id = ?'
  ).get(id);

  if (!workOrder) return null;

  // Get customer
  workOrder.customer = db.query<Customer, [number]>(
    'SELECT * FROM customers WHERE id = ?'
  ).get(workOrder.customer_id) || undefined;

  // Get mechanic
  if (workOrder.mechanic_id) {
    workOrder.mechanic = db.query<Mechanic, [number]>(
      'SELECT * FROM mechanics WHERE id = ?'
    ).get(workOrder.mechanic_id) || undefined;
  }

  // Get items
  workOrder.items = db.query<WorkOrderItem, [number]>(
    'SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY id'
  ).all(workOrder.id);

  // Get time entries
  workOrder.time_entries = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE work_order_id = ? ORDER BY started_at DESC'
  ).all(workOrder.id);

  return workOrder;
}

// Helper to recalculate total
function recalculateTotal(workOrderId: number): void {
  const db = getDB();
  const result = db.query<{ total: number }, [number]>(
    'SELECT COALESCE(SUM(ukupna_cijena), 0) as total FROM work_order_items WHERE work_order_id = ?'
  ).get(workOrderId);

  db.query<null, [number, number]>(
    'UPDATE work_orders SET ukupna_cijena = ? WHERE id = ?'
  ).run(result?.total || 0, workOrderId);
}

// GET /api/work-orders - List with pagination
export function getWorkOrders(req: Request): Response {
  // Require authentication
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const status = url.searchParams.get('status');
  const offset = (page - 1) * limit;

  // Get current user to check role
  const currentUser = authResult;

  const db = getDB();

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  // If user is mechanic, only show their work orders
  if (currentUser && currentUser.role === 'mechanic' && currentUser.mechanic_id) {
    whereClauses.push('wo.mechanic_id = ?');
    params.push(currentUser.mechanic_id);
  }

  if (status) {
    whereClauses.push('wo.status = ?');
    params.push(status);
  }

  const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Get total count
  const countResult = db.query<{ count: number }, (string | number)[]>(
    `SELECT COUNT(*) as count FROM work_orders wo ${whereClause}`
  ).get(...params);
  const total = countResult?.count || 0;

  // Get work orders with customer and mechanic names
  const workOrders = db.query<WorkOrder & { customer_ime: string; customer_prezime: string; customer_firma: string | null; mechanic_ime: string | null; mechanic_prezime: string | null }, (string | number)[]>(
    `SELECT wo.*,
            c.ime as customer_ime, c.prezime as customer_prezime, c.naziv_firme as customer_firma,
            m.ime as mechanic_ime, m.prezime as mechanic_prezime
     FROM work_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     LEFT JOIN mechanics m ON wo.mechanic_id = m.id
     ${whereClause}
     ORDER BY wo.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`
  ).all(...params);

  // Transform to include nested objects
  const items = workOrders.map(wo => ({
    ...wo,
    customer: wo.customer_id ? {
      id: wo.customer_id,
      ime: wo.customer_ime,
      prezime: wo.customer_prezime,
      naziv_firme: wo.customer_firma,
    } : undefined,
    mechanic: wo.mechanic_id ? {
      id: wo.mechanic_id,
      ime: wo.mechanic_ime,
      prezime: wo.mechanic_prezime,
    } : undefined,
  }));

  return Response.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

// GET /api/work-orders/search - Search by VIN, plates, customer
export function searchWorkOrders(req: Request): Response {
  // Require authentication
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const query = url.searchParams.get('q') || '';

  if (!query || query.length < 2) {
    return Response.json([]);
  }

  // Get current user to check role
  const currentUser = authResult;

  const db = getDB();
  const searchPattern = `%${query}%`;

  // Build mechanic filter if needed
  let mechanicFilter = '';
  const params: (string | number)[] = [searchPattern, searchPattern, searchPattern, searchPattern];

  if (currentUser && currentUser.role === 'mechanic' && currentUser.mechanic_id) {
    mechanicFilter = 'AND wo.mechanic_id = ?';
    params.push(currentUser.mechanic_id);
  }

  const workOrders = db.query<WorkOrder & { customer_ime: string; customer_prezime: string; customer_firma: string | null }, (string | number)[]>(
    `SELECT wo.*, c.ime as customer_ime, c.prezime as customer_prezime, c.naziv_firme as customer_firma
     FROM work_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     WHERE (wo.vin_broj LIKE ?
        OR wo.registarske_tablice LIKE ?
        OR c.ime LIKE ?
        OR c.prezime LIKE ?)
        ${mechanicFilter}
     ORDER BY wo.created_at DESC
     LIMIT 50`
  ).all(...params);

  const items = workOrders.map(wo => ({
    ...wo,
    customer: {
      id: wo.customer_id,
      ime: wo.customer_ime,
      prezime: wo.customer_prezime,
      naziv_firme: wo.customer_firma,
    },
  }));

  return Response.json(items);
}

// GET /api/work-orders/by-customer/:customerId - Get work orders for a customer
export function getWorkOrdersByCustomer(req: Request): Response {
  // Require authentication
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const customerId = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();

  // If mechanic, only show their work orders for this customer
  let query = 'SELECT * FROM work_orders WHERE customer_id = ?';
  const params: (number)[] = [customerId];

  if (authResult.role === 'mechanic' && authResult.mechanic_id) {
    query += ' AND mechanic_id = ?';
    params.push(authResult.mechanic_id);
  }

  query += ' ORDER BY created_at DESC';

  const workOrders = db.query<WorkOrder, (number)[]>(query).all(...params);

  return Response.json(workOrders);
}

// GET /api/work-orders/:id - Get single with items
export function getWorkOrderById(req: Request): Response {
  // Require authentication
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const workOrder = getWorkOrderWithDetails(id);

  if (!workOrder) {
    return Response.json({ message: 'Radni nalog nije pronađen' }, { status: 404 });
  }

  // Check if mechanic can view this work order
  if (authResult.role === 'mechanic' && authResult.mechanic_id) {
    if (workOrder.mechanic_id !== authResult.mechanic_id) {
      return Response.json({ message: 'Nemate pristup ovom radnom nalogu' }, { status: 403 });
    }
  }

  return Response.json(workOrder);
}

// POST /api/work-orders - Create work order
export async function createWorkOrder(req: Request): Promise<Response> {
  // Require authentication + CSRF validation
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const data: WorkOrderForm = await req.json();

  if (!data.customer_id || !data.registarske_tablice || !data.marka_vozila || !data.model_vozila) {
    return Response.json({
      message: 'Klijent, registarske tablice, marka i model vozila su obavezni'
    }, { status: 400 });
  }

  const db = getDB();
  const brojNaloga = generateWorkOrderNumber();
  const createdAt = new Date().toISOString();

  const result = db.query<{ id: number }, [string, number, string, string | null, string, string, string | null, number | null, number | null, string | null, string | null, string, string]>(
    `INSERT INTO work_orders
     (broj_naloga, customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila, motor, kilometraza, mechanic_id, opis_kvara, napomena, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(
    brojNaloga,
    data.customer_id,
    data.registarske_tablice,
    data.vin_broj || null,
    data.marka_vozila,
    data.model_vozila,
    data.motor || null,
    data.kilometraza ?? null,
    data.mechanic_id ?? null,
    data.opis_kvara || null,
    data.napomena || null,
    data.status || 'otvoren',
    createdAt
  );

  const workOrder = getWorkOrderWithDetails(result!.id);
  return Response.json(workOrder, { status: 201 });
}

// PUT /api/work-orders/:id - Update work order
export async function updateWorkOrder(req: Request): Promise<Response> {
  // Require authentication + CSRF validation
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');
  const data: Partial<WorkOrderForm> = await req.json();

  const db = getDB();

  // Check if exists
  const existing = db.query<WorkOrder, [number]>(
    'SELECT * FROM work_orders WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Radni nalog nije pronađen' }, { status: 404 });
  }

  // Check authorization: admin can update any, mechanic can only update their own
  if (authResult.role === 'mechanic' && authResult.mechanic_id) {
    if (existing.mechanic_id !== authResult.mechanic_id) {
      return Response.json({ message: 'Nemate pristup ovom radnom nalogu' }, { status: 403 });
    }
  }

  // Build update query dynamically
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.customer_id !== undefined) {
    updates.push('customer_id = ?');
    values.push(data.customer_id);
  }
  if (data.registarske_tablice !== undefined) {
    updates.push('registarske_tablice = ?');
    values.push(data.registarske_tablice);
  }
  if (data.vin_broj !== undefined) {
    updates.push('vin_broj = ?');
    values.push(data.vin_broj || null);
  }
  if (data.marka_vozila !== undefined) {
    updates.push('marka_vozila = ?');
    values.push(data.marka_vozila);
  }
  if (data.model_vozila !== undefined) {
    updates.push('model_vozila = ?');
    values.push(data.model_vozila);
  }
  if (data.motor !== undefined) {
    updates.push('motor = ?');
    values.push(data.motor || null);
  }
  if (data.kilometraza !== undefined) {
    updates.push('kilometraza = ?');
    values.push(data.kilometraza ?? null);
  }
  if (data.mechanic_id !== undefined) {
    updates.push('mechanic_id = ?');
    values.push(data.mechanic_id ?? null);
  }
  if (data.opis_kvara !== undefined) {
    updates.push('opis_kvara = ?');
    values.push(data.opis_kvara || null);
  }
  if (data.napomena !== undefined) {
    updates.push('napomena = ?');
    values.push(data.napomena || null);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);

    // Set closed_at when status changes to 'zavrsen'
    if (data.status === 'zavrsen' && existing.status !== 'zavrsen') {
      updates.push('closed_at = ?');
      values.push(new Date().toISOString());

      // Stop any running time entries
      const endedAt = new Date().toISOString();
      db.query<null, [string, number]>(
        'UPDATE time_entries SET ended_at = ? WHERE work_order_id = ? AND ended_at IS NULL'
      ).run(endedAt, id);
    }
    // Clear closed_at if reopening
    if (data.status !== 'zavrsen' && existing.status === 'zavrsen') {
      updates.push('closed_at = ?');
      values.push(null);
    }
  }

  if (updates.length > 0) {
    values.push(id);
    db.query<null, (string | number | null)[]>(
      `UPDATE work_orders SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);
  }

  const workOrder = getWorkOrderWithDetails(id);
  return Response.json(workOrder);
}

// DELETE /api/work-orders/:id - Delete work order
export function deleteWorkOrder(req: Request): Response {
  // Require authentication + CSRF validation
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();

  // Check if exists
  const existing = db.query<WorkOrder, [number]>(
    'SELECT * FROM work_orders WHERE id = ?'
  ).get(id);

  if (!existing) {
    return Response.json({ message: 'Radni nalog nije pronađen' }, { status: 404 });
  }

  // Check authorization: admin can delete any, mechanic can only delete their own
  if (authResult.role === 'mechanic' && authResult.mechanic_id) {
    if (existing.mechanic_id !== authResult.mechanic_id) {
      return Response.json({ message: 'Nemate pristup ovom radnom nalogu' }, { status: 403 });
    }
  }

  // Delete items first (CASCADE should handle this, but explicit is safer)
  db.query<null, [number]>(
    'DELETE FROM work_order_items WHERE work_order_id = ?'
  ).run(id);

  // Delete work order
  db.query<null, [number]>(
    'DELETE FROM work_orders WHERE id = ?'
  ).run(id);

  return Response.json({ message: 'Radni nalog obrisan' });
}

// POST /api/work-orders/:id/items - Add item
export async function addWorkOrderItem(req: Request): Promise<Response> {
  // Require authentication + CSRF validation
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const workOrderId = parseInt(pathParts[pathParts.length - 2] || '0');
  const data: WorkOrderItemForm = await req.json();

  if (!data.tip || !data.naziv || data.jedinicna_cijena === undefined) {
    return Response.json({ message: 'Tip, naziv i cijena su obavezni' }, { status: 400 });
  }

  const db = getDB();

  // Check if work order exists
  const workOrder = db.query<WorkOrder, [number]>(
    'SELECT * FROM work_orders WHERE id = ?'
  ).get(workOrderId);

  if (!workOrder) {
    return Response.json({ message: 'Radni nalog nije pronađen' }, { status: 404 });
  }

  // Check authorization
  if (authResult.role === 'mechanic' && authResult.mechanic_id) {
    if (workOrder.mechanic_id !== authResult.mechanic_id) {
      return Response.json({ message: 'Nemate pristup ovom radnom nalogu' }, { status: 403 });
    }
  }

  const kolicina = data.kolicina || 1;
  const popust = data.popust ?? 0;
  if (popust < 0 || popust > 100) {
    return Response.json({ message: 'Popust mora biti između 0 i 100%' }, { status: 400 });
  }
  const subtotal = kolicina * data.jedinicna_cijena;
  const ukupnaCijena = subtotal - (subtotal * popust / 100);

  const result = db.query<{ id: number }, [number, string, string, number, number, number, number]>(
    `INSERT INTO work_order_items (work_order_id, tip, naziv, kolicina, jedinicna_cijena, popust, ukupna_cijena)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(workOrderId, data.tip, data.naziv, kolicina, data.jedinicna_cijena, popust, ukupnaCijena);

  // Recalculate total
  recalculateTotal(workOrderId);

  const item = db.query<WorkOrderItem, [number]>(
    'SELECT * FROM work_order_items WHERE id = ?'
  ).get(result!.id);

  return Response.json(item, { status: 201 });
}

// PUT /api/work-orders/:orderId/items/:itemId - Update item
export async function updateWorkOrderItem(req: Request): Promise<Response> {
  // Require authentication + CSRF validation
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const itemId = parseInt(pathParts[pathParts.length - 1] || '0');
  const workOrderId = parseInt(pathParts[pathParts.length - 3] || '0');
  const data: WorkOrderItemForm = await req.json();

  const db = getDB();

  // Check if work order exists and user has access
  const workOrder = db.query<WorkOrder, [number]>(
    'SELECT * FROM work_orders WHERE id = ?'
  ).get(workOrderId);

  if (!workOrder) {
    return Response.json({ message: 'Radni nalog nije pronađen' }, { status: 404 });
  }

  // Check authorization
  if (authResult.role === 'mechanic' && authResult.mechanic_id) {
    if (workOrder.mechanic_id !== authResult.mechanic_id) {
      return Response.json({ message: 'Nemate pristup ovom radnom nalogu' }, { status: 403 });
    }
  }

  // Check if item exists
  const existing = db.query<WorkOrderItem, [number, number]>(
    'SELECT * FROM work_order_items WHERE id = ? AND work_order_id = ?'
  ).get(itemId, workOrderId);

  if (!existing) {
    return Response.json({ message: 'Stavka nije pronađena' }, { status: 404 });
  }

  const kolicina = data.kolicina || existing.kolicina;
  const jedinicnaCijena = data.jedinicna_cijena ?? existing.jedinicna_cijena;
  const popust = data.popust ?? existing.popust ?? 0;
  if (popust < 0 || popust > 100) {
    return Response.json({ message: 'Popust mora biti između 0 i 100%' }, { status: 400 });
  }
  const subtotal = kolicina * jedinicnaCijena;
  const ukupnaCijena = subtotal - (subtotal * popust / 100);

  db.query<null, [string, string, number, number, number, number, number]>(
    `UPDATE work_order_items SET tip = ?, naziv = ?, kolicina = ?, jedinicna_cijena = ?, popust = ?, ukupna_cijena = ?
     WHERE id = ?`
  ).run(data.tip || existing.tip, data.naziv || existing.naziv, kolicina, jedinicnaCijena, popust, ukupnaCijena, itemId);

  // Recalculate total
  recalculateTotal(workOrderId);

  const item = db.query<WorkOrderItem, [number]>(
    'SELECT * FROM work_order_items WHERE id = ?'
  ).get(itemId);

  return Response.json(item);
}

// DELETE /api/work-orders/:orderId/items/:itemId - Delete item
export function deleteWorkOrderItem(req: Request): Response {
  // Require authentication + CSRF validation
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const itemId = parseInt(pathParts[pathParts.length - 1] || '0');
  const workOrderId = parseInt(pathParts[pathParts.length - 3] || '0');

  const db = getDB();

  // Check if work order exists and user has access
  const workOrder = db.query<WorkOrder, [number]>(
    'SELECT * FROM work_orders WHERE id = ?'
  ).get(workOrderId);

  if (!workOrder) {
    return Response.json({ message: 'Radni nalog nije pronađen' }, { status: 404 });
  }

  // Check authorization
  if (authResult.role === 'mechanic' && authResult.mechanic_id) {
    if (workOrder.mechanic_id !== authResult.mechanic_id) {
      return Response.json({ message: 'Nemate pristup ovom radnom nalogu' }, { status: 403 });
    }
  }

  // Check if item exists
  const existing = db.query<WorkOrderItem, [number, number]>(
    'SELECT * FROM work_order_items WHERE id = ? AND work_order_id = ?'
  ).get(itemId, workOrderId);

  if (!existing) {
    return Response.json({ message: 'Stavka nije pronađena' }, { status: 404 });
  }

  db.query<null, [number]>(
    'DELETE FROM work_order_items WHERE id = ?'
  ).run(itemId);

  // Recalculate total
  recalculateTotal(workOrderId);

  return Response.json({ message: 'Stavka obrisana' });
}

// GET /api/work-orders/export/csv - Export all work orders as CSV (admin only)
export function exportWorkOrdersCSV(req: Request): Response {
  // Require admin access
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  if (authResult.role !== 'admin') {
    return Response.json({ message: 'Nemate pristup' }, { status: 403 });
  }

  const db = getDB();

  // Get all work orders with full details
  const workOrders = db.query<WorkOrder & {
    customer_ime: string;
    customer_prezime: string;
    customer_firma: string | null;
    customer_telefon: string | null;
    mechanic_ime: string | null;
    mechanic_prezime: string | null;
  }, []>(
    `SELECT wo.*,
            c.ime as customer_ime, c.prezime as customer_prezime, c.naziv_firme as customer_firma, c.telefon as customer_telefon,
            m.ime as mechanic_ime, m.prezime as mechanic_prezime
     FROM work_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     LEFT JOIN mechanics m ON wo.mechanic_id = m.id
     ORDER BY wo.created_at DESC`
  ).all();

  // CSV headers
  const headers = [
    'broj_naloga',
    'status',
    'created_at',
    'closed_at',
    'registarske_tablice',
    'vin_broj',
    'marka_vozila',
    'model_vozila',
    'motor',
    'kilometraza',
    'opis_kvara',
    'napomena',
    'ukupna_cijena',
    'customer_ime',
    'customer_prezime',
    'customer_firma',
    'customer_telefon',
    'mechanic_ime',
    'mechanic_prezime',
    'items_json',
    'time_entries_json'
  ];

  // Escape CSV field
  const escapeCSV = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV rows
  const rows: string[] = [];
  rows.push(headers.join(','));

  for (const wo of workOrders) {
    // Get items for this work order
    const items = db.query<WorkOrderItem, [number]>(
      'SELECT tip, naziv, kolicina, jedinicna_cijena, popust, ukupna_cijena FROM work_order_items WHERE work_order_id = ?'
    ).all(wo.id);

    // Get time entries for this work order
    const timeEntries = db.query<{ started_at: string; ended_at: string | null; mechanic_ime: string | null; mechanic_prezime: string | null }, [number]>(
      `SELECT te.started_at, te.ended_at, m.ime as mechanic_ime, m.prezime as mechanic_prezime
       FROM time_entries te
       LEFT JOIN mechanics m ON te.mechanic_id = m.id
       WHERE te.work_order_id = ?`
    ).all(wo.id);

    const row = [
      escapeCSV(wo.broj_naloga),
      escapeCSV(wo.status),
      escapeCSV(wo.created_at),
      escapeCSV(wo.closed_at),
      escapeCSV(wo.registarske_tablice),
      escapeCSV(wo.vin_broj),
      escapeCSV(wo.marka_vozila),
      escapeCSV(wo.model_vozila),
      escapeCSV(wo.motor),
      escapeCSV(wo.kilometraza),
      escapeCSV(wo.opis_kvara),
      escapeCSV(wo.napomena),
      escapeCSV(wo.ukupna_cijena),
      escapeCSV(wo.customer_ime),
      escapeCSV(wo.customer_prezime),
      escapeCSV(wo.customer_firma),
      escapeCSV(wo.customer_telefon),
      escapeCSV(wo.mechanic_ime),
      escapeCSV(wo.mechanic_prezime),
      escapeCSV(JSON.stringify(items)),
      escapeCSV(JSON.stringify(timeEntries))
    ];

    rows.push(row.join(','));
  }

  const csvContent = rows.join('\n');

  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="work-orders-backup-${new Date().toISOString().split('T')[0]}.csv"`
    }
  });
}

// POST /api/work-orders/import/csv - Import work orders from CSV (admin only)
export async function importWorkOrdersCSV(req: Request): Promise<Response> {
  // Require admin access + CSRF validation
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;
  if (authResult.role !== 'admin') {
    return Response.json({ message: 'Nemate pristup' }, { status: 403 });
  }
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const db = getDB();
  const formData = await req.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return Response.json({ message: 'Nema fajla za import' }, { status: 400 });
  }

  const csvText = await file.text();
  const lines = csvText.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    return Response.json({ message: 'CSV fajl je prazan ili nevalidan' }, { status: 400 });
  }

  // Parse headers
  const headers = lines[0]!.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  const results = {
    imported: 0,
    skipped: 0,
    errors: [] as string[]
  };

  // Start transaction
  db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      try {
        const line = lines[i]!;
        const values = parseCSVLine(line);

        if (values.length !== headers.length) {
          results.errors.push(`Red ${i + 1}: Nevalidan broj kolona`);
          continue;
        }

        const data: Record<string, string> = {};
        headers.forEach((header, index) => {
          data[header] = values[index] || '';
        });

        // Check if work order with this number already exists
        const existingOrder = db.query<{ id: number }, [string]>(
          'SELECT id FROM work_orders WHERE broj_naloga = ?'
        ).get(data.broj_naloga || '');

        if (existingOrder) {
          results.skipped++;
          continue;
        }

        // Create or find customer
        let customerId: number;
        const existingCustomer = db.query<{ id: number }, [string, string, string | null, string | null]>(
          'SELECT id FROM customers WHERE ime = ? AND prezime = ? AND (naziv_firme = ? OR (naziv_firme IS NULL AND ? IS NULL))'
        ).get(data.customer_ime || '', data.customer_prezime || '', data.customer_firma || null, data.customer_firma || null);

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const customerResult = db.query<{ id: number }, [string, string, string | null, string | null]>(
            'INSERT INTO customers (ime, prezime, naziv_firme, telefon) VALUES (?, ?, ?, ?) RETURNING id'
          ).get(data.customer_ime || '', data.customer_prezime || '', data.customer_firma || null, data.customer_telefon || null);
          customerId = customerResult!.id;
        }

        // Create or find mechanic if specified
        let mechanicId: number | null = null;
        if (data.mechanic_ime && data.mechanic_prezime) {
          const existingMechanic = db.query<{ id: number }, [string, string]>(
            'SELECT id FROM mechanics WHERE ime = ? AND prezime = ?'
          ).get(data.mechanic_ime, data.mechanic_prezime);

          if (existingMechanic) {
            mechanicId = existingMechanic.id;
          } else {
            const mechanicResult = db.query<{ id: number }, [string, string]>(
              'INSERT INTO mechanics (ime, prezime, aktivan) VALUES (?, ?, 1) RETURNING id'
            ).get(data.mechanic_ime, data.mechanic_prezime);
            mechanicId = mechanicResult!.id;
          }
        }

        // Create work order
        const workOrderResult = db.query<{ id: number }, [string, number, string, string | null, string, string, string | null, number | null, number | null, string | null, string | null, string, string, string | null]>(
          `INSERT INTO work_orders
           (broj_naloga, customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila, motor, kilometraza, mechanic_id, opis_kvara, napomena, status, created_at, closed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        ).get(
          data.broj_naloga || '',
          customerId,
          data.registarske_tablice || '',
          data.vin_broj || null,
          data.marka_vozila || '',
          data.model_vozila || '',
          data.motor || null,
          data.kilometraza ? parseInt(data.kilometraza) : null,
          mechanicId,
          data.opis_kvara || null,
          data.napomena || null,
          data.status || 'otvoren',
          data.created_at || new Date().toISOString(),
          data.closed_at || null
        );

        const workOrderId = workOrderResult!.id;

        // Add items if present
        if (data.items_json) {
          try {
            const items = JSON.parse(data.items_json);
            for (const item of items) {
              db.query<null, [number, string, string, number, number, number, number]>(
                'INSERT INTO work_order_items (work_order_id, tip, naziv, kolicina, jedinicna_cijena, popust, ukupna_cijena) VALUES (?, ?, ?, ?, ?, ?, ?)'
              ).run(workOrderId, item.tip, item.naziv, item.kolicina, item.jedinicna_cijena, item.popust ?? 0, item.ukupna_cijena);
            }
          } catch (e) {
            // Ignore items parsing errors
          }
        }

        // Add time entries if present
        if (data.time_entries_json) {
          try {
            const entries = JSON.parse(data.time_entries_json);
            for (const entry of entries) {
              // Find or create mechanic for time entry
              let entryMechanicId: number | null = mechanicId;
              if (entry.mechanic_ime && entry.mechanic_prezime) {
                const mech = db.query<{ id: number }, [string, string]>(
                  'SELECT id FROM mechanics WHERE ime = ? AND prezime = ?'
                ).get(entry.mechanic_ime, entry.mechanic_prezime);
                if (mech) {
                  entryMechanicId = mech.id;
                }
              }

              db.query<null, [number, number | null, string, string | null]>(
                'INSERT INTO time_entries (work_order_id, mechanic_id, started_at, ended_at) VALUES (?, ?, ?, ?)'
              ).run(workOrderId, entryMechanicId, entry.started_at, entry.ended_at || null);
            }
          } catch (e) {
            // Ignore time entries parsing errors
          }
        }

        // Recalculate total for the work order
        recalculateTotal(workOrderId);

        results.imported++;
      } catch (error) {
        results.errors.push(`Red ${i + 1}: ${error instanceof Error ? error.message : 'Greška'}`);
      }
    }
  })();

  return Response.json({
    message: `Import završen. Uvezeno: ${results.imported}, Preskočeno: ${results.skipped}`,
    ...results
  });
}

// Helper function to parse CSV line respecting quotes
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values.map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"'));
}
