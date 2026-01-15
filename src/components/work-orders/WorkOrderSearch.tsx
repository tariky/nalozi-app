import { useState, useEffect } from "react";
import { Search, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { workOrdersApi } from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/formatters";
import type { WorkOrder } from "@/types";

interface WorkOrderSearchProps {
  onSelect: (workOrder: WorkOrder) => void;
}

export function WorkOrderSearch({ onSelect }: WorkOrderSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const debounce = setTimeout(async () => {
      setLoading(true);
      const result = await workOrdersApi.search(query);
      if (result.success && result.data) {
        setResults(result.data);
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounce);
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Pretraži po VIN-u, tablicama ili imenu..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
          className="pl-10"
        />
      </div>

      {showResults && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border z-50 max-h-80 overflow-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-gray-500">
              Pretraživanje...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              Nema rezultata
            </div>
          ) : (
            results.map((workOrder) => (
              <button
                key={workOrder.id}
                type="button"
                onClick={() => {
                  onSelect(workOrder);
                  setQuery("");
                  setResults([]);
                }}
                className="w-full p-3 hover:bg-gray-50 text-left border-b last:border-b-0"
              >
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">
                        {workOrder.broj_naloga}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatDate(workOrder.created_at)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {workOrder.customer?.ime} {workOrder.customer?.prezime}
                      {workOrder.customer?.naziv_firme && (
                        <span className="text-gray-400">
                          {" "}
                          ({workOrder.customer.naziv_firme})
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {workOrder.marka_vozila} {workOrder.model_vozila} •{" "}
                      {workOrder.registarske_tablice}
                    </div>
                    {workOrder.vin_broj && (
                      <div className="text-xs text-gray-400 font-mono">
                        VIN: {workOrder.vin_broj}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-gray-900">
                      {formatCurrency(workOrder.ukupna_cijena)}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
