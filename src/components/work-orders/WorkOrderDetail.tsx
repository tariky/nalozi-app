import { useState, useEffect } from "react";
import { ArrowLeft, Pencil, FileDown, Trash2, CheckCircle, Wrench, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { WorkOrderItems } from "./WorkOrderItems";
import { TimeTracker } from "./TimeTracker";
import { workOrdersApi } from "@/lib/api";
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
      onDelete();
    }
  };

  const handleClose = async () => {
    if (confirm("Da li ste sigurni da želite zatvoriti ovaj radni nalog?")) {
      await workOrdersApi.update(workOrderId, { status: "zavrsen" });
      loadWorkOrder();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Učitavanje...</div>
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Radni nalog nije pronađen</p>
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
              <h1 className="text-lg sm:text-2xl font-semibold text-gray-900 truncate">
                {workOrder.broj_naloga}
              </h1>
              <Badge className={`${getStatusColor(workOrder.status)} text-xs shrink-0`}>
                {getStatusLabel(workOrder.status)}
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-gray-500">{formatDate(workOrder.created_at)}</p>
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
              <CheckCircle className="h-4 w-4 text-green-600" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 text-red-500" />
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
              <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
              Zatvori
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>

      {/* Required Work & Notes Alert */}
      {(workOrder.opis_kvara || workOrder.napomena) && (
        <div className="space-y-2">
          {workOrder.opis_kvara && (
            <div className="bg-blue-50 border-l-4 border-blue-500 p-3 sm:p-4 rounded-r-lg">
              <div className="flex items-start gap-3">
                <Wrench className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-blue-800">Traženi posao</p>
                  <p className="text-sm text-blue-700 whitespace-pre-wrap mt-1">{workOrder.opis_kvara}</p>
                </div>
              </div>
            </div>
          )}
          {workOrder.napomena && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-3 sm:p-4 rounded-r-lg">
              <div className="flex items-start gap-3">
                <StickyNote className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-800">Napomena</p>
                  <p className="text-sm text-amber-700 whitespace-pre-wrap mt-1">{workOrder.napomena}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile: Compact combined info */}
      <div className="sm:hidden bg-white rounded-lg shadow-sm p-3 space-y-3">
        {/* Customer row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-xs text-gray-500">Klijent</span>
            <p className="font-medium text-sm truncate">
              {workOrder.customer?.ime} {workOrder.customer?.prezime}
              {workOrder.customer?.naziv_firme && (
                <span className="text-gray-500 font-normal"> • {workOrder.customer.naziv_firme}</span>
              )}
            </p>
          </div>
          {workOrder.customer?.telefon && (
            <a href={`tel:${workOrder.customer.telefon}`} className="text-sm text-blue-600 shrink-0">
              {workOrder.customer.telefon}
            </a>
          )}
        </div>

        {/* Vehicle row */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-xs text-gray-500">Vozilo</span>
            <p className="font-medium">{workOrder.marka_vozila} {workOrder.model_vozila}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Tablice</span>
            <p className="font-medium font-mono">{workOrder.registarske_tablice}</p>
          </div>
        </div>

        {/* Optional fields row */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {workOrder.vin_broj && (
            <div className="col-span-2">
              <span className="text-xs text-gray-500">VIN</span>
              <p className="font-mono text-xs truncate">{workOrder.vin_broj}</p>
            </div>
          )}
          {workOrder.motor && (
            <div>
              <span className="text-xs text-gray-500">Motor</span>
              <p className="font-medium">{workOrder.motor}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-gray-500">Mehaničar</span>
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
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Klijent</h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-500">Ime i prezime</span>
              <p className="font-medium">
                {workOrder.customer?.ime} {workOrder.customer?.prezime}
              </p>
            </div>
            {workOrder.customer?.naziv_firme && (
              <div>
                <span className="text-sm text-gray-500">Firma</span>
                <p className="font-medium">{workOrder.customer.naziv_firme}</p>
              </div>
            )}
            {workOrder.customer?.telefon && (
              <div>
                <span className="text-sm text-gray-500">Telefon</span>
                <p className="font-medium">{workOrder.customer.telefon}</p>
              </div>
            )}
          </div>
        </div>

        {/* Vehicle */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Vozilo</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500">Marka</span>
                <p className="font-medium">{workOrder.marka_vozila}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Model</span>
                <p className="font-medium">{workOrder.model_vozila}</p>
              </div>
            </div>
            <div>
              <span className="text-sm text-gray-500">Registarske tablice</span>
              <p className="font-medium font-mono">
                {workOrder.registarske_tablice}
              </p>
            </div>
            {workOrder.vin_broj && (
              <div>
                <span className="text-sm text-gray-500">VIN broj</span>
                <p className="font-medium font-mono text-sm">
                  {workOrder.vin_broj}
                </p>
              </div>
            )}
            {workOrder.motor && (
              <div>
                <span className="text-sm text-gray-500">Motor</span>
                <p className="font-medium">{workOrder.motor}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Desktop: Mechanic */}
      <div className="hidden sm:block bg-white rounded-xl shadow-sm p-6">
        <div>
          <span className="text-sm text-gray-500">Mehaničar</span>
          <p className="font-medium">
            {workOrder.mechanic
              ? `${workOrder.mechanic.ime} ${workOrder.mechanic.prezime}`
              : "Nije dodijeljen"}
          </p>
        </div>
      </div>

      {/* Time Tracking */}
      <div className="bg-white rounded-lg sm:rounded-xl shadow-sm p-3 sm:p-6">
        <h2 className="text-base sm:text-lg font-medium text-gray-900 mb-2 sm:mb-4">
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
      <div className="bg-white rounded-lg sm:rounded-xl shadow-sm p-3 sm:p-6">
        <h2 className="text-base sm:text-lg font-medium text-gray-900 mb-2 sm:mb-4">
          Dijelovi i usluge
        </h2>
        <WorkOrderItems
          workOrderId={workOrder.id}
          items={workOrder.items || []}
          onUpdate={loadWorkOrder}
        />
      </div>

      {/* Total */}
      <div className="bg-white rounded-lg sm:rounded-xl shadow-sm p-3 sm:p-6">
        <div className="flex justify-between items-center">
          <span className="text-base sm:text-xl font-medium text-gray-900">Ukupno</span>
          <span className="text-xl sm:text-2xl font-bold text-gray-900">
            {formatCurrency(workOrder.ukupna_cijena)}
          </span>
        </div>
      </div>
    </div>
  );
}
