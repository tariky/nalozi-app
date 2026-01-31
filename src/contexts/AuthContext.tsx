import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { authApi, setCsrfToken } from "@/lib/api";
import type { AuthUser } from "@/types";

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isMechanic: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    setLoading(true);
    const result = await authApi.me();
    if (result.success && result.data) {
      const { csrf_token, ...userData } = result.data as AuthUser & { csrf_token?: string };
      setUser(userData);
      if (csrf_token) {
        setCsrfToken(csrf_token);
      }
    } else {
      setUser(null);
      setCsrfToken(null);
    }
    setLoading(false);
  };

  const login = async (username: string, password: string) => {
    const result = await authApi.login(username, password);
    if (result.success && result.data) {
      const { csrf_token, ...userData } = result.data as AuthUser & { csrf_token?: string };
      setUser(userData);
      if (csrf_token) {
        setCsrfToken(csrf_token);
      }
      return { success: true };
    }
    return { success: false, error: result.error || "Greška pri prijavi" };
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
    setCsrfToken(null);
  };

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    isAdmin: user?.role === "admin",
    isMechanic: user?.role === "mechanic",
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
