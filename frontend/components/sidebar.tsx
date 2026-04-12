"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import type { Session } from "@/types";

interface SidebarProps {
  sessions?: Session[];
  activeSessionId?: string | null;
  onNewChat?: () => void;
  onSessionClick?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onCollapse?: (collapsed: boolean) => void;
  chatPath?: string;
  graphPath?: string;
}

// ── Session item with right-click context menu ────────────────────────────────
function SidebarSessionItem({ session, isActive, onClick, onDelete }: {
  session: Session; isActive: boolean; onClick: () => void; onDelete?: () => void;
}) {
  const date = new Date(session.updated_at ?? session.created_at);
  const isToday = new Date().toDateString() === date.toDateString();
  const label = isToday
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const hasUploadedDocs = (session.session_memory?.uploaded_files || []).length > 0;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  return (
    <>
      <button onClick={onClick}
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        style={{ width: "100%", display: "flex", flexDirection: "column", gap: 2, padding: "9px 12px", borderRadius: 10, border: "none", textAlign: "left", cursor: "pointer", fontFamily: "Manrope, sans-serif", transition: "all 0.15s", background: isActive ? "#1f1f1f" : "transparent", color: isActive ? "#ececec" : "#555" }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "#161616"; e.currentTarget.style.color = "#bbb"; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#555"; } }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.title}</span>
          {hasUploadedDocs && (
            <span title="Document uploaded" style={{ color: "#a78bfa", fontSize: 12, lineHeight: 1 }}>
              📄
            </span>
          )}
        </span>
        <span style={{ fontSize: 10, color: "#6b6b7e" }}>{label}</span>
      </button>
      {menu && (
        <div
          style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 9999, background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.25)", borderRadius: 10, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.6)", minWidth: 160 }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { setMenu(null); onClick(); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, color: "#cbc3d9", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.background = "#252525"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>chat_bubble</span>
            Open
          </button>
          {onDelete && (
            <button onClick={() => { setMenu(null); onDelete(); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, color: "#ef4444", textAlign: "left" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.08)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>delete</span>
              Delete
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default function Sidebar({
  sessions = [],
  activeSessionId = null,
  onNewChat,
  onSessionClick,
  onDeleteSession,
  onCollapse,
  chatPath = "/student",
  graphPath = "/student/graph",
}: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, clearAuth } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const displayName = hydrated ? (user?.username?.split("@")[0] ?? "Student") : "...";
  const isGraph = pathname?.includes("/graph");

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    onCollapse?.(next);
  };

  const handleLogout = () => {
    clearAuth();
    document.cookie = "auth_token=; path=/; max-age=0";
    document.cookie = "user_role=; path=/; max-age=0";
    router.replace("/login");
  };

  const W = collapsed ? 60 : 252;

  const navItems = [
    { id: "chat",  icon: "chat_bubble", label: "Chat",            path: chatPath },
    { id: "graph", icon: "hub",         label: "Knowledge Graph", path: graphPath },
  ];

  return (
    <aside style={{
      width: W,
      flexShrink: 0,
      position: "fixed",
      inset: "0 auto 0 0",
      background: "#111",
      borderRight: "1px solid rgba(73,68,86,0.1)",
      display: "flex",
      flexDirection: "column",
      padding: collapsed ? "14px 10px" : 14,
      zIndex: 40,
      fontFamily: "Manrope, sans-serif",
      transition: "width 0.25s cubic-bezier(0.16,1,0.3,1)",
      overflow: "hidden",
    }}>

      {/* Logo + collapse button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", padding: collapsed ? "6px 0 18px" : "6px 0 18px", gap: 8 }}>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ color: "white", fontSize: 15, fontVariationSettings: "'FILL' 1" }}>school</span>
            </div>
            <span style={{ fontSize: 17, fontWeight: 800, color: "#ececec", letterSpacing: "-0.035em", whiteSpace: "nowrap" }}>Datalingo</span>
          </div>
        )}
        {collapsed && (
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span className="material-symbols-outlined" style={{ color: "white", fontSize: 15, fontVariationSettings: "'FILL' 1" }}>school</span>
          </div>
        )}
        {/* Collapse toggle — only visible when expanded, floats right */}
        {!collapsed && (
          <button onClick={toggle}
            title="Collapse sidebar"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#6b6b7e", padding: 4, borderRadius: 8, display: "flex", alignItems: "center", transition: "all 0.15s", flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#1a1a1a"; e.currentTarget.style.color = "#cbc3d9"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#333"; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>left_panel_close</span>
          </button>
        )}
      </div>

      {/* Expand button — only visible when collapsed */}
      {collapsed && (
        <button onClick={toggle}
          title="Expand sidebar"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6b6b7e", padding: "6px 0", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8, transition: "all 0.15s" }}
          onMouseEnter={e => { e.currentTarget.style.color = "#cbc3d9"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#333"; }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>right_panel_open</span>
        </button>
      )}

      {/* New Chat button */}
      {!collapsed ? (
        <button onClick={onNewChat || (() => router.push("/student"))}
          style={{ width: "100%", padding: "9px 14px", borderRadius: 12, border: "1px solid rgba(110,40,245,0.18)", background: "#1e1e1e", color: "#ececec", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10, transition: "all 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#222"}
          onMouseLeave={e => e.currentTarget.style.background = "#1a1a1a"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          New Chat
        </button>
      ) : (
        <button onClick={onNewChat || (() => router.push("/student"))}
          title="New Chat"
          style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid rgba(110,40,245,0.18)", background: "#1e1e1e", color: "#ececec", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10, transition: "all 0.15s", alignSelf: "center" }}
          onMouseEnter={e => e.currentTarget.style.background = "#222"}
          onMouseLeave={e => e.currentTarget.style.background = "#1a1a1a"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
        </button>
      )}

      {/* Nav items */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
        {navItems.map(item => {
          const isActive = pathname === item.path || (item.path === "/student/graph" && isGraph);
          return (
            <button key={item.id}
              onClick={() => router.push(item.path)}
              title={collapsed ? item.label : undefined}
              style={{
                display: "flex", alignItems: "center", gap: collapsed ? 0 : 10,
                padding: collapsed ? "9px 0" : "9px 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 10, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                textAlign: "left", transition: "all 0.15s",
                background: isActive ? "#1f1f1f" : "transparent",
                color: isActive ? "#ececec" : "#444",
                whiteSpace: "nowrap", overflow: "hidden",
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "#161616"; e.currentTarget.style.color = "#999"; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#444"; } }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>

      {/* Session list — only when expanded */}
      {!collapsed && sessions.length > 0 && (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "#666", fontWeight: 700, padding: "0 12px", marginBottom: 4, display: "block" }}>Recent</span>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {sessions.map(s => {
              const isActive = activeSessionId === s.id;
              return (
                <SidebarSessionItem key={s.id} session={s} isActive={isActive}
                  onClick={() => onSessionClick?.(s.id)}
                  onDelete={onDeleteSession ? () => onDeleteSession(s.id) : undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* User card */}
      <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid rgba(73,68,86,0.08)" }}>
        <button onClick={handleLogout}
          title={collapsed ? "Logout" : undefined}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: collapsed ? 0 : 10, padding: collapsed ? "9px 0" : "9px 10px", justifyContent: collapsed ? "center" : "flex-start", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#161616"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "white" }}>{displayName[0]?.toUpperCase()}</span>
          </div>
          {!collapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#ececec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                <div style={{ fontSize: 10, color: "#666" }}>student</div>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: "#666" }}>logout</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}