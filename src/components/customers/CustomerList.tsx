import { useState, useEffect } from "react";
import { Plus, Pencil, Search, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { CustomerForm } from "./CustomerForm";
import { customersApi } from "@/lib/api";
import type { Customer, CustomerForm as CustomerFormData, PaginatedResponse } from "@/types";

interface CustomerListProps {
  onView: (id: number) => void;
}

export function CustomerList({ onView }: CustomerListProps) {
  const [data, setData] = useState<PaginatedResponse<Customer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const loadCustomers = async () => {
    setLoading(true);
    const result = await customersApi.getAll(page, 20, searchQuery || undefined);
    if (result.success && result.data) {
      setData(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCustomers();
  }, [page]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      setPage(1);
      loadCustomers();
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleSave = async (formData: CustomerFormData) => {
    if (editingCustomer) {
      await customersApi.update(editingCustomer.id, formData);
    } else {
      await customersApi.create(formData);
    }
    await loadCustomers();
  };

  const openEditForm = (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCustomer(customer);
    setFormOpen(true);
  };

  const openNewForm = () => {
    setEditingCustomer(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Klijenti"
        description="Upravljajte podacima o klijentima"
        action={
          <Button onClick={openNewForm} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Novi klijent
          </Button>
        }
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Pretraži po imenu, firmi ili telefonu..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Content */}
      <Card padding="none">
        {loading ? (
          <div className="p-4 sm:p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <p className="text-gray-500 mb-4">
              {searchQuery ? "Nema rezultata pretrage" : "Nema klijenata"}
            </p>
            {!searchQuery && (
              <Button onClick={openNewForm} variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Dodaj prvog klijenta
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ime i prezime</TableHead>
                    <TableHead>Firma</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead className="hidden lg:table-cell">Email</TableHead>
                    <TableHead className="w-24">Akcije</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((customer) => (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => onView(customer.id)}
                    >
                      <TableCell className="font-medium">
                        {customer.ime} {customer.prezime}
                      </TableCell>
                      <TableCell>{customer.naziv_firme || "-"}</TableCell>
                      <TableCell>{customer.telefon || "-"}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {customer.email || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); onView(customer.id); }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => openEditForm(customer, e)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y">
              {data.items.map((customer) => (
                <div
                  key={customer.id}
                  className="p-4 active:bg-gray-50"
                  onClick={() => onView(customer.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-gray-900">
                        {customer.ime} {customer.prezime}
                      </div>
                      {customer.naziv_firme && (
                        <div className="text-sm text-gray-500">{customer.naziv_firme}</div>
                      )}
                      {customer.telefon && (
                        <div className="text-sm text-gray-500 mt-1">{customer.telefon}</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 flex-shrink-0"
                      onClick={(e) => openEditForm(customer, e)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <div className="text-xs sm:text-sm text-gray-500">
                  Str. {data.page}/{data.totalPages} ({data.total})
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page === data.totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <CustomerForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        customer={editingCustomer}
      />
    </div>
  );
}
