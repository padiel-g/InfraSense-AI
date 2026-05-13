"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Radio, Bell, AlertTriangle, Users, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sensors",   label: "Sensors",   icon: Radio },
  { href: "/alerts",    label: "Alerts",    icon: Bell },
  { href: "/incidents", label: "Incidents", icon: AlertTriangle },
  { href: "/crews",     label: "Crews",     icon: Users },
  { href: "/resident",  label: "Report",    icon: Trash2 },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t bg-card">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center py-2 text-xs gap-1",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
