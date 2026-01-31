import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, Plus, Car, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { vehiclesApi } from "@/lib/api";
import type { Vehicle, VehicleForm } from "@/types";

interface VehicleSelectProps {
  customerId: number | null;
  value?: number;
  onChange: (vehicle: Vehicle | null) => void;
}

export function VehicleSelect({ customerId, value, onChange }: VehicleSelectProps) {
  const [open, setOpen] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Omit<VehicleForm, 'customer_id'>>({
    registarske_tablice: "",
    vin_broj: "",
    marka_vozila: "",
    model_vozila: "",
    motor: "",
  });

  const loadVehicles = async () => {
    if (!customerId) return;
    setLoading(true);
    const result = await vehiclesApi.getByCustomer(customerId);
    if (result.success && result.data) {
      setVehicles(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (customerId) {
      loadVehicles();
      // Reset internal selection when customer changes
      // Note: Don't call onChange(null) here - the parent handles clearing
      // vehicle fields in handleCustomerChange. Calling onChange here breaks
      // the edit flow where formData is already populated.
      setSelectedVehicle(null);
    } else {
      setVehicles([]);
      setSelectedVehicle(null);
    }
  }, [customerId]);

  useEffect(() => {
    if (value && vehicles.length > 0) {
      const vehicle = vehicles.find(v => v.id === value);
      if (vehicle) {
        setSelectedVehicle(vehicle);
      }
    }
  }, [value, vehicles]);

  const handleSelect = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    onChange(vehicle);
    setOpen(false);
  };

  const handleNewVehicle = async () => {
    if (!customerId) return;
    setFormError(null);

    const result = await vehiclesApi.create({
      customer_id: customerId,
      ...formData,
    });

    if (result.success && result.data) {
      await loadVehicles();
      handleSelect(result.data);
      setFormOpen(false);
      setFormData({
        registarske_tablice: "",
        vin_broj: "",
        marka_vozila: "",
        model_vozila: "",
        motor: "",
      });
    } else {
      setFormError(result.error || "Greška pri kreiranju vozila");
    }
  };

  const handleClearSelection = () => {
    setSelectedVehicle(null);
    onChange(null);
  };

  const handleDeleteVehicle = async (e: React.MouseEvent, vehicleId: number) => {
    e.stopPropagation(); // Prevent selecting the vehicle
    if (!confirm("Da li ste sigurni da želite obrisati ovo vozilo?")) return;

    const result = await vehiclesApi.delete(vehicleId);
    if (result.success) {
      // If deleted vehicle was selected, clear selection
      if (selectedVehicle?.id === vehicleId) {
        setSelectedVehicle(null);
        onChange(null);
      }
      await loadVehicles();
    }
  };

  if (!customerId) {
    return (
      <Button
        variant="outline"
        type="button"
        disabled
        className="w-full justify-between font-normal text-muted-foreground"
      >
        Prvo odaberi klijenta
        <Car className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        type="button"
        role="combobox"
        className={cn(
          "w-full justify-between font-normal",
          !selectedVehicle && "text-muted-foreground"
        )}
        onClick={() => setOpen(true)}
      >
        {selectedVehicle
          ? `${selectedVehicle.marka_vozila} ${selectedVehicle.model_vozila} (${selectedVehicle.registarske_tablice})`
          : "Odaberi ili dodaj vozilo..."}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Odaberi vozilo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFormOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Novo vozilo
              </Button>
            </div>

            <div className="max-h-64 overflow-auto space-y-1">
              {loading ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  Učitavanje...
                </p>
              ) : vehicles.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  Nema vozila za ovog klijenta
                </p>
              ) : (
                <>
                  {/* Option to enter new vehicle data manually */}
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-none text-left hover:bg-muted",
                      !selectedVehicle && "bg-muted"
                    )}
                  >
                    <div className="text-muted-foreground">
                      Unesi novo vozilo ručno
                    </div>
                    {!selectedVehicle && (
                      <Check className="h-4 w-4 text-status-success" />
                    )}
                  </button>

                  {vehicles.map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className={cn(
                        "flex items-center justify-between px-3 py-2 rounded-none hover:bg-muted",
                        value === vehicle.id && "bg-muted"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(vehicle)}
                        className="flex-1 text-left"
                      >
                        <div className="font-medium">
                          {vehicle.marka_vozila} {vehicle.model_vozila}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {vehicle.registarske_tablice}
                          {vehicle.motor && ` • ${vehicle.motor}`}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 ml-2">
                        {value === vehicle.id && (
                          <Check className="h-4 w-4 text-status-success" />
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleDeleteVehicle(e, vehicle.id)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                          title="Obriši vozilo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Vehicle Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo vozilo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Marka *</Label>
                <Input
                  value={formData.marka_vozila}
                  onChange={(e) => setFormData({ ...formData, marka_vozila: e.target.value })}
                  placeholder="npr. Volkswagen"
                />
              </div>
              <div className="space-y-2">
                <Label>Model *</Label>
                <Input
                  value={formData.model_vozila}
                  onChange={(e) => setFormData({ ...formData, model_vozila: e.target.value })}
                  placeholder="npr. Golf 7"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Registarske tablice *</Label>
              <Input
                value={formData.registarske_tablice}
                onChange={(e) => setFormData({ ...formData, registarske_tablice: e.target.value })}
                placeholder="npr. A12-B-345"
              />
            </div>

            <div className="space-y-2">
              <Label>VIN broj</Label>
              <Input
                value={formData.vin_broj}
                onChange={(e) => setFormData({ ...formData, vin_broj: e.target.value })}
                placeholder="17 znakova"
              />
            </div>

            <div className="space-y-2">
              <Label>Motor</Label>
              <Input
                value={formData.motor}
                onChange={(e) => setFormData({ ...formData, motor: e.target.value })}
                placeholder="npr. 2.0 TDI"
              />
            </div>

            {formError && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-none">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => {
                setFormOpen(false);
                setFormError(null);
              }}>
                Odustani
              </Button>
              <Button
                onClick={handleNewVehicle}
                disabled={!formData.marka_vozila || !formData.model_vozila || !formData.registarske_tablice}
              >
                Spremi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
