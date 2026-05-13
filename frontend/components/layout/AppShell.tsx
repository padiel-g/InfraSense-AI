"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import Sidebar from "./Sidebar";
import Header from "./Header";
import AlertBanner from "./AlertBanner";
import BottomNav from "./BottomNav";
import { Loader2 } from "lucide-react";

// Routes that don't require authentication and don't render the app shell
const PUBLIC_ROUTES = ["/login", "/register", "/resident"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, isPublic, router]);

  // Public pages (login, resident portal) — no shell
  if (isPublic) {
    return <>{children}</>;
  }

  // Still checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Not authenticated — blank while redirecting
  if (!isAuthenticated) {
    return null;
  }

  // Authenticated — full app shell
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AlertBanner />
        <Header />
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
