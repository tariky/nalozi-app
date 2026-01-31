import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, StatCard } from "@/components/layout/PageContainer";
import { DateRangeFilter } from "./DateRangeFilter";
import { analyticsApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { SalesData } from "@/types";

export function SalesReport() {
  const [data, setData] = useState<SalesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [tipFilter, setTipFilter] = useState("all");

  const loadData = async () => {
    setLoading(true);
    const tip = tipFilter !== "all" ? tipFilter : undefined;
    const result = await analyticsApi.getSales(from, to, tip);
    if (result.success && result.data) {
      setData(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [from, to, tipFilter]);

  const totals = data.reduce(
    (acc, d) => ({
      dijelovi: acc.dijelovi + d.ukupno_dijelovi,
      usluge: acc.usluge + d.ukupno_usluge,
      ukupno: acc.ukupno + d.ukupno,
      nalozi: acc.nalozi + d.broj_naloga,
    }),
    { dijelovi: 0, usluge: 0, ukupno: 0, nalozi: 0 }
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
        <DateRangeFilter
          from={from || ''}
          to={to || ''}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        <Select value={tipFilter} onValueChange={setTipFilter}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sve stavke</SelectItem>
            <SelectItem value="dio">Dijelovi</SelectItem>
            <SelectItem value="usluga">Usluge</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Ukupna prodaja" value={formatCurrency(totals.ukupno)} />
        <StatCard label="Dijelovi" value={formatCurrency(totals.dijelovi)} />
        <StatCard label="Usluge" value={formatCurrency(totals.usluge)} />
        <StatCard label="Broj naloga" value={totals.nalozi} />
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-4 sm:p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="p-8 sm:p-12 text-center text-muted-foreground">
            Nema podataka za odabrani period
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead className="text-right">Dijelovi</TableHead>
                    <TableHead className="text-right">Usluge</TableHead>
                    <TableHead className="text-right">Ukupno</TableHead>
                    <TableHead className="text-right">Nalozi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.datum}>
                      <TableCell className="font-medium">
                        {formatDate(row.datum)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.ukupno_dijelovi)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.ukupno_usluge)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(row.ukupno)}
                      </TableCell>
                      <TableCell className="text-right">{row.broj_naloga}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="sm:hidden divide-y">
              {data.map((row) => (
                <div key={row.datum} className="p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-foreground">
                      {formatDate(row.datum)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {row.broj_naloga} naloga
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground">Dijelovi</div>
                      <div className="font-medium">{formatCurrency(row.ukupno_dijelovi)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Usluge</div>
                      <div className="font-medium">{formatCurrency(row.ukupno_usluge)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Ukupno</div>
                      <div className="font-semibold text-foreground">{formatCurrency(row.ukupno)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
