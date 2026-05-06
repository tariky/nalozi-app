import { useRef, useState } from "react";
import { Camera, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, parseCurrencyInput } from "@/lib/formatters";
import { invoiceScanApi, workOrderItemsApi } from "@/lib/api";
import type { WorkOrderItemForm } from "@/types";

interface InvoiceScanDialogProps {
  workOrderId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type ReviewRow = WorkOrderItemForm & { _id: string };

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "review"; rows: ReviewRow[]; warnings: string[] }
  | { kind: "adding"; rows: ReviewRow[]; warnings: string[] };

const MAX_BYTES = 8 * 1024 * 1024;

function newRowId(): string {
  return `r-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function rowTotal(row: ReviewRow): number {
  const subtotal = row.kolicina * row.jedinicna_cijena;
  return subtotal - (subtotal * (row.popust ?? 0)) / 100;
}

export function InvoiceScanDialog({ workOrderId, open, onOpenChange, onSuccess }: InvoiceScanDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhase({ kind: "error", message: "Slika nije validna" });
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase({ kind: "error", message: "Slika je prevelika (max 8MB)" });
      return;
    }

    setPhase({ kind: "scanning" });
    const result = await invoiceScanApi.scan(file);

    if (!result.success) {
      setPhase({ kind: "error", message: result.error });
      return;
    }

    if (result.data.items.length === 0) {
      setPhase({
        kind: "error",
        message: "Nije pronađeno stavki na slici. Pokušajte sa jasnijom slikom.",
      });
      return;
    }

    const rows: ReviewRow[] = result.data.items.map(item => ({
      _id: newRowId(),
      tip: "dio",
      naziv: item.naziv,
      kolicina: item.kolicina,
      jedinicna_cijena: item.jedinicna_cijena,
      popust: item.popust,
    }));
    setPhase({ kind: "review", rows, warnings: result.data.warnings });
  };

  const updateRow = (id: string, patch: Partial<ReviewRow>) => {
    if (phase.kind !== "review") return;
    setPhase({
      ...phase,
      rows: phase.rows.map(r => (r._id === id ? { ...r, ...patch } : r)),
    });
  };

  const removeRow = (id: string) => {
    if (phase.kind !== "review") return;
    setPhase({ ...phase, rows: phase.rows.filter(r => r._id !== id) });
  };

  const handleAddAll = async () => {
    if (phase.kind !== "review") return;
    if (phase.rows.length === 0) return;

    setPhase({ kind: "adding", rows: phase.rows, warnings: phase.warnings });

    const itemsToSend: WorkOrderItemForm[] = phase.rows.map(({ _id, ...rest }) => rest);
    const result = await workOrderItemsApi.addBulk(workOrderId, itemsToSend);

    if (!result.success) {
      setPhase({
        kind: "review",
        rows: phase.rows,
        warnings: [...phase.warnings, result.error || "Greška pri dodavanju stavki"],
      });
      return;
    }

    onSuccess();
    handleClose(false);
  };

  const total =
    phase.kind === "review" || phase.kind === "adding"
      ? phase.rows.reduce((sum, r) => sum + rowTotal(r), 0)
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skeniraj račun</DialogTitle>
        </DialogHeader>

        {phase.kind === "idle" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Slikajte ili odaberite sliku računa. Stavke će biti automatski prepoznate i možete ih pregledati prije dodavanja.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => fileInputRef.current?.click()} className="w-full sm:w-auto">
              <Camera className="h-4 w-4 mr-2" />
              Odaberi sliku
            </Button>
          </div>
        )}

        {phase.kind === "scanning" && (
          <div className="py-12 text-center space-y-3">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Analiziram račun...</p>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="py-6 space-y-4">
            <div className="flex items-start gap-3 p-3 bg-destructive/10 text-destructive rounded">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <p className="text-sm">{phase.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>Zatvori</Button>
              <Button onClick={reset}>Pokušaj ponovo</Button>
            </div>
          </div>
        )}

        {(phase.kind === "review" || phase.kind === "adding") && (
          <div className="space-y-4">
            {phase.warnings.length > 0 && (
              <div className="flex items-start gap-3 p-3 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 rounded text-sm">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <ul className="space-y-1">
                  {phase.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div className="space-y-3">
              {phase.rows.map((row) => (
                <div key={row._id} className="border rounded p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs font-medium rounded ${
                            row.tip === "dio"
                              ? "bg-status-info/10 text-status-info"
                              : "bg-status-success/10 text-status-success"
                          }`}
                          onClick={() => updateRow(row._id, { tip: row.tip === "dio" ? "usluga" : "dio" })}
                          disabled={phase.kind === "adding"}
                        >
                          {row.tip === "dio" ? "Dio" : "Usluga"}
                        </button>
                      </div>
                      <Input
                        value={row.naziv}
                        onChange={(e) => updateRow(row._id, { naziv: e.target.value })}
                        placeholder="Naziv"
                        disabled={phase.kind === "adding"}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">Količina</Label>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.kolicina}
                            onChange={(e) => updateRow(row._id, { kolicina: parseFloat(e.target.value) || 1 })}
                            disabled={phase.kind === "adding"}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Cijena</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.jedinicna_cijena}
                            onChange={(e) => updateRow(row._id, { jedinicna_cijena: parseCurrencyInput(e.target.value) })}
                            disabled={phase.kind === "adding"}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Popust %</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            value={row.popust ?? 0}
                            onChange={(e) => updateRow(row._id, { popust: parseFloat(e.target.value) || 0 })}
                            disabled={phase.kind === "adding"}
                          />
                        </div>
                      </div>
                      <div className="text-right text-sm font-medium">
                        Ukupno: {formatCurrency(rowTotal(row))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(row._id)}
                      disabled={phase.kind === "adding"}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-lg font-semibold">
                UKUPNO: {formatCurrency(total)}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)} disabled={phase.kind === "adding"}>
                  Odustani
                </Button>
                <Button
                  onClick={handleAddAll}
                  disabled={phase.kind === "adding" || phase.rows.length === 0}
                >
                  {phase.kind === "adding" ? "Dodajem..." : `Dodaj sve (${phase.rows.length})`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
