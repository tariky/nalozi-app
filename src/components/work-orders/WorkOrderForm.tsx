import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerSelect } from "@/components/customers/CustomerSelect";
import { VehicleSelect } from "@/components/vehicles/VehicleSelect";
import { workOrdersApi, mechanicsApi, vehiclesApi } from "@/lib/api";
import type { WorkOrder, WorkOrderForm as WorkOrderFormData, Mechanic, Customer, Vehicle } from "@/types";

interface WorkOrderFormProps {
  workOrderId?: number;
  onBack: () => void;
  onSaved: (workOrder: WorkOrder) => void;
}

export function WorkOrderForm({ workOrderId, onBack, onSaved }: WorkOrderFormProps) {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | undefined>(undefined);
  const [vinWarning, setVinWarning] = useState<{ message: string; vehicle?: Vehicle & { customer?: { id: number; ime: string; prezime: string } } } | null>(null);
  const [checkingVin, setCheckingVin] = useState(false);

  const [formData, setFormData] = useState<WorkOrderFormData>({
    customer_id: 0,
    registarske_tablice: "",
    vin_broj: "",
    marka_vozila: "",
    model_vozila: "",
    motor: "",
    mechanic_id: undefined,
    napomena: "",
    status: "otvoren",
  });

  const handleCustomerChange = (customerId: number, customer: Customer) => {
    setSelectedCustomerId(customerId);
    setSelectedVehicleId(undefined);
    setFormData({
      ...formData,
      customer_id: customerId,
      // Clear vehicle fields when customer changes
      registarske_tablice: "",
      vin_broj: "",
      marka_vozila: "",
      model_vozila: "",
      motor: "",
    });
  };

  const handleVehicleChange = (vehicle: Vehicle | null) => {
    setVinWarning(null);
    if (vehicle) {
      setSelectedVehicleId(vehicle.id);
      setFormData({
        ...formData,
        registarske_tablice: vehicle.registarske_tablice,
        vin_broj: vehicle.vin_broj || "",
        marka_vozila: vehicle.marka_vozila,
        model_vozila: vehicle.model_vozila,
        motor: vehicle.motor || "",
      });
    } else {
      setSelectedVehicleId(undefined);
      // Keep customer_id but clear vehicle fields for manual entry
      setFormData({
        ...formData,
        registarske_tablice: "",
        vin_broj: "",
        marka_vozila: "",
        model_vozila: "",
        motor: "",
      });
    }
  };

  // Check if VIN exists in database
  const checkVinExists = async (vin: string) => {
    if (!vin || vin.length < 5 || selectedVehicleId) {
      setVinWarning(null);
      return;
    }

    setCheckingVin(true);
    const result = await vehiclesApi.checkVin(vin);

    if (result.success && result.data?.exists && result.data.vehicle) {
      const v = result.data.vehicle;
      setVinWarning({
        message: `Vozilo sa ovim VIN-om već postoji: ${v.marka_vozila} ${v.model_vozila} (${v.registarske_tablice}) - Klijent: ${v.customer?.ime} ${v.customer?.prezime}`,
        vehicle: v,
      });
    } else {
      setVinWarning(null);
    }
    setCheckingVin(false);
  };

  // Handle VIN input change
  const handleVinChange = (vin: string) => {
    const upperVin = vin.toUpperCase();
    setFormData({ ...formData, vin_broj: upperVin });
  };

  // Debounced VIN check
  useEffect(() => {
    // Only check if creating new work order, no vehicle selected, and VIN has enough characters
    if (workOrderId || selectedVehicleId || !formData.vin_broj || formData.vin_broj.length < 5) {
      setVinWarning(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      checkVinExists(formData.vin_broj);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [formData.vin_broj, workOrderId, selectedVehicleId]);

  useEffect(() => {
    // Load mechanics
    mechanicsApi.getAll().then((result) => {
      if (result.success && result.data) {
        setMechanics(result.data);
      }
    });

    // Load existing work order if editing
    if (workOrderId) {
      setLoading(true);
      workOrdersApi.getById(workOrderId).then((result) => {
        if (result.success && result.data) {
          const wo = result.data;
          setSelectedCustomerId(wo.customer_id);
          setFormData({
            customer_id: wo.customer_id,
            registarske_tablice: wo.registarske_tablice,
            vin_broj: wo.vin_broj || "",
            marka_vozila: wo.marka_vozila,
            model_vozila: wo.model_vozila,
            motor: wo.motor || "",
            mechanic_id: wo.mechanic_id || undefined,
            napomena: wo.napomena || "",
            status: wo.status,
          });
        }
        setLoading(false);
      });
    }
  }, [workOrderId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.customer_id || !formData.registarske_tablice || !formData.marka_vozila || !formData.model_vozila) {
      setError("Klijent, registarske tablice, marka i model vozila su obavezni");
      return;
    }

    // Block if VIN already exists
    if (vinWarning) {
      setError("Vozilo sa ovim VIN-om već postoji. Molimo odaberite to vozilo iz liste.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // If creating a new work order and no vehicle was selected, create the vehicle first
      if (!workOrderId && !selectedVehicleId && formData.customer_id) {
        const vehicleResult = await vehiclesApi.create({
          customer_id: formData.customer_id,
          registarske_tablice: formData.registarske_tablice,
          vin_broj: formData.vin_broj || undefined,
          marka_vozila: formData.marka_vozila,
          model_vozila: formData.model_vozila,
          motor: formData.motor || undefined,
        });

        if (!vehicleResult.success) {
          setError(vehicleResult.error || "Greška pri kreiranju vozila");
          setSaving(false);
          return;
        }
      }

      let result;
      if (workOrderId) {
        result = await workOrdersApi.update(workOrderId, formData);
      } else {
        result = await workOrdersApi.create(formData);
      }

      if (result.success && result.data) {
        onSaved(result.data);
      } else {
        setError(result.error || "Greška pri spremanju");
      }
    } catch (err) {
      setError("Greška pri spremanju");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Učitavanje...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {workOrderId ? "Uredi radni nalog" : "Novi radni nalog"}
          </h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 p-4 rounded-lg">
            {error}
          </div>
        )}

        {/* Customer Section */}
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Klijent</h2>

          <div className="space-y-2">
            <Label>Odaberi klijenta *</Label>
            <CustomerSelect
              value={formData.customer_id || undefined}
              onChange={handleCustomerChange}
            />
          </div>
        </div>

        {/* Vehicle Section */}
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Vozilo</h2>

          <div className="space-y-2">
            <Label>Odaberi postojeće ili dodaj novo</Label>
            <VehicleSelect
              customerId={selectedCustomerId}
              value={selectedVehicleId}
              onChange={handleVehicleChange}
            />
          </div>

          <h3 className="text-sm font-medium text-gray-700 pt-2">Podaci o vozilu</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="registarske_tablice">Registarske tablice *</Label>
              <Input
                id="registarske_tablice"
                value={formData.registarske_tablice}
                onChange={(e) =>
                  setFormData({ ...formData, registarske_tablice: e.target.value.toUpperCase() })
                }
                placeholder="npr. A12-A-123"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vin_broj">VIN broj</Label>
              <Input
                id="vin_broj"
                value={formData.vin_broj}
                onChange={(e) => handleVinChange(e.target.value)}
                placeholder="17 karaktera"
                maxLength={17}
                className={vinWarning ? "border-yellow-500" : ""}
              />
              {checkingVin && (
                <p className="text-xs text-gray-500">Provjera VIN-a...</p>
              )}
              {vinWarning && (
                <div className="text-sm text-yellow-700 bg-yellow-50 p-3 rounded-lg">
                  {vinWarning.message}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="marka_vozila">Marka vozila *</Label>
              <Input
                id="marka_vozila"
                value={formData.marka_vozila}
                onChange={(e) =>
                  setFormData({ ...formData, marka_vozila: e.target.value })
                }
                placeholder="npr. Volkswagen"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model_vozila">Model vozila *</Label>
              <Input
                id="model_vozila"
                value={formData.model_vozila}
                onChange={(e) =>
                  setFormData({ ...formData, model_vozila: e.target.value })
                }
                placeholder="npr. Golf 7"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="motor">Motor</Label>
              <Input
                id="motor"
                value={formData.motor}
                onChange={(e) =>
                  setFormData({ ...formData, motor: e.target.value })
                }
                placeholder="npr. 2.0 TDI 150 KS"
              />
            </div>
          </div>
        </div>

        {/* Work Order Details */}
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Detalji naloga</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Mehaničar</Label>
              <Select
                value={formData.mechanic_id?.toString() || "none"}
                onValueChange={(v) =>
                  setFormData({
                    ...formData,
                    mechanic_id: v === "none" ? undefined : parseInt(v),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Odaberi mehaničara" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nije dodijeljen</SelectItem>
                  {mechanics.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.ime} {m.prezime}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(v) =>
                  setFormData({
                    ...formData,
                    status: v as "otvoren" | "u_toku" | "zavrsen",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="otvoren">Otvoren</SelectItem>
                  <SelectItem value="u_toku">U toku</SelectItem>
                  <SelectItem value="zavrsen">Završen</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="napomena">Napomena</Label>
              <Textarea
                id="napomena"
                value={formData.napomena}
                onChange={(e) =>
                  setFormData({ ...formData, napomena: e.target.value })
                }
                placeholder="Dodatne napomene..."
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            Odustani
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Spremanje..." : workOrderId ? "Spremi izmjene" : "Kreiraj nalog"}
          </Button>
        </div>
      </form>
    </div>
  );
}
