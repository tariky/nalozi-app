import { useState, useEffect } from "react";
import { Plus, Eye, Pencil, FileDown, ChevronLeft, ChevronRight, Clock, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, PageHeader } from "@/components/layout/PageContainer";
import { WorkOrderSearch } from "./WorkOrderSearch";
import { SalesOverview } from "@/components/analytics/SalesOverview";
import { RegistrationScanDialog } from "@/components/vehicles/RegistrationScanDialog";
import { workOrdersApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, formatCurrency, getStatusLabel, getStatusColor, formatDuration, getTipNalogaLabel, getTipAgregataLabel } from "@/lib/formatters";
import type { WorkOrder, PaginatedResponse, Vehicle } from "@/types";

interface WorkOrderListProps {
  onNewAuto: () => void;
  onNewAgregat: () => void;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onPrintPDF: (workOrder: WorkOrder) => void;
  onScanned: (customerId: number, vehicle: Vehicle) => void;
}

// Cache work orders to prevent flicker on navigation
interface CacheEntry {
  data: PaginatedResponse<WorkOrder>;
  page: number;
  statusFilter: string;
  tipFilter: 'all' | 'auto' | 'agregat';
  timestamp: number;
}
let workOrdersCache: CacheEntry | null = null;
const CACHE_TTL = 30000; // 30 seconds

// Export function to invalidate cache from other components
export function invalidateWorkOrdersCache() {
  workOrdersCache = null;
}

export function WorkOrderList({ onNewAuto, onNewAgregat, onView, onEdit, onPrintPDF, onScanned }: WorkOrderListProps) {
  const { isAdmin } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tipFilter, setTipFilter] = useState<'all' | 'auto' | 'agregat'>('all');
  const [scanOpen, setScanOpen] = useState(false);

  // Initialize from cache if valid
  const getCachedData = () => {
    if (
      workOrdersCache &&
      workOrdersCache.page === page &&
      workOrdersCache.statusFilter === statusFilter &&
      workOrdersCache.tipFilter === tipFilter &&
      Date.now() - workOrdersCache.timestamp < CACHE_TTL
    ) {
      return workOrdersCache.data;
    }
    return null;
  };

  const [data, setData] = useState<PaginatedResponse<WorkOrder> | null>(getCachedData);
  const [loading, setLoading] = useState(!getCachedData());

  const loadWorkOrders = async (showLoading = true) => {
    if (showLoading && !data) setLoading(true);
    const filters: { status?: string; tip_naloga?: 'auto' | 'agregat' } = {};
    if (statusFilter !== 'all') filters.status = statusFilter;
    if (tipFilter !== 'all') filters.tip_naloga = tipFilter;
    const result = await workOrdersApi.getAll(page, 20, Object.keys(filters).length > 0 ? filters : undefined);
    if (result.success && result.data) {
      workOrdersCache = {
        data: result.data,
        page,
        statusFilter,
        tipFilter,
        timestamp: Date.now(),
      };
      setData(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    const cached = getCachedData();
    if (cached) {
      setData(cached);
      setLoading(false);
      // Refresh in background
      loadWorkOrders(false);
    } else {
      loadWorkOrders(true);
    }
  }, [page, statusFilter, tipFilter]);

  const handleDelete = async (id: number) => {
    if (confirm("Da li ste sigurni da želite obrisati ovaj radni nalog?")) {
      await workOrdersApi.delete(id);
      workOrdersCache = null; // Invalidate cache
      loadWorkOrders(true);
    }
  };

  const handleSearchSelect = (workOrder: WorkOrder) => {
    onView(workOrder.id);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Radni nalozi"
        description="Upravljajte radnim nalozima auto servisa"
        action={
          <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:w-auto">
            <Button onClick={() => setScanOpen(true)} size="sm" variant="outline" className="w-full sm:w-auto">
              <ScanLine className="h-4 w-4 mr-2" />
              Skeniraj saobraćajnu
            </Button>
            <Button onClick={onNewAuto} size="sm" className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-1" />
              <span className="truncate">Auto nalog</span>
            </Button>
            <Button onClick={onNewAgregat} size="sm" variant="outline" className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-1" />
              <span className="truncate">Agregat nalog</span>
            </Button>
          </div>
        }
      />

      {/* Admin Sales Overview */}
      {isAdmin && <SalesOverview />}

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <WorkOrderSearch onSelect={handleSearchSelect} />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="flex-1 sm:w-40 sm:flex-initial">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Svi statusi</SelectItem>
              <SelectItem value="otvoren">Otvoreni</SelectItem>
              <SelectItem value="u_toku">U toku</SelectItem>
              <SelectItem value="zavrsen">Završeni</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tipFilter} onValueChange={(v) => setTipFilter(v as 'all' | 'auto' | 'agregat')}>
            <SelectTrigger className="flex-1 sm:w-32 sm:flex-initial">
              <SelectValue placeholder="Tip" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Svi tipovi</SelectItem>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="agregat">Agregat</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <Card padding="none">
        {loading ? (
          <div className="p-4 sm:p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <p className="text-muted-foreground mb-4">Nema radnih naloga</p>
            <Button onClick={onNewAuto} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Kreiraj prvi nalog
            </Button>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Broj naloga</TableHead>
                    <TableHead>Tip</TableHead>
                    <TableHead>Klijent</TableHead>
                    <TableHead>Vozilo</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Iznos</TableHead>
                    <TableHead className="w-28">Akcije</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((wo) => (
                    <TableRow key={wo.id} className="cursor-pointer">
                      <TableCell
                        className="font-medium"
                        onClick={() => onView(wo.id)}
                      >
                        {wo.broj_naloga}
                      </TableCell>
                      <TableCell onClick={() => onView(wo.id)}>
                        <Badge variant="outline" className={wo.tip_naloga === 'agregat' ? 'border-orange-500 text-orange-600' : 'border-blue-500 text-blue-600'}>
                          {getTipNalogaLabel(wo.tip_naloga)}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={() => onView(wo.id)}>
                        <div className="font-medium">
                          {wo.customer?.ime} {wo.customer?.prezime}
                        </div>
                        {wo.customer?.naziv_firme && (
                          <div className="text-sm text-muted-foreground">
                            {wo.customer.naziv_firme}
                          </div>
                        )}
                      </TableCell>
                      <TableCell onClick={() => onView(wo.id)}>
                        {wo.tip_naloga === 'agregat' ? (
                          <>
                            <div>{getTipAgregataLabel(wo.tip_agregata)}</div>
                            {wo.marka_agregata && (
                              <div className="text-sm text-muted-foreground">{wo.marka_agregata}</div>
                            )}
                          </>
                        ) : (
                          <>
                            <div>{wo.marka_vozila} {wo.model_vozila}</div>
                            <div className="text-sm text-muted-foreground font-mono">
                              {wo.registarske_tablice}
                            </div>
                          </>
                        )}
                      </TableCell>
                      <TableCell onClick={() => onView(wo.id)}>
                        {formatDate(wo.created_at)}
                      </TableCell>
                      <TableCell onClick={() => onView(wo.id)}>
                        <Badge className={getStatusColor(wo.status)}>
                          {getStatusLabel(wo.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium" onClick={() => onView(wo.id)}>
                        {formatCurrency(wo.ukupna_cijena)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => onView(wo.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => onEdit(wo.id)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => onPrintPDF(wo)}>
                            <FileDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile/Tablet Cards */}
            <div className="lg:hidden divide-y divide-border">
              {data.items.map((wo) => (
                <div
                  key={wo.id}
                  className="p-4 active:bg-muted/50"
                  onClick={() => onView(wo.id)}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">{wo.broj_naloga}</div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatDate(wo.created_at)}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(wo.created_at, wo.closed_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className={wo.tip_naloga === 'agregat' ? 'border-orange-500 text-orange-600' : 'border-blue-500 text-blue-600'}>
                        {getTipNalogaLabel(wo.tip_naloga)}
                      </Badge>
                      <Badge className={getStatusColor(wo.status)}>
                        {getStatusLabel(wo.status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-sm font-medium text-foreground mb-1">
                    {wo.customer?.ime} {wo.customer?.prezime}
                    {wo.customer?.naziv_firme && (
                      <span className="text-muted-foreground font-normal"> • {wo.customer.naziv_firme}</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mb-2">
                    {wo.tip_naloga === 'agregat' ? (
                      <span>{getTipAgregataLabel(wo.tip_agregata)}{wo.marka_agregata ? ' · ' + wo.marka_agregata : ''}</span>
                    ) : (
                      <span>{wo.marka_vozila} {wo.model_vozila}{wo.registarske_tablice ? ' · ' + wo.registarske_tablice : ''}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-foreground">
                      {formatCurrency(wo.ukupna_cijena)}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={(e) => { e.stopPropagation(); onEdit(wo.id); }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={(e) => { e.stopPropagation(); onPrintPDF(wo); }}
                      >
                        <FileDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <div className="text-xs sm:text-sm text-muted-foreground">
                  Str. {data.page}/{data.totalPages} ({data.total})
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page === data.totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <RegistrationScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResolved={onScanned}
      />
    </div>
  );
}
