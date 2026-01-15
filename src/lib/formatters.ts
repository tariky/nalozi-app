// Formatters for currency and dates

// Format number as KM currency (Bosnian format: 1.234,56 KM)
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('bs-BA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' KM';
}

// Format date for display (DD.MM.YYYY)
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

// Format datetime for display (DD.MM.YYYY HH:mm)
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

// Format date for input fields (YYYY-MM-DD)
export function formatDateForInput(dateString: string): string {
  const date = new Date(dateString);
  return date.toISOString().split('T')[0] ?? '';
}

// Parse currency input (handles both comma and dot)
export function parseCurrencyInput(value: string): number {
  // Replace comma with dot for parsing
  const normalized = value.replace(',', '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

// Get status label in Bosnian
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    otvoren: 'Otvoren',
    u_toku: 'U toku',
    zavrsen: 'Završen',
  };
  return labels[status] || status;
}

// Get status color class
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    otvoren: 'bg-blue-100 text-blue-800',
    u_toku: 'bg-yellow-100 text-yellow-800',
    zavrsen: 'bg-green-100 text-green-800',
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
}

// Get item type label in Bosnian
export function getItemTypeLabel(tip: string): string {
  return tip === 'dio' ? 'Dio' : 'Usluga';
}

// Format duration between two dates (rounded up to 15-minute billing intervals)
export function formatDuration(startDate: string, endDate: string | null): string {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();

  const diffMs = end.getTime() - start.getTime();
  const exactMinutes = diffMs / (1000 * 60);

  // Round up to nearest 15-minute interval for billing
  const billingMinutes = Math.ceil(exactMinutes / 15) * 15;

  const totalHours = Math.floor(billingMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = billingMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}
