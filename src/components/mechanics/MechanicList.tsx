import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, PageHeader } from "@/components/layout/PageContainer";
import { MechanicForm } from "./MechanicForm";
import { mechanicsApi } from "@/lib/api";
import type { Mechanic, MechanicForm as MechanicFormData } from "@/types";

export function MechanicList() {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMechanic, setEditingMechanic] = useState<Mechanic | null>(null);

  const loadMechanics = async () => {
    setLoading(true);
    const result = await mechanicsApi.getAll();
    if (result.success && result.data) {
      setMechanics(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadMechanics();
  }, []);

  const handleSave = async (data: MechanicFormData) => {
    if (editingMechanic) {
      await mechanicsApi.update(editingMechanic.id, data);
    } else {
      await mechanicsApi.create(data);
    }
    await loadMechanics();
  };

  const handleDelete = async (id: number) => {
    if (confirm("Da li ste sigurni da želite deaktivirati ovog mehaničara?")) {
      await mechanicsApi.delete(id);
      await loadMechanics();
    }
  };

  const openEditForm = (mechanic: Mechanic) => {
    setEditingMechanic(mechanic);
    setFormOpen(true);
  };

  const openNewForm = () => {
    setEditingMechanic(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Mehaničari"
        description="Upravljajte profilima mehaničara"
        action={
          <Button onClick={openNewForm} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Novi mehaničar
          </Button>
        }
      />

      <Card padding="none">
        {loading ? (
          <div className="p-4 sm:p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : mechanics.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <p className="text-gray-500 mb-4">Nema mehaničara</p>
            <Button onClick={openNewForm} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj prvog mehaničara
            </Button>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ime i prezime</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead className="w-24">Akcije</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mechanics.map((mechanic) => (
                    <TableRow key={mechanic.id}>
                      <TableCell className="font-medium">
                        {mechanic.ime} {mechanic.prezime}
                      </TableCell>
                      <TableCell>{mechanic.telefon || "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditForm(mechanic)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(mechanic.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="sm:hidden divide-y">
              {mechanics.map((mechanic) => (
                <div key={mechanic.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-gray-900">
                        {mechanic.ime} {mechanic.prezime}
                      </div>
                      {mechanic.telefon && (
                        <div className="text-sm text-gray-500">{mechanic.telefon}</div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => openEditForm(mechanic)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => handleDelete(mechanic.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <MechanicForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        mechanic={editingMechanic}
      />
    </div>
  );
}
