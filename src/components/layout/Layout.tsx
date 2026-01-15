import type { ReactNode } from "react";
import { TopNav } from "./TopNav";

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole?: 'admin' | 'mechanic';
}

export function Layout({ children, currentPage, onNavigate, userRole }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav currentPage={currentPage} onNavigate={onNavigate} userRole={userRole} />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {children}
      </main>
    </div>
  );
}
