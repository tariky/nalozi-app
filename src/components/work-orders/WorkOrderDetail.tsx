import { useState, useEffect } from "react";
import { ArrowLeft, Pencil, FileDown, Trash2, CheckCircle, Wrench, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkOrderItems } from "./WorkOrderItems";
import { TimeTracker } from "./TimeTracker";
import { workOrdersApi } from "@/lib/api";
import { invalidateWorkOrdersCache } from "./WorkOrderList";
import { formatDate, formatCurrency, getStatusLabel, getStatusColor } from "@/lib/formatters";
import type { WorkOrder } from "@/types";

interface WorkOrderDetailProps {
  workOrderId: number;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPrintPDF: (workOrder: WorkOrder) => void;
}

export function WorkOrderDetail({
  workOrderId,
  onBack,
  onEdit,
  onDelete,
  onPrintPDF,
}: WorkOrderDetailProps) {
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);

  const loadWorkOrder = async () => {
    setLoading(true);
    const result = await workOrdersApi.getById(workOrderId);
    if (result.success && result.data) {
      setWorkOrder(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadWorkOrder();
  }, [workOrderId]);

  const handleDelete = async () => {
    if (confirm("Da li ste sigurni da želite obrisati ovaj radni nalog?")) {
      await workOrdersApi.delete(workOrderId);
      invalidateWorkOrdersCache();
      onDelete();
    }
  };

  const handleClose = async () => {
    if (confirm("Da li ste sigurni da želite zatvoriti ovaj radni nalog?")) {
      await workOrdersApi.update(workOrderId, { status: "zavrsen" });
      invalidateWorkOrdersCache();
      loadWorkOrder();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Učitavanje...</div>
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Radni nalog nije pronađen</p>
        <Button variant="outline" onClick={onBack} className="mt-4">
          Nazad
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-2xl font-semibold text-foreground truncate">
                {workOrder.broj_naloga}
              </h1>
              <Badge className={`${getStatusColor(workOrder.status)} text-xs shrink-0`}>
                {getStatusLabel(workOrder.status)}
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">{formatDate(workOrder.created_at)}</p>
          </div>
        </div>

        {/* Mobile: icon buttons only */}
        <div className="flex gap-1 sm:hidden shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPrintPDF(workOrder)}>
            <FileDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          {workOrder.status !== "zavrsen" && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
              <CheckCircle className="h-4 w-4 text-status-success" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>

        {/* Desktop: full buttons */}
        <div className="hidden sm:flex gap-2 shrink-0">
          <Button variant="outline" onClick={() => onPrintPDF(workOrder)}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            Uredi
          </Button>
          {workOrder.status !== "zavrsen" && (
            <Button variant="outline" onClick={handleClose}>
              <CheckCircle className="h-4 w-4 mr-2 text-status-success" />
              Zatvori
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Required Work & Notes Alert */}
      {(workOrder.opis_kvara || workOrder.napomena) && (
        <div className="space-y-2">
          {workOrder.opis_kvara && (
            <div className="bg-status-info/10 border-l-4 border-status-info p-3 sm:p-4 rounded-none">
              <div className="flex items-start gap-3">
                <Wrench className="h-5 w-5 text-status-info shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Traženi posao</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{workOrder.opis_kvara}</p>
                </div>
              </div>
            </div>
          )}
          {workOrder.napomena && (
            <div className="bg-status-warning/10 border-l-4 border-status-warning p-3 sm:p-4 rounded-none">
              <div className="flex items-start gap-3">
                <StickyNote className="h-5 w-5 text-status-warning shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Napomena</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{workOrder.napomena}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile: Compact combined info */}
      <div className="sm:hidden bg-card rounded-none border border-border p-3 space-y-3">
        {/* Customer row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground">Klijent</span>
            <p className="font-medium text-sm truncate">
              {workOrder.customer?.ime} {workOrder.customer?.prezime}
              {workOrder.customer?.naziv_firme && (
                <span className="text-muted-foreground font-normal"> • {workOrder.customer.naziv_firme}</span>
              )}
            </p>
          </div>
          {workOrder.customer?.telefon && (
            <a href={`tel:${workOrder.customer.telefon}`} className="text-sm text-status-info shrink-0">
              {workOrder.customer.telefon}
            </a>
          )}
        </div>

        {/* Vehicle row */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Vozilo</span>
            <p className="font-medium">{workOrder.marka_vozila} {workOrder.model_vozila}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Tablice</span>
            <p className="font-medium font-mono">{workOrder.registarske_tablice}</p>
          </div>
        </div>

        {/* Optional fields row */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {workOrder.vin_broj && (
            <div className="col-span-2">
              <span className="text-xs text-muted-foreground">VIN</span>
              <p className="font-mono text-xs truncate">{workOrder.vin_broj}</p>
            </div>
          )}
          {workOrder.motor && (
            <div>
              <span className="text-xs text-muted-foreground">Motor</span>
              <p className="font-medium">{workOrder.motor}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-muted-foreground">Mehaničar</span>
            <p className="font-medium">
              {workOrder.mechanic
                ? `${workOrder.mechanic.ime} ${workOrder.mechanic.prezime}`
                : "-"}
            </p>
          </div>
        </div>

      </div>

      {/* Desktop: Customer & Vehicle Info */}
      <div className="hidden sm:grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Customer */}
        <div className="bg-card rounded-none border border-border p-6">
          <h2 className="text-lg font-medium text-foreground mb-4">Klijent</h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-muted-foreground">Ime i prezime</span>
              <p className="font-medium">
                {workOrder.customer?.ime} {workOrder.customer?.prezime}
              </p>
            </div>
            {workOrder.customer?.naziv_firme && (
              <div>
                <span className="text-sm text-muted-foreground">Firma</span>
                <p className="font-medium">{workOrder.customer.naziv_firme}</p>
              </div>
            )}
            {workOrder.customer?.telefon && (
              <div>
                <span className="text-sm text-muted-foreground">Telefon</span>
                <p className="font-medium">{workOrder.customer.telefon}</p>
              </div>
            )}
          </div>
        </div>

        {/* Vehicle */}
        <div className="bg-card rounded-none border border-border p-6">
          <h2 className="text-lg font-medium text-foreground mb-4">Vozilo</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-muted-foreground">Marka</span>
                <p className="font-medium">{workOrder.marka_vozila}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Model</span>
                <p className="font-medium">{workOrder.model_vozila}</p>
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Registarske tablice</span>
              <p className="font-medium font-mono">
                {workOrder.registarske_tablice}
              </p>
            </div>
            {workOrder.vin_broj && (
              <div>
                <span className="text-sm text-muted-foreground">VIN broj</span>
                <p className="font-medium font-mono text-sm">
                  {workOrder.vin_broj}
                </p>
              </div>
            )}
            {workOrder.motor && (
              <div>
                <span className="text-sm text-muted-foreground">Motor</span>
                <p className="font-medium">{workOrder.motor}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Desktop: Mechanic */}
      <div className="hidden sm:block bg-card rounded-none border border-border p-6">
        <div>
          <span className="text-sm text-muted-foreground">Mehaničar</span>
          <p className="font-medium">
            {workOrder.mechanic
              ? `${workOrder.mechanic.ime} ${workOrder.mechanic.prezime}`
              : "Nije dodijeljen"}
          </p>
        </div>
      </div>

      {/* Time Tracking */}
      <div className="bg-card rounded-none border border-border p-3 sm:p-6">
        <h2 className="text-base sm:text-lg font-medium text-foreground mb-2 sm:mb-4">
          Evidencija vremena
        </h2>
        <TimeTracker
          workOrderId={workOrder.id}
          mechanicId={workOrder.mechanic_id}
          timeEntries={workOrder.time_entries || []}
          onUpdate={loadWorkOrder}
          isWorkOrderClosed={workOrder.status === "zavrsen"}
        />
      </div>

      {/* Items */}
      <div className="bg-card rounded-none border border-border p-3 sm:p-6">
        <h2 className="text-base sm:text-lg font-medium text-foreground mb-2 sm:mb-4">
          Dijelovi i usluge
        </h2>
        <WorkOrderItems
          workOrderId={workOrder.id}
          items={workOrder.items || []}
          onUpdate={loadWorkOrder}
        />
      </div>

      {/* Total */}
      <div className="bg-card rounded-none border border-border p-3 sm:p-6">
        <div className="flex justify-between items-center">
          <span className="text-base sm:text-xl font-medium text-foreground">Ukupno</span>
          <span className="text-xl sm:text-2xl font-semibold text-foreground">
            {formatCurrency(workOrder.ukupna_cijena)}
          </span>
        </div>
      </div>
    </div>
  );
}
