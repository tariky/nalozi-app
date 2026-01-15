import { getDB } from '../db';
import type { TimeEntry, Mechanic } from '../types';

// GET /api/work-orders/:id/time-entries - Get all time entries for a work order
export function getTimeEntries(req: Request): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const workOrderId = parseInt(pathParts[pathParts.indexOf('work-orders') + 1] || '0');

  const db = getDB();
  const entries = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE work_order_id = ? ORDER BY started_at DESC'
  ).all(workOrderId);

  // Add mechanic info
  for (const entry of entries) {
    if (entry.mechanic_id) {
      entry.mechanic = db.query<Mechanic, [number]>(
        'SELECT * FROM mechanics WHERE id = ?'
      ).get(entry.mechanic_id) || undefined;
    }
  }

  return Response.json(entries);
}

// POST /api/work-orders/:id/time-entries/start - Start a new time entry
export async function startTimeEntry(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const workOrderId = parseInt(pathParts[pathParts.indexOf('work-orders') + 1] || '0');

  const data = await req.json();
  const mechanicId = data.mechanic_id || null;

  const db = getDB();

  // Check if there's already an active (unended) time entry for this work order
  const activeEntry = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE work_order_id = ? AND ended_at IS NULL'
  ).get(workOrderId);

  if (activeEntry) {
    return Response.json({
      message: 'Već postoji aktivno praćenje vremena za ovaj nalog'
    }, { status: 400 });
  }

  const startedAt = new Date().toISOString();

  const result = db.query<{ id: number }, [number, number | null, string]>(
    'INSERT INTO time_entries (work_order_id, mechanic_id, started_at) VALUES (?, ?, ?) RETURNING id'
  ).get(workOrderId, mechanicId, startedAt);

  const entry = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE id = ?'
  ).get(result!.id);

  // Update work order status to "u_toku" if it's "otvoren"
  db.query<null, [number]>(
    "UPDATE work_orders SET status = 'u_toku' WHERE id = ? AND status = 'otvoren'"
  ).run(workOrderId);

  return Response.json(entry, { status: 201 });
}

// POST /api/work-orders/:id/time-entries/stop - Stop the active time entry
export function stopTimeEntry(req: Request): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const workOrderId = parseInt(pathParts[pathParts.indexOf('work-orders') + 1] || '0');

  const db = getDB();

  // Find active entry
  const activeEntry = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE work_order_id = ? AND ended_at IS NULL'
  ).get(workOrderId);

  if (!activeEntry) {
    return Response.json({
      message: 'Nema aktivnog praćenja vremena za ovaj nalog'
    }, { status: 400 });
  }

  const endedAt = new Date().toISOString();

  db.query<null, [string, number]>(
    'UPDATE time_entries SET ended_at = ? WHERE id = ?'
  ).run(endedAt, activeEntry.id);

  const entry = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE id = ?'
  ).get(activeEntry.id);

  return Response.json(entry);
}

// DELETE /api/work-orders/:orderId/time-entries/:entryId - Delete a time entry
export function deleteTimeEntry(req: Request): Response {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const entryId = parseInt(pathParts[pathParts.length - 1] || '0');

  const db = getDB();

  const existing = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE id = ?'
  ).get(entryId);

  if (!existing) {
    return Response.json({ message: 'Vrijeme nije pronađeno' }, { status: 404 });
  }

  db.query<null, [number]>('DELETE FROM time_entries WHERE id = ?').run(entryId);

  return Response.json({ success: true });
}

// Helper: Calculate total time in minutes for a work order
export function calculateTotalTime(workOrderId: number): number {
  const db = getDB();
  const entries = db.query<TimeEntry, [number]>(
    'SELECT * FROM time_entries WHERE work_order_id = ?'
  ).all(workOrderId);

  let totalMs = 0;
  for (const entry of entries) {
    const start = new Date(entry.started_at).getTime();
    const end = entry.ended_at ? new Date(entry.ended_at).getTime() : Date.now();
    totalMs += end - start;
  }

  return Math.floor(totalMs / (1000 * 60));
}
