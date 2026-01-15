import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { customersApi } from "@/lib/api";
import { CustomerForm } from "./CustomerForm";
import type { Customer, CustomerForm as CustomerFormData } from "@/types";

interface CustomerSelectProps {
  value?: number;
  onChange: (customerId: number, customer: Customer) => void;
}

export function CustomerSelect({ value, onChange }: CustomerSelectProps) {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const loadCustomers = async (search?: string) => {
    setLoading(true);
    const result = await customersApi.getAll(1, 50, search);
    if (result.success && result.data) {
      setCustomers(result.data.items);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      loadCustomers();
    }
  }, [open]);

  useEffect(() => {
    if (value && !selectedCustomer) {
      // Load the selected customer
      customersApi.getById(value).then((result) => {
        if (result.success && result.data) {
          setSelectedCustomer(result.data);
        }
      });
    }
  }, [value]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (open) loadCustomers(searchQuery);
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, open]);

  const handleSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    onChange(customer.id, customer);
    setOpen(false);
  };

  const handleNewCustomer = async (data: CustomerFormData) => {
    const result = await customersApi.create(data);
    if (result.success && result.data) {
      handleSelect(result.data);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        type="button"
        role="combobox"
        className={cn(
          "w-full justify-between font-normal",
          !selectedCustomer && "text-muted-foreground"
        )}
        onClick={() => setOpen(true)}
      >
        {selectedCustomer
          ? `${selectedCustomer.ime} ${selectedCustomer.prezime}${selectedCustomer.naziv_firme ? ` (${selectedCustomer.naziv_firme})` : ""}`
          : "Odaberi klijenta..."}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Odaberi klijenta</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Pretraži..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setFormOpen(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-64 overflow-auto space-y-1">
              {loading ? (
                <p className="text-center text-sm text-gray-500 py-4">
                  Učitavanje...
                </p>
              ) : customers.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-4">
                  Nema klijenata
                </p>
              ) : (
                customers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => handleSelect(customer)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-gray-100",
                      value === customer.id && "bg-gray-100"
                    )}
                  >
                    <div>
                      <div className="font-medium">
                        {customer.ime} {customer.prezime}
                      </div>
                      {customer.naziv_firme && (
                        <div className="text-sm text-gray-500">
                          {customer.naziv_firme}
                        </div>
                      )}
                    </div>
                    {value === customer.id && (
                      <Check className="h-4 w-4 text-green-600" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CustomerForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleNewCustomer}
      />
    </>
  );
}
