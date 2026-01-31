import { useState, useEffect } from "react";
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
import { formatCurrency } from "@/lib/formatters";
import type { MechanicStats } from "@/types";

export function MechanicReport() {
  const [data, setData] = useState<MechanicStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);

  const loadData = async () => {
    setLoading(true);
    const result = await analyticsApi.getMechanicStats(from, to);
    if (result.success && result.data) {
      setData(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [from, to]);

  const totals = data.reduce(
    (acc, d) => ({
      nalozi: acc.nalozi + d.broj_naloga,
      zarada: acc.zarada + d.ukupna_zarada,
      dijelovi: acc.dijelovi + d.dijelovi,
      usluge: acc.usluge + d.usluge,
    }),
    { nalozi: 0, zarada: 0, dijelovi: 0, usluge: 0 }
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Filters */}
      <DateRangeFilter
        from={from || ''}
        to={to || ''}
        onChange={(f, t) => {
          setFrom(f);
          setTo(t);
        }}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Mehaničara" value={data.length} />
        <StatCard label="Ukupno naloga" value={totals.nalozi} />
        <StatCard label="Ukupna zarada" value={formatCurrency(totals.zarada)} />
        <StatCard
          label="Prosjek"
          value={formatCurrency(data.length > 0 ? totals.zarada / data.length : 0)}
        />
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
                    <TableHead>Mehaničar</TableHead>
                    <TableHead className="text-right">Nalozi</TableHead>
                    <TableHead className="text-right">Dijelovi</TableHead>
                    <TableHead className="text-right">Usluge</TableHead>
                    <TableHead className="text-right">Zarada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.mechanic_id}>
                      <TableCell className="font-medium">
                        {row.ime} {row.prezime}
                      </TableCell>
                      <TableCell className="text-right">{row.broj_naloga}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.dijelovi)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.usluge)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-status-success">
                        {formatCurrency(row.ukupna_zarada)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>UKUPNO</TableCell>
                    <TableCell className="text-right">{totals.nalozi}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totals.dijelovi)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(totals.usluge)}
                    </TableCell>
                    <TableCell className="text-right text-status-success">
                      {formatCurrency(totals.zarada)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="sm:hidden divide-y">
              {data.map((row) => (
                <div key={row.mechanic_id} className="p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-foreground">
                      {row.ime} {row.prezime}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {row.broj_naloga} naloga
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground">Dijelovi</div>
                      <div className="font-medium">{formatCurrency(row.dijelovi)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Usluge</div>
                      <div className="font-medium">{formatCurrency(row.usluge)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Zarada</div>
                      <div className="font-semibold text-status-success">{formatCurrency(row.ukupna_zarada)}</div>
                    </div>
                  </div>
                </div>
              ))}
              {/* Totals */}
              <div className="p-4 bg-muted/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-foreground">UKUPNO</span>
                  <span className="text-sm text-muted-foreground">{totals.nalozi} naloga</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-muted-foreground">Dijelovi</div>
                    <div className="font-medium">{formatCurrency(totals.dijelovi)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Usluge</div>
                    <div className="font-medium">{formatCurrency(totals.usluge)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Zarada</div>
                    <div className="font-semibold text-status-success">{formatCurrency(totals.zarada)}</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
