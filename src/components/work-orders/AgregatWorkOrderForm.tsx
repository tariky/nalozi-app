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
import { workOrdersApi, mechanicsApi } from "@/lib/api";
import { invalidateWorkOrdersCache } from "./WorkOrderList";
import { useAuth } from "@/contexts/AuthContext";
import { getTipAgregataLabel } from "@/lib/formatters";
import type { WorkOrder, WorkOrderFormAgregat, Mechanic, Customer, TipAgregata } from "@/types";

interface AgregatWorkOrderFormProps {
  workOrderId?: number;
  onBack: () => void;
  onSaved: (workOrder: WorkOrder) => void;
}

const TIP_AGREGATA_OPTIONS: TipAgregata[] = ['alnaser', 'alternator', 'klima_kompresor', 'elektricni_uredjaj', 'ostalo'];

export function AgregatWorkOrderForm({ workOrderId, onBack, onSaved }: AgregatWorkOrderFormProps) {
  const { user } = useAuth();
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialMechanicId = !workOrderId && user?.mechanic_id ? user.mechanic_id : undefined;

  const [formData, setFormData] = useState<WorkOrderFormAgregat>({
    tip_naloga: 'agregat',
    customer_id: 0,
    tip_agregata: 'alnaser',
    marka_agregata: '',
    model_agregata: '',
    serijski_broj: '',
    mechanic_id: initialMechanicId,
    opis_kvara: '',
    napomena: '',
    status: 'otvoren',
  });

  useEffect(() => {
    mechanicsApi.getAll().then(result => {
      if (result.success && result.data) setMechanics(result.data);
    });
  }, []);

  useEffect(() => {
    if (!workOrderId) return;
    setLoading(true);
    workOrdersApi.getById(workOrderId).then(result => {
      if (result.success && result.data) {
        const wo = result.data;
        if (wo.tip_naloga !== 'agregat') {
          setError('Ovaj nalog nije agregat nalog');
          return;
        }
        setFormData({
          tip_naloga: 'agregat',
          customer_id: wo.customer_id,
          tip_agregata: (wo.tip_agregata ?? 'alnaser') as TipAgregata,
          marka_agregata: wo.marka_agregata ?? '',
          model_agregata: wo.model_agregata ?? '',
          serijski_broj: wo.serijski_broj ?? '',
          mechanic_id: wo.mechanic_id ?? undefined,
          opis_kvara: wo.opis_kvara ?? '',
          napomena: wo.napomena ?? '',
          status: wo.status,
        });
      }
      setLoading(false);
    });
  }, [workOrderId]);

  const handleCustomerChange = (customerId: number, _customer: Customer) => {
    setFormData(prev => ({ ...prev, customer_id: customerId }));
  };

  const handleSubmit = async () => {
    setError(null);

    if (!formData.customer_id) {
      setError('Klijent je obavezan');
      return;
    }
    if (!formData.marka_agregata.trim()) {
      setError('Marka agregata je obavezna');
      return;
    }

    setSaving(true);
    const result = workOrderId
      ? await workOrdersApi.update(workOrderId, formData)
      : await workOrdersApi.create(formData);
    setSaving(false);

    if (result.success && result.data) {
      invalidateWorkOrdersCache();
      onSaved(result.data);
    } else {
      setError(result.error || 'Greška pri čuvanju');
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">Učitavanje...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Nazad
        </Button>
        <h1 className="text-xl font-medium">
          {workOrderId ? 'Uredi agregat nalog' : 'Novi agregat nalog'}
        </h1>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 text-destructive rounded text-sm">{error}</div>
      )}

      <div className="space-y-4 max-w-2xl">
        <div className="space-y-2">
          <Label>Klijent *</Label>
          <CustomerSelect
            value={formData.customer_id || undefined}
            onChange={handleCustomerChange}
          />
        </div>

        <div className="space-y-2">
          <Label>Tip agregata *</Label>
          <Select
            value={formData.tip_agregata}
            onValueChange={(v) => setFormData(prev => ({ ...prev, tip_agregata: v as TipAgregata }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIP_AGREGATA_OPTIONS.map(t => (
                <SelectItem key={t} value={t}>{getTipAgregataLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Marka *</Label>
          <Input
            value={formData.marka_agregata}
            onChange={(e) => setFormData(prev => ({ ...prev, marka_agregata: e.target.value }))}
            placeholder="npr. Bosch, Valeo"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Model</Label>
            <Input
              value={formData.model_agregata ?? ''}
              onChange={(e) => setFormData(prev => ({ ...prev, model_agregata: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Serijski broj</Label>
            <Input
              value={formData.serijski_broj ?? ''}
              onChange={(e) => setFormData(prev => ({ ...prev, serijski_broj: e.target.value }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Mehaničar</Label>
          <Select
            value={formData.mechanic_id?.toString() ?? 'none'}
            onValueChange={(v) => setFormData(prev => ({ ...prev, mechanic_id: v === 'none' ? undefined : parseInt(v) }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Odaberi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— bez mehaničara —</SelectItem>
              {mechanics.map(m => (
                <SelectItem key={m.id} value={m.id.toString()}>{m.ime} {m.prezime}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={formData.status ?? 'otvoren'}
            onValueChange={(v) => setFormData(prev => ({ ...prev, status: v as 'otvoren' | 'u_toku' | 'zavrsen' }))}
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

        <div className="space-y-2">
          <Label>Opis kvara</Label>
          <Textarea
            value={formData.opis_kvara ?? ''}
            onChange={(e) => setFormData(prev => ({ ...prev, opis_kvara: e.target.value }))}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label>Napomena</Label>
          <Textarea
            value={formData.napomena ?? ''}
            onChange={(e) => setFormData(prev => ({ ...prev, napomena: e.target.value }))}
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onBack}>Odustani</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Čuvanje...' : 'Sačuvaj'}
          </Button>
        </div>
      </div>
    </div>
  );
}
