import { useState } from "react";
import { BarChart3, Users, TrendingUp, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SalesReport } from "./SalesReport";
import { MechanicReport } from "./MechanicReport";

type TabType = "sales" | "mechanics";

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabType>("sales");

  const tabs = [
    {
      id: "sales" as TabType,
      label: "Prodaja",
      description: "Pregled prihoda i naloga",
      icon: TrendingUp,
    },
    {
      id: "mechanics" as TabType,
      label: "Mehaničari",
      description: "Učinak tima",
      icon: Users,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-foreground flex items-center justify-center">
            <BarChart3 className="h-5 w-5 text-background" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Analitika
            </h1>
            <p className="text-sm text-muted-foreground">
              Pratite performanse vašeg servisa
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "group relative flex-1 sm:flex-none sm:min-w-[200px] p-4 text-left border transition-all duration-200",
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:border-foreground/50"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className={cn(
                      "h-4 w-4",
                      isActive ? "text-background" : "text-muted-foreground"
                    )} />
                    <span className={cn(
                      "font-medium",
                      isActive ? "text-background" : "text-foreground"
                    )}>
                      {tab.label}
                    </span>
                  </div>
                  <p className={cn(
                    "text-xs",
                    isActive ? "text-background/70" : "text-muted-foreground"
                  )}>
                    {tab.description}
                  </p>
                </div>
                <ArrowRight className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  isActive
                    ? "text-background translate-x-0"
                    : "text-muted-foreground -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                )} />
              </div>

              {/* Active indicator line */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-background" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "sales" && <SalesReport />}
        {activeTab === "mechanics" && <MechanicReport />}
      </div>
    </div>
  );
}
