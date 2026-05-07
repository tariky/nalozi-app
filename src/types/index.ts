// TypeScript interfaces for the application

export interface Mechanic {
  id: number;
  ime: string;
  prezime: string;
  telefon: string | null;
  aktivan: number;
  created_at: string;
}

export interface Customer {
  id: number;
  naziv_firme: string | null;
  ime: string;
  prezime: string;
  telefon: string | null;
  email: string | null;
  created_at: string;
}

export interface Vehicle {
  id: number;
  customer_id: number;
  registarske_tablice: string;
  vin_broj: string | null;
  marka_vozila: string;
  model_vozila: string;
  motor: string | null;
  created_at: string;
}

export type TipNaloga = 'auto' | 'agregat';
export type TipAgregata = 'alnaser' | 'alternator' | 'klima_kompresor' | 'elektricni_uredjaj' | 'ostalo';

export interface WorkOrder {
  id: number;
  broj_naloga: string;
  customer_id: number;
  tip_naloga: TipNaloga;
  // Auto fields ('' for agregat orders, real values for auto)
  registarske_tablice: string;
  marka_vozila: string;
  model_vozila: string;
  vin_broj: string | null;
  motor: string | null;
  kilometraza: number | null;
  // Agregat fields (null for auto orders)
  tip_agregata: TipAgregata | null;
  marka_agregata: string | null;
  model_agregata: string | null;
  serijski_broj: string | null;
  // Common
  mechanic_id: number | null;
  opis_kvara: string | null;
  napomena: string | null;
  status: 'otvoren' | 'u_toku' | 'zavrsen';
  ukupna_cijena: number;
  created_at: string;
  closed_at: string | null;
  // Joined data
  customer?: Customer;
  mechanic?: Mechanic;
  items?: WorkOrderItem[];
  time_entries?: TimeEntry[];
}

export interface TimeEntry {
  id: number;
  work_order_id: number;
  mechanic_id: number | null;
  started_at: string;
  ended_at: string | null;
  // Computed
  mechanic?: Mechanic;
}

export interface WorkOrderItem {
  id: number;
  work_order_id: number;
  tip: 'dio' | 'usluga';
  naziv: string;
  kolicina: number;
  jedinicna_cijena: number;
  popust: number;
  ukupna_cijena: number;
  created_at: string;
}

// Form types (without id and created_at)
export interface MechanicForm {
  ime: string;
  prezime: string;
  telefon?: string;
}

export interface CustomerForm {
  naziv_firme?: string;
  ime: string;
  prezime: string;
  telefon?: string;
  email?: string;
}

export interface VehicleForm {
  customer_id: number;
  registarske_tablice: string;
  vin_broj?: string;
  marka_vozila: string;
  model_vozila: string;
  motor?: string;
}

export type WorkOrderFormAuto = {
  tip_naloga: 'auto';
  customer_id: number;
  registarske_tablice: string;
  vin_broj?: string;
  marka_vozila: string;
  model_vozila: string;
  motor?: string;
  kilometraza?: number;
  mechanic_id?: number;
  opis_kvara?: string;
  napomena?: string;
  status?: 'otvoren' | 'u_toku' | 'zavrsen';
};

export type WorkOrderFormAgregat = {
  tip_naloga: 'agregat';
  customer_id: number;
  tip_agregata: TipAgregata;
  marka_agregata: string;
  model_agregata?: string;
  serijski_broj?: string;
  mechanic_id?: number;
  opis_kvara?: string;
  napomena?: string;
  status?: 'otvoren' | 'u_toku' | 'zavrsen';
};

export type WorkOrderForm = WorkOrderFormAuto | WorkOrderFormAgregat;

export interface WorkOrderItemForm {
  tip: 'dio' | 'usluga';
  naziv: string;
  kolicina: number;
  jedinicna_cijena: number;
  popust?: number;
}

// Auth types
export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'mechanic';
  mechanic_id: number | null;
  created_at: string;
  // Joined data
  mechanic?: Mechanic;
}

export interface Session {
  id: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface UserForm {
  username: string;
  password: string;
  role: 'admin' | 'mechanic';
  mechanic_id?: number;
}

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'mechanic';
  mechanic_id: number | null;
  mechanic?: Mechanic;
}

// Analytics types
export interface SalesData {
  datum: string;
  ukupno_dijelovi: number;
  ukupno_usluge: number;
  ukupno: number;
  broj_naloga: number;
}

export interface MechanicStats {
  mechanic_id: number;
  ime: string;
  prezime: string;
  broj_naloga: number;
  ukupna_zarada: number;
  dijelovi: number;
  usluge: number;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Invoice OCR types
export interface ParsedInvoiceItem {
  naziv: string;
  kolicina: number;
  jedinicna_cijena: number;
  popust: number;
}

export interface ScanInvoiceResponse {
  items: ParsedInvoiceItem[];
  warnings: string[];
}

export interface BulkItemsRequest {
  items: WorkOrderItemForm[];
}
