import { cn } from "@/lib/utils";
import {
  FileText,
  Users,
  Wrench,
  BarChart3,
  UserCog,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/contexts/CompanySettingsContext";
import logoSrc from "@/logo.svg";

interface TopNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole?: "admin" | "mechanic";
}

const allNavItems = [
  { id: "work-orders", label: "Radni nalozi", icon: FileText, roles: ["admin", "mechanic"] },
  { id: "customers", label: "Klijenti", icon: Users, roles: ["admin", "mechanic"] },
  { id: "mechanics", label: "Mehaničari", icon: Wrench, roles: ["admin"] },
  { id: "analytics", label: "Analitika", icon: BarChart3, roles: ["admin"] },
  { id: "users", label: "Korisnici", icon: UserCog, roles: ["admin"] },
  { id: "settings", label: "Postavke", icon: Settings, roles: ["admin"] },
];

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function TopNav({ currentPage, onNavigate, userRole = "admin" }: TopNavProps) {
  const { logout, user } = useAuth();
  const { settings } = useCompanySettings();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = allNavItems.filter((item) => item.roles.includes(userRole));
  const logoImg = settings?.logo || logoSrc;
  const companyName = settings?.naziv || "AS-NORD";

  const handleNavigate = (page: string) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-background border-b border-border">
      {/* Desktop Navigation */}
      <div className="hidden md:block">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <img src={logoImg} alt={companyName} className="h-9 w-auto max-w-[160px] object-contain" />
          {settings?.naziv && (
            <span className="text-sm font-semibold text-foreground">{settings.naziv}</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={cn(
                  "relative flex items-center gap-2 px-5 py-4 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>

                {/* Active indicator */}
                {isActive && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[2px] bg-foreground" />
                )}
              </button>
            );
          })}
        </nav>

        {/* User Menu */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-foreground flex items-center justify-center">
            <span className="text-background text-xs font-semibold">
              {getInitials(user?.username || "U")}
            </span>
          </div>
          <span className="text-sm font-medium text-foreground">
            {user?.username}
          </span>
          <button
            onClick={handleLogout}
            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
            title="Odjava"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 h-14">
        <img src={logoImg} alt={companyName} className="h-8 w-auto max-w-[140px] object-contain" />

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-foreground"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-background">
          <nav className="py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors",
                    isActive
                      ? "text-foreground bg-muted"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </button>
              );
            })}

            {/* User Section */}
            <div className="border-t border-border mt-2 pt-2 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-foreground flex items-center justify-center">
                    <span className="text-background text-xs font-semibold">
                      {getInitials(user?.username || "U")}
                    </span>
                  </div>
                  <span className="text-sm font-medium">{user?.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Odjava
                </button>
              </div>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
