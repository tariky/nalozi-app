import { useState, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { analyticsApi } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { SalesData } from "@/types";

interface PeriodStat {
  label: string;
  shortLabel: string;
  total: number;
  orders: number;
  comparison?: number;
}

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Cache stats between mounts to prevent flicker
let cachedStats: PeriodStat[] | null = null;

export function SalesOverview() {
  const [stats, setStats] = useState<PeriodStat[]>(cachedStats || []);
  const [loading, setLoading] = useState(!cachedStats);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current && cachedStats) return;
    hasFetched.current = true;
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dayBeforeYesterday = new Date(today);
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);

    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 59);

    const result = await analyticsApi.getSales(
      formatDateLocal(sixtyDaysAgo),
      formatDateLocal(today)
    );

    if (result.success && result.data) {
      const salesByDate = new Map<string, SalesData>();
      result.data.forEach(d => salesByDate.set(d.datum, d));

      const todayStr = formatDateLocal(today);
      const yesterdayStr = formatDateLocal(yesterday);
      const dayBeforeStr = formatDateLocal(dayBeforeYesterday);

      const todayData = salesByDate.get(todayStr);
      const todayTotal = todayData?.ukupno || 0;
      const todayOrders = todayData?.broj_naloga || 0;

      const yesterdayData = salesByDate.get(yesterdayStr);
      const yesterdayTotal = yesterdayData?.ukupno || 0;
      const yesterdayOrders = yesterdayData?.broj_naloga || 0;

      const dayBeforeData = salesByDate.get(dayBeforeStr);
      const dayBeforeTotal = dayBeforeData?.ukupno || 0;

      let last7Total = 0;
      let last7Orders = 0;
      let prev7Total = 0;

      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const data = salesByDate.get(formatDateLocal(d));
        if (data) {
          last7Total += data.ukupno;
          last7Orders += data.broj_naloga;
        }

        const pd = new Date(today);
        pd.setDate(pd.getDate() - i - 7);
        const pdata = salesByDate.get(formatDateLocal(pd));
        if (pdata) {
          prev7Total += pdata.ukupno;
        }
      }

      let last30Total = 0;
      let last30Orders = 0;
      let prev30Total = 0;

      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const data = salesByDate.get(formatDateLocal(d));
        if (data) {
          last30Total += data.ukupno;
          last30Orders += data.broj_naloga;
        }

        const pd = new Date(today);
        pd.setDate(pd.getDate() - i - 30);
        const pdata = salesByDate.get(formatDateLocal(pd));
        if (pdata) {
          prev30Total += pdata.ukupno;
        }
      }

      const calcChange = (current: number, previous: number): number | undefined => {
        if (previous === 0) return current > 0 ? 100 : undefined;
        return Math.round(((current - previous) / previous) * 100);
      };

      const newStats = [
        {
          label: "Danas",
          shortLabel: "Danas",
          total: todayTotal,
          orders: todayOrders,
          comparison: calcChange(todayTotal, yesterdayTotal),
        },
        {
          label: "Jučer",
          shortLabel: "Jučer",
          total: yesterdayTotal,
          orders: yesterdayOrders,
          comparison: calcChange(yesterdayTotal, dayBeforeTotal),
        },
        {
          label: "Zadnjih 7 dana",
          shortLabel: "7 dana",
          total: last7Total,
          orders: last7Orders,
          comparison: calcChange(last7Total, prev7Total),
        },
        {
          label: "Zadnjih 30 dana",
          shortLabel: "30 dana",
          total: last30Total,
          orders: last30Orders,
          comparison: calcChange(last30Total, prev30Total),
        },
      ];
      cachedStats = newStats;
      setStats(newStats);
    }

    setLoading(false);
  };

  const placeholderStats: PeriodStat[] = [
    { label: "Danas", shortLabel: "Danas", total: 0, orders: 0 },
    { label: "Jučer", shortLabel: "Jučer", total: 0, orders: 0 },
    { label: "Zadnjih 7 dana", shortLabel: "7 dana", total: 0, orders: 0 },
    { label: "Zadnjih 30 dana", shortLabel: "30 dana", total: 0, orders: 0 },
  ];

  const displayStats = stats.length > 0 ? stats : placeholderStats;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {displayStats.map((stat, index) => (
        <div
          key={index}
          className={`bg-card rounded-none border border-border p-4 sm:p-5 transition-all duration-200 hover:border-foreground/30 ${
            loading ? "opacity-50" : "opacity-100"
          }`}
        >
          <div className="mb-2 sm:mb-3">
            <span className="text-xs sm:text-sm text-muted-foreground">
              <span className="hidden sm:inline">{stat.label}</span>
              <span className="sm:hidden">{stat.shortLabel}</span>
            </span>
          </div>

          <div className="text-lg sm:text-xl font-semibold text-foreground mb-1">
            {formatCurrency(stat.total)}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm text-muted-foreground">
              {stat.orders} {stat.orders === 1 ? "nalog" : "naloga"}
            </span>

            {stat.comparison !== undefined && (
              <div className={`flex items-center gap-0.5 text-xs font-medium ${
                stat.comparison > 0
                  ? "text-status-success"
                  : stat.comparison < 0
                    ? "text-status-error"
                    : "text-muted-foreground"
              }`}>
                {stat.comparison > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : stat.comparison < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                <span>{stat.comparison > 0 ? "+" : ""}{stat.comparison}%</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
