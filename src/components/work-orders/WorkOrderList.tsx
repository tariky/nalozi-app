import { useState, useEffect } from "react";
import { Plus, Eye, Pencil, FileDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
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
import { workOrdersApi } from "@/lib/api";
import { formatDate, formatCurrency, getStatusLabel, getStatusColor, formatDuration } from "@/lib/formatters";
import type { WorkOrder, PaginatedResponse } from "@/types";

interface WorkOrderListProps {
  onNew: () => void;
  onView: (id: number) => void;
  onEdit: (id: number) => void;
  onPrintPDF: (workOrder: WorkOrder) => void;
}

export function WorkOrderList({ onNew, onView, onEdit, onPrintPDF }: WorkOrderListProps) {
  const [data, setData] = useState<PaginatedResponse<WorkOrder> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const loadWorkOrders = async () => {
    setLoading(true);
    const filters = statusFilter !== "all" ? { status: statusFilter } : undefined;
    const result = await workOrdersApi.getAll(page, 20, filters);
    if (result.success && result.data) {
      setData(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadWorkOrders();
  }, [page, statusFilter]);

  const handleDelete = async (id: number) => {
    if (confirm("Da li ste sigurni da želite obrisati ovaj radni nalog?")) {
      await workOrdersApi.delete(id);
      loadWorkOrders();
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
          <Button onClick={onNew} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Novi nalog
          </Button>
        }
      />

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <WorkOrderSearch onSelect={handleSearchSelect} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Svi statusi</SelectItem>
            <SelectItem value="otvoren">Otvoreni</SelectItem>
            <SelectItem value="u_toku">U toku</SelectItem>
            <SelectItem value="zavrsen">Završeni</SelectItem>
          </SelectContent>
        </Select>
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
            <p className="text-gray-500 mb-4">Nema radnih naloga</p>
            <Button onClick={onNew} variant="outline">
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
                    <TableRow key={wo.id} className="cursor-pointer hover:bg-gray-50">
                      <TableCell
                        className="font-medium"
                        onClick={() => onView(wo.id)}
                      >
                        {wo.broj_naloga}
                      </TableCell>
                      <TableCell onClick={() => onView(wo.id)}>
                        <div className="font-medium">
                          {wo.customer?.ime} {wo.customer?.prezime}
                        </div>
                        {wo.customer?.naziv_firme && (
                          <div className="text-sm text-gray-500">
                            {wo.customer.naziv_firme}
                          </div>
                        )}
                      </TableCell>
                      <TableCell onClick={() => onView(wo.id)}>
                        <div>{wo.marka_vozila} {wo.model_vozila}</div>
                        <div className="text-sm text-gray-500 font-mono">
                          {wo.registarske_tablice}
                        </div>
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
            <div className="lg:hidden divide-y">
              {data.items.map((wo) => (
                <div
                  key={wo.id}
                  className="p-4 active:bg-gray-50"
                  onClick={() => onView(wo.id)}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-gray-900">{wo.broj_naloga}</div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{formatDate(wo.created_at)}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(wo.created_at, wo.closed_at)}
                        </span>
                      </div>
                    </div>
                    <Badge className={getStatusColor(wo.status)}>
                      {getStatusLabel(wo.status)}
                    </Badge>
                  </div>
                  <div className="text-sm font-medium text-gray-900 mb-1">
                    {wo.customer?.ime} {wo.customer?.prezime}
                    {wo.customer?.naziv_firme && (
                      <span className="text-gray-500 font-normal"> • {wo.customer.naziv_firme}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mb-2">
                    {wo.marka_vozila} {wo.model_vozila} • {wo.registarske_tablice}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-gray-900">
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
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <div className="text-xs sm:text-sm text-gray-500">
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
    </div>
  );
}
