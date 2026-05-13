"use client";
import { Bell, Moon, Sun, LogOut, User } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAlerts } from "@/hooks/useDashboard";
import { useAuth } from "@/lib/authContext";
import { Button } from "@/components/ui/button";

const THEME_KEY = "munimonitor.theme";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export default function Header() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  const { data: alerts } = useAlerts();
  const { user, logout } = useAuth();
  const router = useRouter();
  const critical = alerts?.filter(
    (a) => a.severity === "critical" && !a.is_acknowledged
  ).length ?? 0;

  useEffect(() => {
    applyTheme(dark);
    try {
      window.localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* ignore quota / disabled storage */
    }
  }, [dark]);

  const handleLogout = useCallback(() => {
    logout();
    router.replace("/login");
  }, [logout, router]);

  // The User type doesn't declare `role`, but the API may include it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role: string | undefined = (user as any)?.role;

  return (
    <header className="flex h-14 items-center border-b bg-card px-4 gap-4 shadow-card">
      <span className="font-bold text-primary md:hidden tracking-tight">MuniMonitor</span>

      <div className="ml-auto flex items-center gap-1">
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            title="Notifications"
            className="rounded-full"
          >
            <Bell className="h-5 w-5" />
          </Button>
          {critical > 0 && (
            <span className="absolute right-0 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-card">
              {critical}
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDark((v) => !v)}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="rounded-full"
        >
          {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {user && (
          <div className="flex items-center gap-2 pl-3 ml-1 border-l">
            <div className="hidden sm:flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center">
                <User className="h-4 w-4 text-blue-600 dark:text-blue-300" />
              </div>
              <div className="hidden md:block leading-tight">
                <p className="text-xs font-semibold">{user.full_name}</p>
                {role && (
                  <p className="text-[11px] text-muted-foreground capitalize">{role}</p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-full"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
