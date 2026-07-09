import { useState, useEffect, useRef } from "react";
import { Upload, Trash2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, PageHeader } from "@/components/layout/PageContainer";
import { settingsApi } from "@/lib/api";
import { useCompanySettings } from "@/contexts/CompanySettingsContext";
import type { CompanySettingsForm } from "@/types";

const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
// Keep the resulting data-URI under the server's 200KB limit.
const MAX_LOGO_DATAURI_LENGTH = 200 * 1024;

const EMPTY_FORM: CompanySettingsForm = {
  naziv: "",
  telefon: "",
  email: "",
  adresa: "",
  id_broj: "",
  web: "",
  logo: null,
};

export function CompanySettings() {
  const { settings, refresh } = useCompanySettings();
  const [form, setForm] = useState<CompanySettingsForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings) {
      setForm({
        naziv: settings.naziv || "",
        telefon: settings.telefon || "",
        email: settings.email || "",
        adresa: settings.adresa || "",
        id_broj: settings.id_broj || "",
        web: settings.web || "",
        logo: settings.logo,
      });
    }
  }, [settings]);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(false);

    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setError("Logo mora biti PNG, JPG ili SVG slika");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      if (dataUri.length > MAX_LOGO_DATAURI_LENGTH) {
        setError("Logo je prevelik (maksimalno 200KB)");
        return;
      }
      setForm((f) => ({ ...f, logo: dataUri }));
    };
    reader.onerror = () => setError("Greška pri čitanju slike");
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setForm((f) => ({ ...f, logo: null }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const result = await settingsApi.updateCompany(form);
    if (result.success) {
      await refresh();
      setSuccess(true);
    } else {
      setError(result.error || "Greška pri spremanju");
    }
    setSaving(false);
  };

  return (
    <div>
      <PageHeader
        title="Postavke firme"
        description="Podaci autoservisa i logo koji se prikazuju na radnim nalozima i u navigaciji"
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3">
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-status-success bg-status-success/10 p-3">
            Postavke su spremljene
          </div>
        )}

        {/* Logo */}
        <Card>
          <Label className="mb-3 block">Logo</Label>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 border border-border flex items-center justify-center bg-muted/30 overflow-hidden">
              {form.logo ? (
                <img src={form.logo} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={handleLogoSelect}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                Učitaj logo
              </Button>
              {form.logo && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleRemoveLogo}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Ukloni
                </Button>
              )}
              <p className="text-xs text-muted-foreground">PNG, JPG ili SVG, do 200KB</p>
            </div>
          </div>
        </Card>

        {/* Company details */}
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="naziv">Naziv firme</Label>
              <Input
                id="naziv"
                value={form.naziv}
                onChange={(e) => setForm({ ...form, naziv: e.target.value })}
                placeholder="npr. Auto Servis d.o.o."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefon">Telefon</Label>
              <Input
                id="telefon"
                value={form.telefon}
                onChange={(e) => setForm({ ...form, telefon: e.target.value })}
                placeholder="+387 ..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="info@primjer.ba"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="adresa">Adresa</Label>
              <Input
                id="adresa"
                value={form.adresa}
                onChange={(e) => setForm({ ...form, adresa: e.target.value })}
                placeholder="Ulica i broj, grad"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="id_broj">ID / PDV broj</Label>
              <Input
                id="id_broj"
                value={form.id_broj}
                onChange={(e) => setForm({ ...form, id_broj: e.target.value })}
                placeholder="JIB / PDV broj"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="web">Web stranica</Label>
              <Input
                id="web"
                value={form.web}
                onChange={(e) => setForm({ ...form, web: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "Spremanje..." : "Spremi postavke"}
          </Button>
        </div>
      </form>
    </div>
  );
}
