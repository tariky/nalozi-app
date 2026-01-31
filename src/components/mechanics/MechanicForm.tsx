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
import type { Mechanic, MechanicForm as MechanicFormData } from "@/types";

interface MechanicFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: MechanicFormData) => Promise<void>;
  mechanic?: Mechanic | null;
}

export function MechanicForm({ open, onClose, onSave, mechanic }: MechanicFormProps) {
  const [formData, setFormData] = useState<MechanicFormData>({
    ime: "",
    prezime: "",
    telefon: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mechanic) {
      setFormData({
        ime: mechanic.ime,
        prezime: mechanic.prezime,
        telefon: mechanic.telefon || "",
      });
    } else {
      setFormData({ ime: "", prezime: "", telefon: "" });
    }
    setError(null);
  }, [mechanic, open]);

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
            {mechanic ? "Uredi mehaničara" : "Novi mehaničar"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-none">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ime">Ime *</Label>
            <Input
              id="ime"
              value={formData.ime}
              onChange={(e) => setFormData({ ...formData, ime: e.target.value })}
              placeholder="Unesite ime"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prezime">Prezime *</Label>
            <Input
              id="prezime"
              value={formData.prezime}
              onChange={(e) => setFormData({ ...formData, prezime: e.target.value })}
              placeholder="Unesite prezime"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefon">Telefon</Label>
            <Input
              id="telefon"
              value={formData.telefon}
              onChange={(e) => setFormData({ ...formData, telefon: e.target.value })}
              placeholder="Unesite broj telefona"
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
