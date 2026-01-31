import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  FileText,
  Users,
  Wrench,
  BarChart3,
  UserCog,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Shield,
  User,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import logoSrc from "@/logo.svg";

interface SidebarProps {
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
];

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function getRoleLabel(role?: string): string {
  if (role === "admin") return "Administrator";
  if (role === "mechanic") return "Mehaničar";
  return "Korisnik";
}

export function Sidebar({ currentPage, onNavigate, userRole = "admin" }: SidebarProps) {
  const { logout, user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const navItems = allNavItems.filter((item) => item.roles.includes(userRole));

  const handleLogout = async () => {
    await logout();
  };

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0 transition-all duration-200 ease-out",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo Section */}
      <div className="h-16 flex items-start pt-2 justify-start border-b border-sidebar-border px-3">
        <img
          src={logoSrc}
          alt="AS-NORD"
          className={cn(
            "h-12 w-auto transition-all duration-200",
            collapsed && "h-8"
          )}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto sidebar-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          const isHovered = hoveredItem === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              className={cn(
                "relative w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                collapsed && "justify-center px-2"
              )}
            >
              {/* Active Indicator */}
              <div
                className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-0 bg-sidebar-primary transition-all duration-150",
                  isActive && "h-5",
                  isHovered && !isActive && "h-2"
                )}
              />

              {/* Icon */}
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-transform duration-150",
                  (isActive || isHovered) && "scale-105"
                )}
              />

              {/* Label */}
              <span
                className={cn(
                  "text-left whitespace-nowrap transition-all duration-200 overflow-hidden",
                  collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                )}
              >
                {item.label}
              </span>

              {/* Tooltip for collapsed state */}
              {collapsed && (
                <div
                  className={cn(
                    "absolute left-full ml-2 px-2.5 py-1.5 bg-popover border border-border text-popover-foreground text-sm whitespace-nowrap z-50 pointer-events-none transition-all duration-150",
                    isHovered ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1"
                  )}
                >
                  {item.label}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-sidebar-border p-2 space-y-1">
        {/* User Section */}
        <div
          className={cn(
            "flex items-center gap-3 px-2 py-2 transition-all duration-200",
            collapsed && "flex-col gap-2 px-0"
          )}
        >
          {/* Avatar */}
          <div className="w-8 h-8 bg-sidebar-primary flex items-center justify-center shrink-0">
            <span className="text-sidebar-primary-foreground text-xs font-semibold">
              {getInitials(user?.username || "U")}
            </span>
          </div>

          {/* User Info */}
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-sidebar-foreground truncate">
                {user?.username}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {userRole === "admin" ? (
                  <Shield className="h-3 w-3" />
                ) : (
                  <User className="h-3 w-3" />
                )}
                <span>{getRoleLabel(userRole)}</span>
              </div>
            </div>
          )}

          {/* Logout Button */}
          {!collapsed && (
            <button
              onClick={handleLogout}
              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-150"
              title="Odjava"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Collapsed: Logout and Collapse buttons stacked */}
        {collapsed && (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={handleLogout}
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-150"
              title="Odjava"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCollapsed(false)}
              className="p-2 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
              title="Proširi"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Collapse Toggle - only when expanded */}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="w-full flex items-center gap-3 px-2 py-2 text-sm text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Smanji</span>
          </button>
        )}
      </div>
    </aside>
  );
}
