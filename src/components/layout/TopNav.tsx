import { cn } from "@/lib/utils";
import { FileText, Users, Wrench, BarChart3, Menu, X, LogOut, UserCog } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface TopNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole?: 'admin' | 'mechanic';
}

const allNavItems = [
  { id: "work-orders", label: "Radni nalozi", icon: FileText, roles: ['admin', 'mechanic'] },
  { id: "customers", label: "Klijenti", icon: Users, roles: ['admin', 'mechanic'] },
  { id: "mechanics", label: "Mehaničari", icon: Wrench, roles: ['admin'] },
  { id: "analytics", label: "Analitika", icon: BarChart3, roles: ['admin'] },
  { id: "users", label: "Korisnici", icon: UserCog, roles: ['admin'] },
];

export function TopNav({ currentPage, onNavigate, userRole = 'admin' }: TopNavProps) {
  const { logout, user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Filter nav items based on user role
  const navItems = allNavItems.filter(item => item.roles.includes(userRole));

  const handleNavigate = (page: string) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    setMobileMenuOpen(false);
  };

  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 sm:h-16">
          {/* Logo */}
          <div className="flex items-center">
            <span className="text-lg sm:text-xl font-bold text-gray-900">AS-NORD Nalozi</span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 lg:px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                    currentPage === item.id
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              );
            })}

            {/* Logout button - Desktop */}
            <div className="ml-2 pl-2 border-l border-gray-200 flex items-center gap-2">
              <span className="text-sm text-gray-500 hidden lg:inline">{user?.username}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="h-9 w-9"
                title="Odjava"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="h-10 w-10"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-t shadow-lg">
          <div className="px-3 py-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={cn(
                    "flex items-center gap-3 w-full px-4 py-3 rounded-lg text-base font-medium transition-colors",
                    currentPage === item.id
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </button>
              );
            })}

            {/* Logout button - Mobile */}
            <div className="pt-2 mt-2 border-t border-gray-200">
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-base font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-5 w-5" />
                Odjava ({user?.username})
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
