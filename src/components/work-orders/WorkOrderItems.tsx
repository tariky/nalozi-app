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
  });
  const [loading, setLoading] = useState(false);

  const openNewForm = (tip: "dio" | "usluga") => {
    setEditingItem(null);
    setFormData({ tip, naziv: "", kolicina: 1, jedinicna_cijena: 0 });
    setFormOpen(true);
  };

  const openEditForm = (item: WorkOrderItem) => {
    setEditingItem(item);
    setFormData({
      tip: item.tip,
      naziv: item.naziv,
      kolicina: item.kolicina,
      jedinicna_cijena: item.jedinicna_cijena,
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
        <div className="text-center py-6 sm:py-8 text-gray-500 text-sm">
          Nema stavki
        </div>
      ) : (
        <>
          {/* Mobile: Compact list */}
          <div className="sm:hidden space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0">
                <span
                  className={`shrink-0 w-1 h-8 rounded-full ${
                    item.tip === "dio" ? "bg-blue-500" : "bg-green-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1">
                    <span className="font-medium text-sm truncate">{item.naziv}</span>
                    {item.kolicina !== 1 && (
                      <span className="text-xs text-gray-500">×{item.kolicina}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
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
                      <Trash2 className="h-3 w-3 text-red-500" />
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
                  <TableHead className="text-right">Ukupno</TableHead>
                  {!readOnly && <TableHead className="w-20">Akcije</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span
                        className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                          item.tip === "dio"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-green-100 text-green-800"
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
                            <Trash2 className="h-4 w-4 text-red-500" />
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
            <div className="flex justify-between text-gray-600">
              <span>Dijelovi:</span>
              <span>{formatCurrency(partsTotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
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

            <div className="grid grid-cols-2 gap-4">
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
            </div>

            <div className="text-right text-lg font-semibold">
              Ukupno: {formatCurrency(formData.kolicina * formData.jedinicna_cijena)}
            </div>

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
