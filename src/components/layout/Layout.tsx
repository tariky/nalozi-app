import type { ReactNode } from "react";
import { TopNav } from "./TopNav";

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole?: "admin" | "mechanic";
}

export function Layout({ children, currentPage, onNavigate, userRole }: LayoutProps) {
  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      {/* Top Navigation */}
      <TopNav
        currentPage={currentPage}
        onNavigate={onNavigate}
        userRole={userRole}
      />

      {/* Main Content */}
      <main className="flex-1">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
