import { useState, useEffect } from "react";
import { ArrowLeft, Pencil, FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { customersApi, workOrdersApi } from "@/lib/api";
import { formatDate, formatCurrency, getStatusLabel, getStatusColor } from "@/lib/formatters";
import type { Customer, WorkOrder } from "@/types";

interface CustomerDetailProps {
  customerId: number;
  onBack: () => void;
  onEdit: () => void;
  onViewWorkOrder: (id: number) => void;
}

export function CustomerDetail({
  customerId,
  onBack,
  onEdit,
  onViewWorkOrder,
}: CustomerDetailProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      // Load customer
      const customerResult = await customersApi.getById(customerId);
      if (customerResult.success && customerResult.data) {
        setCustomer(customerResult.data);
      }

      // Load work orders for this customer
      const searchResult = await fetch(`/api/work-orders/by-customer/${customerId}`);
      if (searchResult.ok) {
        const data = await searchResult.json();
        setWorkOrders(data);
      }

      setLoading(false);
    };

    loadData();
  }, [customerId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Klijent nije pronađen</p>
        <Button variant="outline" onClick={onBack} className="mt-4">
          Nazad
        </Button>
      </div>
    );
  }

  const totalSpent = workOrders.reduce((sum, wo) => sum + wo.ukupna_cijena, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {customer.ime} {customer.prezime}
            </h1>
            {customer.naziv_firme && (
              <p className="text-muted-foreground">{customer.naziv_firme}</p>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={onEdit}>
          <Pencil className="h-4 w-4 mr-2" />
          Uredi
        </Button>
      </div>

      {/* Customer Info & Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card rounded-none border border-border p-6">
          <h2 className="text-lg font-medium text-foreground mb-4">Podaci o klijentu</h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-muted-foreground">Ime i prezime</span>
              <p className="font-medium">{customer.ime} {customer.prezime}</p>
            </div>
            {customer.naziv_firme && (
              <div>
                <span className="text-sm text-muted-foreground">Firma</span>
                <p className="font-medium">{customer.naziv_firme}</p>
              </div>
            )}
            {customer.telefon && (
              <div>
                <span className="text-sm text-muted-foreground">Telefon</span>
                <p className="font-medium">{customer.telefon}</p>
              </div>
            )}
            {customer.email && (
              <div>
                <span className="text-sm text-muted-foreground">Email</span>
                <p className="font-medium">{customer.email}</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-card rounded-none border border-border p-6">
          <h2 className="text-lg font-medium text-foreground mb-4">Statistika</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-muted-foreground">Broj naloga</span>
              <p className="text-2xl font-bold text-foreground">{workOrders.length}</p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Ukupno potrošeno</span>
              <p className="text-2xl font-bold text-status-success">{formatCurrency(totalSpent)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Work Orders */}
      <div className="bg-card rounded-none border border-border overflow-hidden">
        <div className="p-6 border-b">
          <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Radni nalozi ({workOrders.length})
          </h2>
        </div>

        {workOrders.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            Ovaj klijent nema radnih naloga
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Broj naloga</TableHead>
                    <TableHead>Vozilo</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Iznos</TableHead>
                    <TableHead className="w-16">Akcije</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workOrders.map((wo) => (
                    <TableRow
                      key={wo.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onViewWorkOrder(wo.id)}
                    >
                      <TableCell className="font-medium">{wo.broj_naloga}</TableCell>
                      <TableCell>
                        <div>{wo.marka_vozila} {wo.model_vozila}</div>
                        <div className="text-sm text-muted-foreground font-mono">
                          {wo.registarske_tablice}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(wo.created_at)}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(wo.status)}>
                          {getStatusLabel(wo.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(wo.ukupna_cijena)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewWorkOrder(wo.id);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y">
              {workOrders.map((wo) => (
                <div
                  key={wo.id}
                  className="p-4 hover:bg-muted/50 cursor-pointer"
                  onClick={() => onViewWorkOrder(wo.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium">{wo.broj_naloga}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(wo.created_at)}
                      </div>
                    </div>
                    <Badge className={getStatusColor(wo.status)}>
                      {getStatusLabel(wo.status)}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {wo.marka_vozila} {wo.model_vozila} • {wo.registarske_tablice}
                  </div>
                  <div className="mt-2 text-right font-medium">
                    {formatCurrency(wo.ukupna_cijena)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
