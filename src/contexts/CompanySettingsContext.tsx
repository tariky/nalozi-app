import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { settingsApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { CompanySettings } from "@/types";

interface CompanySettingsContextType {
  settings: CompanySettings | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CompanySettingsContext = createContext<CompanySettingsContextType | null>(null);

export function CompanySettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await settingsApi.getCompany();
    if (result.success && result.data) {
      setSettings(result.data);
    }
    setLoading(false);
  }, []);

  // Fetch once the user is authenticated; clear on logout.
  useEffect(() => {
    if (user) {
      refresh();
    } else {
      setSettings(null);
    }
  }, [user, refresh]);

  return (
    <CompanySettingsContext.Provider value={{ settings, loading, refresh }}>
      {children}
    </CompanySettingsContext.Provider>
  );
}

export function useCompanySettings() {
  const context = useContext(CompanySettingsContext);
  if (!context) {
    throw new Error("useCompanySettings must be used within a CompanySettingsProvider");
  }
  return context;
}
