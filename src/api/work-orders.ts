import { getDB, generateWorkOrderNumber } from '../db';
import { getCurrentUser } from './auth';
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
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const status = url.searchParams.get('status');
  const offset = (page - 1) * limit;

  // Get current user to check role
  const currentUser = getCurrentUser(req);

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
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || '';

  if (!query || query.length < 2) {
    return Response.json([]);
  }

  // Get current user to check role
  const currentUser = getCurrentUser(req);

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
  const url = new URL(req.url);
  const customerId = parseInt(url.pathname.split('/').pop() || '0');

  const db = getDB();

  const workOrders = db.query<WorkOrder, [number]>(
    `SELECT * FROM work_orders WHERE customer_id = ? ORDER BY created_at DESC`
  ).all(customerId);

  return Response.json(workOrders);
}

// GET /api/work-orders/:id - Get single with items
export function getWorkOrderById(req: Request): Response {
  const url = new URL(req.url);
  const id = parseInt(url.pathname.split('/').pop() || '0');

  const workOrder = getWorkOrderWithDetails(id);

  if (!workOrder) {
    return Response.json({ message: 'Radni nalog nije pronađen' }, { status: 404 });
  }

  // Check if mechanic can view this work order
  const currentUser = getCurrentUser(req);
  if (currentUser && currentUser.role === 'mechanic' && currentUser.mechanic_id) {
    if (workOrder.mechanic_id !== currentUser.mechanic_id) {
      return Response.json({ message: 'Nemate pristup ovom radnom nalogu' }, { status: 403 });
    }
  }

  return Response.json(workOrder);
}

// POST /api/work-orders - Create work order
export async function createWorkOrder(req: Request): Promise<Response> {
  const data: WorkOrderForm = await req.json();

  if (!data.customer_id || !data.registarske_tablice || !data.marka_vozila || !data.model_vozila) {
    return Response.json({
      message: 'Klijent, registarske tablice, marka i model vozila su obavezni'
    }, { status: 400 });
  }

  const db = getDB();
  const brojNaloga = generateWorkOrderNumber();
  const createdAt = new Date().toISOString();

  const result = db.query<{ id: number }, [string, number, string, string | null, string, string, string | null, number | null, string | null, string, string]>(
    `INSERT INTO work_orders
     (broj_naloga, customer_id, registarske_tablice, vin_broj, marka_vozila, model_vozila, motor, mechanic_id, napomena, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(
    brojNaloga,
    data.customer_id,
    data.registarske_tablice,
    data.vin_broj || null,
    data.marka_vozila,
    data.model_vozila,
    data.motor || null,
    data.mechanic_id || null,
    data.napomena || null,
    data.status || 'otvoren',
    createdAt
  );

  const workOrder = getWorkOrderWithDetails(result!.id);
  return Response.json(workOrder, { status: 201 });
}

// PUT /api/work-orders/:id - Update work order
export async function updateWorkOrder(req: Request): Promise<Response> {
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
  if (data.mechanic_id !== undefined) {
    updates.push('mechanic_id = ?');
    values.push(data.mechanic_id || null);
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
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const workOrderId = parseInt(pathParts[pathParts.length - 2]);
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

  const kolicina = data.kolicina || 1;
  const ukupnaCijena = kolicina * data.jedinicna_cijena;

  const result = db.query<{ id: number }, [number, string, string, number, number, number]>(
    `INSERT INTO work_order_items (work_order_id, tip, naziv, kolicina, jedinicna_cijena, ukupna_cijena)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(workOrderId, data.tip, data.naziv, kolicina, data.jedinicna_cijena, ukupnaCijena);

  // Recalculate total
  recalculateTotal(workOrderId);

  const item = db.query<WorkOrderItem, [number]>(
    'SELECT * FROM work_order_items WHERE id = ?'
  ).get(result!.id);

  return Response.json(item, { status: 201 });
}

// PUT /api/work-orders/:orderId/items/:itemId - Update item
export async function updateWorkOrderItem(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const itemId = parseInt(pathParts[pathParts.length - 1]);
  const workOrderId = parseInt(pathParts[pathParts.length - 3]);
  const data: WorkOrderItemForm = await req.json();

  const db = getDB();

  // Check if item exists
  const existing = db.query<WorkOrderItem, [number, number]>(
    'SELECT * FROM work_order_items WHERE id = ? AND work_order_id = ?'
  ).get(itemId, workOrderId);

  if (!existing) {
    return Response.json({ message: 'Stavka nije pronađena' }, { status: 404 });
  }

  const kolicina = data.kolicina || existing.kolicina;
  const jedinicnaCijena = data.jedinicna_cijena ?? existing.jedinicna_cijena;
  const ukupnaCijena = kolicina * jedinicnaCijena;

  db.query<null, [string, string, number, number, number, number]>(
    `UPDATE work_order_items SET tip = ?, naziv = ?, kolicina = ?, jedinicna_cijena = ?, ukupna_cijena = ?
     WHERE id = ?`
  ).run(data.tip || existing.tip, data.naziv || existing.naziv, kolicina, jedinicnaCijena, ukupnaCijena, itemId);

  // Recalculate total
  recalculateTotal(workOrderId);

  const item = db.query<WorkOrderItem, [number]>(
    'SELECT * FROM work_order_items WHERE id = ?'
  ).get(itemId);

  return Response.json(item);
}

// DELETE /api/work-orders/:orderId/items/:itemId - Delete item
export function deleteWorkOrderItem(req: Request): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const itemId = parseInt(pathParts[pathParts.length - 1]);
  const workOrderId = parseInt(pathParts[pathParts.length - 3]);

  const db = getDB();

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
