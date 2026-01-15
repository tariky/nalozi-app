import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Customer, CustomerForm as CustomerFormData } from "@/types";

interface CustomerFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: CustomerFormData) => Promise<void>;
  customer?: Customer | null;
}

export function CustomerForm({ open, onClose, onSave, customer }: CustomerFormProps) {
  const [formData, setFormData] = useState<CustomerFormData>({
    naziv_firme: "",
    ime: "",
    prezime: "",
    telefon: "",
    email: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customer) {
      setFormData({
        naziv_firme: customer.naziv_firme || "",
        ime: customer.ime,
        prezime: customer.prezime,
        telefon: customer.telefon || "",
        email: customer.email || "",
      });
    } else {
      setFormData({ naziv_firme: "", ime: "", prezime: "", telefon: "", email: "" });
    }
    setError(null);
  }, [customer, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.ime || !formData.prezime) {
      setError("Ime i prezime su obavezni");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onSave(formData);
      onClose();
    } catch (err) {
      setError("Greška pri spremanju");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {customer ? "Uredi klijenta" : "Novi klijent"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="naziv_firme">Naziv firme</Label>
            <Input
              id="naziv_firme"
              value={formData.naziv_firme}
              onChange={(e) => setFormData({ ...formData, naziv_firme: e.target.value })}
              placeholder="Unesite naziv firme (opciono)"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ime">Ime *</Label>
              <Input
                id="ime"
                value={formData.ime}
                onChange={(e) => setFormData({ ...formData, ime: e.target.value })}
                placeholder="Ime"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prezime">Prezime *</Label>
              <Input
                id="prezime"
                value={formData.prezime}
                onChange={(e) => setFormData({ ...formData, prezime: e.target.value })}
                placeholder="Prezime"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefon">Telefon</Label>
            <Input
              id="telefon"
              value={formData.telefon}
              onChange={(e) => setFormData({ ...formData, telefon: e.target.value })}
              placeholder="Broj telefona"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="Email adresa"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Odustani
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Spremanje..." : "Spremi"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
