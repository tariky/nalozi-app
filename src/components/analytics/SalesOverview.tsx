import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Calendar, CalendarDays, CalendarRange, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsApi } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { SalesData } from "@/types";

interface PeriodStat {
  label: string;
  shortLabel: string;
  total: number;
  orders: number;
  comparison?: number; // percentage change
  icon: React.ReactNode;
}

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function SalesOverview() {
  const [stats, setStats] = useState<PeriodStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dayBeforeYesterday = new Date(today);
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // 7 days including today

    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29); // 30 days including today

    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 59);

    // Fetch all data in one call (last 60 days for comparisons)
    const result = await analyticsApi.getSales(
      formatDateLocal(sixtyDaysAgo),
      formatDateLocal(today)
    );

    if (result.success && result.data) {
      const salesByDate = new Map<string, SalesData>();
      result.data.forEach(d => salesByDate.set(d.datum, d));

      // Calculate totals for each period
      const todayStr = formatDateLocal(today);
      const yesterdayStr = formatDateLocal(yesterday);
      const dayBeforeStr = formatDateLocal(dayBeforeYesterday);

      // Today's data
      const todayData = salesByDate.get(todayStr);
      const todayTotal = todayData?.ukupno || 0;
      const todayOrders = todayData?.broj_naloga || 0;

      // Yesterday's data
      const yesterdayData = salesByDate.get(yesterdayStr);
      const yesterdayTotal = yesterdayData?.ukupno || 0;
      const yesterdayOrders = yesterdayData?.broj_naloga || 0;

      // Day before yesterday (for comparison)
      const dayBeforeData = salesByDate.get(dayBeforeStr);
      const dayBeforeTotal = dayBeforeData?.ukupno || 0;

      // Last 7 days
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

        // Previous 7 days for comparison
        const pd = new Date(today);
        pd.setDate(pd.getDate() - i - 7);
        const pdata = salesByDate.get(formatDateLocal(pd));
        if (pdata) {
          prev7Total += pdata.ukupno;
        }
      }

      // Last 30 days
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

        // Previous 30 days for comparison
        const pd = new Date(today);
        pd.setDate(pd.getDate() - i - 30);
        const pdata = salesByDate.get(formatDateLocal(pd));
        if (pdata) {
          prev30Total += pdata.ukupno;
        }
      }

      // Calculate percentage changes
      const calcChange = (current: number, previous: number): number | undefined => {
        if (previous === 0) return current > 0 ? 100 : undefined;
        return Math.round(((current - previous) / previous) * 100);
      };

      setStats([
        {
          label: "Danas",
          shortLabel: "Danas",
          total: todayTotal,
          orders: todayOrders,
          comparison: calcChange(todayTotal, yesterdayTotal),
          icon: <Calendar className="h-5 w-5" />,
        },
        {
          label: "Jučer",
          shortLabel: "Jučer",
          total: yesterdayTotal,
          orders: yesterdayOrders,
          comparison: calcChange(yesterdayTotal, dayBeforeTotal),
          icon: <Calendar className="h-5 w-5" />,
        },
        {
          label: "Zadnjih 7 dana",
          shortLabel: "7 dana",
          total: last7Total,
          orders: last7Orders,
          comparison: calcChange(last7Total, prev7Total),
          icon: <CalendarDays className="h-5 w-5" />,
        },
        {
          label: "Zadnjih 30 dana",
          shortLabel: "30 dana",
          total: last30Total,
          orders: last30Orders,
          comparison: calcChange(last30Total, prev30Total),
          icon: <CalendarRange className="h-5 w-5" />,
        },
      ]);
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl p-4 sm:p-5 shadow-sm">
            <Skeleton className="h-4 w-16 mb-3" />
            <Skeleton className="h-7 w-24 mb-2" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {stats.map((stat, index) => (
        <div
          key={index}
          className="bg-white rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-xs sm:text-sm font-medium text-gray-500">
              <span className="hidden sm:inline">{stat.label}</span>
              <span className="sm:hidden">{stat.shortLabel}</span>
            </span>
            <div className="text-gray-400">
              {stat.icon}
            </div>
          </div>

          <div className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">
            {formatCurrency(stat.total)}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm text-gray-500">
              {stat.orders} {stat.orders === 1 ? "nalog" : stat.orders < 5 ? "naloga" : "naloga"}
            </span>

            {stat.comparison !== undefined && (
              <div className={`flex items-center gap-0.5 text-xs sm:text-sm font-medium ${
                stat.comparison > 0
                  ? "text-green-600"
                  : stat.comparison < 0
                    ? "text-red-600"
                    : "text-gray-500"
              }`}>
                {stat.comparison > 0 ? (
                  <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4" />
                ) : stat.comparison < 0 ? (
                  <TrendingDown className="h-3 w-3 sm:h-4 sm:w-4" />
                ) : (
                  <Minus className="h-3 w-3 sm:h-4 sm:w-4" />
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
