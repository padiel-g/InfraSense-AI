"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Radio, Bell, AlertTriangle,
  Users, Trash2, FileText, ChevronLeft, ChevronRight, Camera,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { id: string; label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/sensors",   label: "Sensors",   icon: Radio },
      { href: "/alerts",    label: "Alerts",    icon: Bell },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      { href: "/incidents", label: "Incidents",       icon: AlertTriangle },
      { href: "/crews",     label: "Crews",           icon: Users },
      { href: "/dumping",   label: "Dumping Reports", icon: Trash2 },
    ],
  },
  {
    id: "public",
    label: "Public",
    items: [
      { href: "/report",   label: "Public Report",   icon: FileText },
      { href: "/resident", label: "Resident Portal", icon: Camera },
    ],
  },
];

const SIDEBAR_FONT =
  "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";

const SURFACE = {
  bg: "bg-[rgba(255,255,255,0.85)] dark:bg-[rgba(15,23,42,0.85)]",
  border: "border-r border-r-[rgba(0,0,0,0.06)] dark:border-r-[rgba(255,255,255,0.06)]",
  activeBg: "bg-[rgba(37,99,235,0.08)] dark:bg-[rgba(59,130,246,0.14)]",
  hoverBg: "hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.05)]",
  itemColor: "text-[#334155] dark:text-slate-200",
  activeColor: "text-[#2563eb] dark:text-blue-400",
  iconColor: "text-[#64748b] dark:text-slate-400",
  activeIconColor: "text-[#2563eb] dark:text-blue-400",
  sectionLabelColor: "text-[#94a3b8] dark:text-slate-500",
  logoColor: "text-[#1e40af] dark:text-blue-400",
};

function NavLink({
  item, active, collapsed,
}: { item: NavItem; active: boolean; collapsed: boolean }) {
  const { href, label, icon: Icon } = item;

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      style={{
        padding: collapsed ? "10px" : "10px 16px",
        marginBottom: 2,
        borderLeft: active ? "3px solid #2563eb" : "3px solid transparent",
        borderRadius: active ? "0 8px 8px 0" : 8,
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        transition: "all 0.15s ease",
      }}
      className={cn(
        "group relative flex items-center gap-3",
        collapsed && "justify-center",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? cn(SURFACE.activeBg, SURFACE.activeColor)
          : cn(SURFACE.itemColor, SURFACE.hoverBg)
      )}
    >
      <Icon
        size={20}
        strokeWidth={active ? 2.25 : 2}
        className={cn("shrink-0", active ? SURFACE.activeIconColor : SURFACE.iconColor)}
      />
      {!collapsed && <span className="truncate">{label}</span>}

      {collapsed && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap",
            "rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground",
            "opacity-0 -translate-x-1 transition-all duration-150 ease-out",
            "group-hover:opacity-100 group-hover:translate-x-0",
            "shadow-card"
          )}
        >
          {label}
        </span>
      )}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      style={{
        fontFamily: SIDEBAR_FONT,
        WebkitBackdropFilter: "blur(12px)",
        backdropFilter: "blur(12px)",
      }}
      className={cn(
        "hidden md:flex flex-col",
        SURFACE.bg,
        SURFACE.border,
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div
        style={{ padding: collapsed ? "20px 8px" : "20px 16px" }}
        className="flex h-[60px] items-center gap-2 border-b border-b-[rgba(0,0,0,0.06)] dark:border-b-[rgba(255,255,255,0.06)]"
      >
        {!collapsed && (
          <span
            style={{ fontSize: 18, fontWeight: 700 }}
            className={cn("truncate tracking-tight", SURFACE.logoColor)}
          >
            IMADS
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "ml-auto rounded-md p-1.5",
            SURFACE.iconColor,
            SURFACE.hoverBg,
            "transition-colors duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav style={{ padding: "16px 12px" }} className="flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.id}>
            {!collapsed ? (
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  marginTop: gi === 0 ? 0 : 24,
                  marginBottom: 8,
                  paddingLeft: 16,
                }}
                className={cn("uppercase", SURFACE.sectionLabelColor)}
              >
                {group.label}
              </p>
            ) : (
              gi > 0 && (
                <div
                  className="mx-2 my-3 h-px bg-[rgba(0,0,0,0.06)] dark:bg-[rgba(255,255,255,0.06)]"
                  role="separator"
                  aria-hidden
                />
              )
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={pathname.startsWith(item.href)}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
