import { getDB } from '../db';
import { requireAdmin } from './auth';
import type { SalesData, MechanicStats } from '../types';

// GET /api/analytics/sales - Sales by date range (admin only)
export function getSalesAnalytics(req: Request): Response {
  // Require admin access
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const tip = url.searchParams.get('tip'); // 'dio' or 'usluga'

  const db = getDB();

  let whereClause = 'WHERE 1=1';
  const params: string[] = [];

  if (from) {
    whereClause += ' AND DATE(wo.created_at) >= ?';
    params.push(from);
  }
  if (to) {
    whereClause += ' AND DATE(wo.created_at) <= ?';
    params.push(to);
  }
  if (tip) {
    whereClause += ' AND woi.tip = ?';
    params.push(tip);
  }

  const salesData = db.query<SalesData, string[]>(
    `SELECT
       DATE(wo.created_at) as datum,
       COALESCE(SUM(CASE WHEN woi.tip = 'dio' THEN woi.ukupna_cijena ELSE 0 END), 0) as ukupno_dijelovi,
       COALESCE(SUM(CASE WHEN woi.tip = 'usluga' THEN woi.ukupna_cijena ELSE 0 END), 0) as ukupno_usluge,
       COALESCE(SUM(woi.ukupna_cijena), 0) as ukupno,
       COUNT(DISTINCT wo.id) as broj_naloga
     FROM work_orders wo
     LEFT JOIN work_order_items woi ON wo.id = woi.work_order_id
     ${whereClause}
     GROUP BY DATE(wo.created_at)
     ORDER BY datum DESC`
  ).all(...params);

  return Response.json(salesData);
}

// GET /api/analytics/mechanics - Mechanic performance (admin only)
export function getMechanicAnalytics(req: Request): Response {
  // Require admin access
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const mechanicId = url.searchParams.get('mechanic_id');

  const db = getDB();

  let whereClause = 'WHERE wo.mechanic_id IS NOT NULL';
  const params: (string | number)[] = [];

  if (from) {
    whereClause += ' AND DATE(wo.created_at) >= ?';
    params.push(from);
  }
  if (to) {
    whereClause += ' AND DATE(wo.created_at) <= ?';
    params.push(to);
  }
  if (mechanicId) {
    whereClause += ' AND wo.mechanic_id = ?';
    params.push(parseInt(mechanicId));
  }

  const mechanicStats = db.query<MechanicStats, (string | number)[]>(
    `SELECT
       m.id as mechanic_id,
       m.ime,
       m.prezime,
       COUNT(DISTINCT wo.id) as broj_naloga,
       COALESCE(SUM(woi.ukupna_cijena), 0) as ukupna_zarada,
       COALESCE(SUM(CASE WHEN woi.tip = 'dio' THEN woi.ukupna_cijena ELSE 0 END), 0) as dijelovi,
       COALESCE(SUM(CASE WHEN woi.tip = 'usluga' THEN woi.ukupna_cijena ELSE 0 END), 0) as usluge
     FROM mechanics m
     LEFT JOIN work_orders wo ON m.id = wo.mechanic_id ${from || to ? `AND DATE(wo.created_at) >= ? ${to ? 'AND DATE(wo.created_at) <= ?' : ''}` : ''}
     LEFT JOIN work_order_items woi ON wo.id = woi.work_order_id
     WHERE m.aktivan = 1 ${mechanicId ? 'AND m.id = ?' : ''}
     GROUP BY m.id
     ORDER BY ukupna_zarada DESC`
  ).all(...(mechanicId ? [mechanicId] : []));

  return Response.json(mechanicStats);
}

// Alternative simpler mechanic analytics (admin only)
export function getMechanicStats(req: Request): Response {
  // Require admin access
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const db = getDB();

  let dateFilter = '';
  const params: string[] = [];

  if (from) {
    dateFilter += ' AND DATE(wo.created_at) >= ?';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND DATE(wo.created_at) <= ?';
    params.push(to);
  }

  const stats = db.query<MechanicStats, string[]>(
    `SELECT
       m.id as mechanic_id,
       m.ime,
       m.prezime,
       COUNT(DISTINCT wo.id) as broj_naloga,
       COALESCE(SUM(wo.ukupna_cijena), 0) as ukupna_zarada,
       COALESCE((SELECT SUM(woi.ukupna_cijena) FROM work_order_items woi
                 JOIN work_orders wo2 ON woi.work_order_id = wo2.id
                 WHERE wo2.mechanic_id = m.id AND woi.tip = 'dio' ${dateFilter.replace(/wo\./g, 'wo2.')}), 0) as dijelovi,
       COALESCE((SELECT SUM(woi.ukupna_cijena) FROM work_order_items woi
                 JOIN work_orders wo2 ON woi.work_order_id = wo2.id
                 WHERE wo2.mechanic_id = m.id AND woi.tip = 'usluga' ${dateFilter.replace(/wo\./g, 'wo2.')}), 0) as usluge
     FROM mechanics m
     LEFT JOIN work_orders wo ON m.id = wo.mechanic_id ${dateFilter}
     WHERE m.aktivan = 1
     GROUP BY m.id
     ORDER BY ukupna_zarada DESC`
  ).all(...params, ...params, ...params);

  return Response.json(stats);
}

// GET /api/analytics/summary - Quick summary stats (admin only)
export function getAnalyticsSummary(req: Request): Response {
  // Require admin access
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const db = getDB();

  let dateFilter = '';
  const params: string[] = [];

  if (from) {
    dateFilter += ' AND DATE(created_at) >= ?';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND DATE(created_at) <= ?';
    params.push(to);
  }

  const summary = db.query<{
    total_work_orders: number;
    total_revenue: number;
    total_parts: number;
    total_services: number;
  }, string[]>(
    `SELECT
       COUNT(*) as total_work_orders,
       COALESCE(SUM(ukupna_cijena), 0) as total_revenue,
       COALESCE((SELECT SUM(ukupna_cijena) FROM work_order_items WHERE tip = 'dio'), 0) as total_parts,
       COALESCE((SELECT SUM(ukupna_cijena) FROM work_order_items WHERE tip = 'usluga'), 0) as total_services
     FROM work_orders
     WHERE 1=1 ${dateFilter}`
  ).get(...params);

  return Response.json(summary);
}
