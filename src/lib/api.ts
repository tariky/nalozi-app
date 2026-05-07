// API client functions

import type {
  Mechanic,
  MechanicForm,
  Customer,
  CustomerForm,
  Vehicle,
  VehicleForm,
  WorkOrder,
  WorkOrderForm,
  WorkOrderItem,
  WorkOrderItemForm,
  TimeEntry,
  ApiResponse,
  PaginatedResponse,
  SalesData,
  MechanicStats,
  AuthUser,
  UserForm,
  ScanInvoiceResponse,
} from '../types';

const API_BASE = '/api';

// CSRF token storage
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const method = options?.method?.toUpperCase() || 'GET';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add CSRF token for state-changing requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers || {}),
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Greška na serveru' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: 'Greška u komunikaciji sa serverom' };
  }
}

// Mechanics API
export const mechanicsApi = {
  getAll: () => fetchApi<Mechanic[]>('/mechanics'),

  getById: (id: number) => fetchApi<Mechanic>(`/mechanics/${id}`),

  create: (data: MechanicForm) =>
    fetchApi<Mechanic>('/mechanics', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: MechanicForm) =>
    fetchApi<Mechanic>(`/mechanics/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    fetchApi<void>(`/mechanics/${id}`, { method: 'DELETE' }),
};

// Customers API
export const customersApi = {
  getAll: (page = 1, limit = 20, search?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    return fetchApi<PaginatedResponse<Customer>>(`/customers?${params}`);
  },

  getById: (id: number) => fetchApi<Customer>(`/customers/${id}`),

  create: (data: CustomerForm) =>
    fetchApi<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: CustomerForm) =>
    fetchApi<Customer>(`/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// Vehicles API
export const vehiclesApi = {
  getByCustomer: (customerId: number) =>
    fetchApi<Vehicle[]>(`/vehicles/by-customer/${customerId}`),

  getById: (id: number) => fetchApi<Vehicle>(`/vehicles/${id}`),

  checkVin: (vin: string) =>
    fetchApi<{ exists: boolean; vehicle?: Vehicle & { customer?: { id: number; ime: string; prezime: string } } }>(`/vehicles/check-vin/${encodeURIComponent(vin)}`),

  create: (data: VehicleForm) =>
    fetchApi<Vehicle>('/vehicles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: Partial<VehicleForm>) =>
    fetchApi<Vehicle>(`/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    fetchApi<void>(`/vehicles/${id}`, { method: 'DELETE' }),
};

// Work Orders API
export const workOrdersApi = {
  getAll: (page = 1, limit = 20, filters?: { status?: string; tip_naloga?: 'auto' | 'agregat' }) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters?.status) params.set('status', filters.status);
    if (filters?.tip_naloga) params.set('tip_naloga', filters.tip_naloga);
    return fetchApi<PaginatedResponse<WorkOrder>>(`/work-orders?${params}`);
  },

  getById: (id: number) => fetchApi<WorkOrder>(`/work-orders/${id}`),

  create: (data: WorkOrderForm) =>
    fetchApi<WorkOrder>('/work-orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: Partial<WorkOrderForm>) =>
    fetchApi<WorkOrder>(`/work-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    fetchApi<void>(`/work-orders/${id}`, { method: 'DELETE' }),

  search: (query: string) =>
    fetchApi<WorkOrder[]>(`/work-orders/search?q=${encodeURIComponent(query)}`),

  exportCSV: async () => {
    try {
      const response = await fetch(`${API_BASE}/work-orders/export/csv`);
      if (!response.ok) {
        return { success: false as const, error: 'Greška pri izvozu' };
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const contentDisposition = response.headers.get('content-disposition');
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'work-orders.csv';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      return { success: true as const, data: undefined };
    } catch (error) {
      return { success: false as const, error: 'Greška pri preuzimanju CSV fajla' };
    }
  },

  importCSV: async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE}/work-orders/import/csv`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        return { success: false as const, error: error.message || 'Greška pri importu' };
      }
      const data = await response.json();
      return { success: true as const, data };
    } catch (error) {
      return { success: false as const, error: 'Greška pri komunikaciji sa serverom' };
    }
  },
};

// Work Order Items API
export const workOrderItemsApi = {
  add: (workOrderId: number, data: WorkOrderItemForm) =>
    fetchApi<WorkOrderItem>(`/work-orders/${workOrderId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (workOrderId: number, itemId: number, data: WorkOrderItemForm) =>
    fetchApi<WorkOrderItem>(`/work-orders/${workOrderId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (workOrderId: number, itemId: number) =>
    fetchApi<void>(`/work-orders/${workOrderId}/items/${itemId}`, {
      method: 'DELETE',
    }),

  addBulk: (workOrderId: number, items: WorkOrderItemForm[]) =>
    fetchApi<WorkOrder>(`/work-orders/${workOrderId}/items/bulk`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
};

// Invoice Scan API (multipart upload — bypasses fetchApi to send FormData with CSRF)
export const invoiceScanApi = {
  scan: async (file: File): Promise<{ success: true; data: ScanInvoiceResponse } | { success: false; error: string }> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch(`${API_BASE}/work-orders/scan-invoice`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Greška na serveru' }));
        return { success: false, error: error.message || 'Greška na serveru' };
      }

      const data = await response.json() as ScanInvoiceResponse;
      return { success: true, data };
    } catch {
      return { success: false, error: 'Greška u komunikaciji sa serverom' };
    }
  },
};

// Time Entries API
export const timeEntriesApi = {
  getByWorkOrder: (workOrderId: number) =>
    fetchApi<TimeEntry[]>(`/work-orders/${workOrderId}/time-entries`),

  start: (workOrderId: number, mechanicId?: number) =>
    fetchApi<TimeEntry>(`/work-orders/${workOrderId}/time-entries/start`, {
      method: 'POST',
      body: JSON.stringify({ mechanic_id: mechanicId }),
    }),

  stop: (workOrderId: number) =>
    fetchApi<TimeEntry>(`/work-orders/${workOrderId}/time-entries/stop`, {
      method: 'POST',
    }),

  delete: (workOrderId: number, entryId: number) =>
    fetchApi<void>(`/work-orders/${workOrderId}/time-entries/${entryId}`, {
      method: 'DELETE',
    }),
};

// Analytics API
export const analyticsApi = {
  getSales: (from?: string, to?: string, tip?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (tip) params.set('tip', tip);
    return fetchApi<SalesData[]>(`/analytics/sales?${params}`);
  },

  getMechanicStats: (from?: string, to?: string, mechanicId?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (mechanicId) params.set('mechanic_id', String(mechanicId));
    return fetchApi<MechanicStats[]>(`/analytics/mechanics?${params}`);
  },
};

// Auth API
export const authApi = {
  login: (username: string, password: string) =>
    fetchApi<AuthUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    fetchApi<void>('/auth/logout', { method: 'POST' }),

  me: () => fetchApi<AuthUser>('/auth/me'),
};

// Users API
export const usersApi = {
  getAll: () => fetchApi<AuthUser[]>('/users'),

  create: (data: UserForm) =>
    fetchApi<AuthUser>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    fetchApi<void>(`/users/${id}`, { method: 'DELETE' }),

  changePassword: (id: number, password: string) =>
    fetchApi<void>(`/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    }),
};
