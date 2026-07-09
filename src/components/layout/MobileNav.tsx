import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  FileText,
  Users,
  Wrench,
  BarChart3,
  UserCog,
  LogOut,
  Menu,
  X,
  Shield,
  User,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import logoSrc from "@/logo.svg";

interface MobileNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole?: "admin" | "mechanic";
}

const allNavItems = [
  {
    id: "work-orders",
    label: "Nalozi",
    fullLabel: "Radni nalozi",
    icon: FileText,
    roles: ["admin", "mechanic"],
  },
  {
    id: "customers",
    label: "Klijenti",
    fullLabel: "Klijenti",
    icon: Users,
    roles: ["admin", "mechanic"],
  },
  {
    id: "mechanics",
    label: "Mehaničari",
    fullLabel: "Mehaničari",
    icon: Wrench,
    roles: ["admin"],
  },
  {
    id: "analytics",
    label: "Analitika",
    fullLabel: "Analitika",
    icon: BarChart3,
    roles: ["admin"],
  },
  {
    id: "users",
    label: "Korisnici",
    fullLabel: "Korisnici",
    icon: UserCog,
    roles: ["admin"],
  },
];

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function getRoleLabel(role?: string): string {
  if (role === "admin") return "Administrator";
  if (role === "mechanic") return "Mehaničar";
  return "Korisnik";
}

export function MobileNav({ currentPage, onNavigate, userRole = "admin" }: MobileNavProps) {
  const { logout, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = allNavItems.filter((item) => item.roles.includes(userRole));

  // Show first 4 items in bottom bar, rest in overflow menu
  const primaryItems = navItems.slice(0, 4);
  const hasOverflow = navItems.length > 4;

  const handleNavigate = (page: string) => {
    onNavigate(page);
    setMenuOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    setMenuOpen(false);
  };

  return (
    <>
      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b border-border z-40 flex items-center justify-between px-4">
        <img src={logoSrc} alt="AutoNalog" className="h-10 w-auto" />

        <button
          onClick={() => setMenuOpen(true)}
          className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-background border-t border-border z-40 safe-area-inset-bottom">
        <div className="flex items-center justify-around h-full px-2">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={cn(
                  "flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-all duration-200",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <div className="relative">
                  <Icon
                    className={cn(
                      "h-5 w-5 transition-transform duration-200",
                      isActive && "scale-110"
                    )}
                  />
                  {isActive && (
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-foreground rounded-full" />
                  )}
                </div>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}

          {/* More button if there are overflow items */}
          {hasOverflow && (
            <button
              onClick={() => setMenuOpen(true)}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-all duration-200",
                menuOpen ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <Menu className="h-5 w-5" />
              <span className="text-[10px] font-medium">Više</span>
            </button>
          )}
        </div>
      </nav>

      {/* Fullscreen Menu Overlay */}
      <div
        className={cn(
          "md:hidden fixed inset-0 bg-background z-50 transition-all duration-300",
          menuOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
      >
        {/* Menu Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-4">
          <img src={logoSrc} alt="AutoNalog" className="h-10 w-auto" />

          <button
            onClick={() => setMenuOpen(false)}
            className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Menu Content */}
        <div className="flex flex-col h-[calc(100%-56px)]">
          {/* Navigation Items */}
          <div className="flex-1 py-4 px-4 space-y-1 overflow-y-auto">
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={cn(
                    "w-full flex items-center gap-4 px-4 py-4 text-base transition-all duration-200",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                  style={{
                    animationDelay: `${index * 50}ms`,
                    animation: menuOpen ? "slideInLeft 0.3s ease-out forwards" : "none",
                  }}
                >
                  <div className="relative">
                    {isActive && (
                      <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-foreground" />
                    )}
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-medium">{item.fullLabel}</span>
                </button>
              );
            })}
          </div>

          {/* User Section */}
          <div className="border-t border-border p-4">
            <div className="flex items-center gap-4 px-4 py-4 bg-accent/30">
              <div className="w-11 h-11 bg-primary flex items-center justify-center shrink-0">
                <span className="text-primary-foreground text-sm font-semibold">
                  {getInitials(user?.username || "U")}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">
                  {user?.username}
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {userRole === "admin" ? (
                    <Shield className="h-3.5 w-3.5" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                  <span>{getRoleLabel(userRole)}</span>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="p-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add animation keyframes via style tag */}
      <style>{`
        @keyframes slideInLeft {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .safe-area-inset-bottom {
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
      `}</style>
    </>
  );
}
