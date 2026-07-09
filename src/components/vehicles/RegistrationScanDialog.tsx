import { useRef, useState } from "react";
import { Camera, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { registrationScanApi, customersApi, vehiclesApi } from "@/lib/api";
import type { ScanRegistrationResponse, Vehicle } from "@/types";

interface RegistrationScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: (customerId: number, vehicle: Vehicle) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "review"; data: ScanRegistrationResponse }
  | { kind: "saving"; data: ScanRegistrationResponse };

const MAX_BYTES = 8 * 1024 * 1024;

// "new" means: create it rather than reuse an existing row.
type Choice = number | "new";

interface VehicleFields {
  marka_vozila: string;
  model_vozila: string;
  registarske_tablice: string;
  vin_broj: string;
  motor: string;
}

const MATCH_LABEL: Record<string, string> = {
  vin_exact: "VIN se poklapa",
  vin_near: "VIN se razlikuje u par znakova",
  plates: "tablice se poklapaju",
};

export function RegistrationScanDialog({ open, onOpenChange, onResolved }: RegistrationScanDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [vehicleChoice, setVehicleChoice] = useState<Choice>("new");
  const [customerChoice, setCustomerChoice] = useState<Choice>("new");
  const [fields, setFields] = useState<VehicleFields>({
    marka_vozila: "",
    model_vozila: "",
    registarske_tablice: "",
    vin_broj: "",
    motor: "",
  });
  const [newIme, setNewIme] = useState("");
  const [newPrezime, setNewPrezime] = useState("");
  const [newTelefon, setNewTelefon] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase({ kind: "idle" });
    setVehicleChoice("new");
    setCustomerChoice("new");
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
    const result = await registrationScanApi.scan(file);
    if (!result.success) {
      setPhase({ kind: "error", message: result.error });
      return;
    }

    const { document, autoSelect } = result.data;
    setFields({
      marka_vozila: document.marka_vozila ?? "",
      model_vozila: document.model_vozila ?? "",
      registarske_tablice: document.registarske_tablice ?? "",
      vin_broj: document.vin_broj ?? "",
      motor: document.motor ?? "",
    });
    setNewIme(document.vlasnik.ime ?? "");
    setNewPrezime(document.vlasnik.prezime ?? "");
    setNewTelefon("");
    setVehicleChoice(autoSelect.vehicleId ?? "new");
    setCustomerChoice(autoSelect.customerId ?? "new");
    setPhase({ kind: "review", data: result.data });
  };

  const handleConfirm = async () => {
    if (phase.kind !== "review") return;
    const data = phase.data;
    setPhase({ kind: "saving", data });

    const fail = (message: string) => setPhase({ kind: "error", message });

    // 1. Customer: reuse the chosen row, or create one from the document.
    let customerId: number;
    if (customerChoice === "new") {
      if (!newIme.trim() || !newPrezime.trim()) {
        setPhase({ kind: "review", data });
        return;
      }
      const created = await customersApi.create({
        ime: newIme.trim(),
        prezime: newPrezime.trim(),
        telefon: newTelefon.trim() || undefined,
      });
      if (!created.success || !created.data) return fail(created.error || "Greška pri kreiranju klijenta");
      customerId = created.data.id;
    } else {
      customerId = customerChoice;
    }

    // 2. Vehicle: reuse the chosen row, or create one from the edited fields.
    let vehicle: Vehicle;
    if (vehicleChoice === "new") {
      const created = await vehiclesApi.create({
        customer_id: customerId,
        marka_vozila: fields.marka_vozila.trim(),
        model_vozila: fields.model_vozila.trim(),
        registarske_tablice: fields.registarske_tablice.trim(),
        vin_broj: fields.vin_broj.trim() || undefined,
        motor: fields.motor.trim() || undefined,
      });
      if (!created.success || !created.data) return fail(created.error || "Greška pri kreiranju vozila");
      vehicle = created.data;
    } else {
      const found = data.vehicleCandidates.find((c) => c.vehicle.id === vehicleChoice);
      if (!found) return fail("Vozilo nije pronađeno");
      vehicle = found.vehicle;

      // The car changed hands: move it to the customer standing on the document.
      if (vehicle.customer_id !== customerId) {
        const moved = await vehiclesApi.update(vehicle.id, { customer_id: customerId });
        if (!moved.success || !moved.data) return fail(moved.error || "Greška pri prebacivanju vozila");
        vehicle = moved.data;
      }
    }

    onResolved(customerId, vehicle);
    handleClose(false);
  };

  const data = phase.kind === "review" || phase.kind === "saving" ? phase.data : null;
  const saving = phase.kind === "saving";
  const canConfirm =
    !!data &&
    !saving &&
    (vehicleChoice !== "new" ||
      (fields.marka_vozila.trim() && fields.model_vozila.trim() && fields.registarske_tablice.trim())) &&
    (customerChoice !== "new" || (newIme.trim() && newPrezime.trim()));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skeniraj saobraćajnu</DialogTitle>
        </DialogHeader>

        {phase.kind === "idle" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Slikajte saobraćajnu dozvolu. Vozilo i klijent bit će prepoznati, a vi ih potvrđujete prije otvaranja naloga.
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
              Slikaj saobraćajnu
            </Button>
          </div>
        )}

        {phase.kind === "scanning" && (
          <div className="py-12 text-center space-y-3">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Čitam saobraćajnu...</p>
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

        {data && (
          <div className="space-y-6">
            {data.warnings.length > 0 && (
              <div className="flex items-start gap-3 p-3 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 rounded text-sm">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <ul className="space-y-1">
                  {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {/* Vehicle */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase">Vozilo</h3>

              {data.vehicleCandidates.map((c) => (
                <button
                  key={c.vehicle.id}
                  type="button"
                  disabled={saving}
                  onClick={() => setVehicleChoice(c.vehicle.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                    vehicleChoice === c.vehicle.id && "bg-muted"
                  )}
                >
                  <div>
                    <div className="font-medium">
                      {c.vehicle.marka_vozila} {c.vehicle.model_vozila}
                    </div>
                    <div className="text-sm text-muted-foreground font-mono">
                      {c.vehicle.registarske_tablice}
                    </div>
                    <div className="text-xs text-muted-foreground">{MATCH_LABEL[c.match]}</div>
                  </div>
                  {vehicleChoice === c.vehicle.id && <Check className="h-4 w-4 text-status-success" />}
                </button>
              ))}

              <button
                type="button"
                disabled={saving}
                onClick={() => setVehicleChoice("new")}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                  vehicleChoice === "new" && "bg-muted"
                )}
              >
                <span className="text-muted-foreground">Novo vozilo</span>
                {vehicleChoice === "new" && <Check className="h-4 w-4 text-status-success" />}
              </button>

              {vehicleChoice === "new" && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Marka *</Label>
                    <Input
                      value={fields.marka_vozila}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, marka_vozila: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Model *</Label>
                    <Input
                      value={fields.model_vozila}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, model_vozila: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tablice *</Label>
                    <Input
                      value={fields.registarske_tablice}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, registarske_tablice: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Motor</Label>
                    <Input
                      value={fields.motor}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, motor: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">VIN</Label>
                    <Input
                      value={fields.vin_broj}
                      disabled={saving}
                      onChange={(e) => setFields({ ...fields, vin_broj: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Customer */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase">Klijent</h3>

              {data.customerCandidates.map((c) => (
                <button
                  key={c.customer.id}
                  type="button"
                  disabled={saving}
                  onClick={() => setCustomerChoice(c.customer.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                    customerChoice === c.customer.id && "bg-muted"
                  )}
                >
                  <div>
                    <div className="font-medium">
                      {c.customer.ime} {c.customer.prezime}
                    </div>
                    {c.customer.telefon && (
                      <div className="text-sm text-muted-foreground">{c.customer.telefon}</div>
                    )}
                  </div>
                  {customerChoice === c.customer.id && <Check className="h-4 w-4 text-status-success" />}
                </button>
              ))}

              <button
                type="button"
                disabled={saving}
                onClick={() => setCustomerChoice("new")}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted",
                  customerChoice === "new" && "bg-muted"
                )}
              >
                <span className="text-muted-foreground">Novi klijent</span>
                {customerChoice === "new" && <Check className="h-4 w-4 text-status-success" />}
              </button>

              {customerChoice === "new" && (
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Ime *</Label>
                    <Input value={newIme} disabled={saving} onChange={(e) => setNewIme(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Prezime *</Label>
                    <Input value={newPrezime} disabled={saving} onChange={(e) => setNewPrezime(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Telefon</Label>
                    <Input value={newTelefon} disabled={saving} onChange={(e) => setNewTelefon(e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
                Odustani
              </Button>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                {saving ? "Spremam..." : "Otvori radni nalog"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
