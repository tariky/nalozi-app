import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, getItemTypeLabel, parseCurrencyInput } from "@/lib/formatters";
import { workOrderItemsApi } from "@/lib/api";
import type { WorkOrderItem, WorkOrderItemForm } from "@/types";

interface WorkOrderItemsProps {
  workOrderId: number;
  items: WorkOrderItem[];
  onUpdate: () => void;
  readOnly?: boolean;
}

export function WorkOrderItems({ workOrderId, items, onUpdate, readOnly }: WorkOrderItemsProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkOrderItem | null>(null);
  const [formData, setFormData] = useState<WorkOrderItemForm>({
    tip: "usluga",
    naziv: "",
    kolicina: 1,
    jedinicna_cijena: 0,
    popust: 0,
  });
  const [loading, setLoading] = useState(false);

  const openNewForm = (tip: "dio" | "usluga") => {
    setEditingItem(null);
    setFormData({ tip, naziv: "", kolicina: 1, jedinicna_cijena: 0, popust: 0 });
    setFormOpen(true);
  };

  const openEditForm = (item: WorkOrderItem) => {
    setEditingItem(item);
    setFormData({
      tip: item.tip,
      naziv: item.naziv,
      kolicina: item.kolicina,
      jedinicna_cijena: item.jedinicna_cijena,
      popust: item.popust || 0,
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!formData.naziv || formData.jedinicna_cijena === 0) return;

    setLoading(true);
    if (editingItem) {
      await workOrderItemsApi.update(workOrderId, editingItem.id, formData);
    } else {
      await workOrderItemsApi.add(workOrderId, formData);
    }
    setLoading(false);
    setFormOpen(false);
    onUpdate();
  };

  const handleDelete = async (itemId: number) => {
    if (confirm("Da li ste sigurni da želite obrisati ovu stavku?")) {
      await workOrderItemsApi.delete(workOrderId, itemId);
      onUpdate();
    }
  };

  const total = items.reduce((sum, item) => sum + item.ukupna_cijena, 0);
  const partsTotal = items
    .filter((i) => i.tip === "dio")
    .reduce((sum, item) => sum + item.ukupna_cijena, 0);
  const servicesTotal = items
    .filter((i) => i.tip === "usluga")
    .reduce((sum, item) => sum + item.ukupna_cijena, 0);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Actions */}
      {!readOnly && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={() => openNewForm("usluga")}>
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            Usluga
          </Button>
          <Button variant="outline" size="sm" className="text-xs sm:text-sm h-8 sm:h-9" onClick={() => openNewForm("dio")}>
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            Dio
          </Button>
        </div>
      )}

      {/* Items */}
      {items.length === 0 ? (
        <div className="text-center py-6 sm:py-8 text-muted-foreground text-sm">
          Nema stavki
        </div>
      ) : (
        <>
          {/* Mobile: Compact list */}
          <div className="sm:hidden space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
                <span
                  className={`shrink-0 w-1 h-8 rounded-none ${
                    item.tip === "dio" ? "bg-status-info" : "bg-status-success"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1">
                    <span className="font-medium text-sm truncate">{item.naziv}</span>
                    {item.kolicina !== 1 && (
                      <span className="text-xs text-muted-foreground">×{item.kolicina}</span>
                    )}
                    {item.popust > 0 && (
                      <span className="text-xs text-status-success">-{item.popust}%</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(item.jedinicna_cijena)}
                  </div>
                </div>
                <span className="font-semibold text-sm shrink-0">
                  {formatCurrency(item.ukupna_cijena)}
                </span>
                {!readOnly && (
                  <div className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEditForm(item)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: Table */}
          <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tip</TableHead>
                  <TableHead>Naziv</TableHead>
                  <TableHead className="text-right">Količina</TableHead>
                  <TableHead className="text-right">Cijena</TableHead>
                  <TableHead className="text-right">Popust</TableHead>
                  <TableHead className="text-right">Ukupno</TableHead>
                  {!readOnly && <TableHead className="w-20">Akcije</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span
                        className={`inline-flex px-2 py-1 rounded-none text-xs font-medium ${
                          item.tip === "dio"
                            ? "bg-status-info/10 text-status-info"
                            : "bg-status-success/10 text-status-success"
                        }`}
                      >
                        {getItemTypeLabel(item.tip)}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{item.naziv}</TableCell>
                    <TableCell className="text-right">{item.kolicina}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.jedinicna_cijena)}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.popust > 0 ? `${item.popust}%` : "-"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(item.ukupna_cijena)}
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditForm(item)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Totals */}
      {items.length > 0 && (
        <div className="flex justify-end">
          <div className="w-full sm:w-64 space-y-1 sm:space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Dijelovi:</span>
              <span>{formatCurrency(partsTotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Usluge:</span>
              <span>{formatCurrency(servicesTotal)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base sm:text-lg border-t pt-1 sm:pt-2">
              <span>UKUPNO:</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Uredi stavku" : "Nova stavka"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tip</Label>
              <Select
                value={formData.tip}
                onValueChange={(v) =>
                  setFormData({ ...formData, tip: v as "dio" | "usluga" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usluga">Usluga</SelectItem>
                  <SelectItem value="dio">Dio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Naziv *</Label>
              <Input
                value={formData.naziv}
                onChange={(e) =>
                  setFormData({ ...formData, naziv: e.target.value })
                }
                placeholder="Unesite naziv"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Količina</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={formData.kolicina}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      kolicina: parseFloat(e.target.value) || 1,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Cijena (KM) *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.jedinicna_cijena}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      jedinicna_cijena: parseCurrencyInput(e.target.value),
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Popust (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.popust || 0}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      popust: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            {(() => {
              const subtotal = formData.kolicina * formData.jedinicna_cijena;
              const discount = subtotal * (formData.popust || 0) / 100;
              const total = subtotal - discount;
              return (
                <div className="text-right space-y-1">
                  {(formData.popust || 0) > 0 && (
                    <>
                      <div className="text-sm text-muted-foreground">
                        Prije popusta: {formatCurrency(subtotal)}
                      </div>
                      <div className="text-sm text-status-success">
                        Popust ({formData.popust}%): -{formatCurrency(discount)}
                      </div>
                    </>
                  )}
                  <div className="text-lg font-semibold">
                    Ukupno: {formatCurrency(total)}
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Odustani
              </Button>
              <Button onClick={handleSave} disabled={loading}>
                {loading ? "Spremanje..." : "Spremi"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
