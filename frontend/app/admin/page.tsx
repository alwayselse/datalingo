"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminOverview {
  total_students: number;
  active_users: number;
  total_messages: number;
  messages_today: number;
  sessions_today: number;
  active_7d: number;
  errors_today: number;
  tokens_today: number;
  tokens_total: number;
}

interface SystemHealth {
  cpu_percent: number;
  ram_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  uptime_seconds: number;
  platform: string;
}

interface ServiceHealth {
  postgres: { status: string };
  qdrant: { status: string; points_count?: number };
  embedding: { status: string };
}

interface FrequencyPoint {
  date: string;
  user_messages: number;
  assistant_messages: number;
}

interface ApiLog {
  id: string;
  username: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  endpoint: string;
  latency_ms: number;
  created_at: string;
}

interface ErrorLog {
  id: string;
  endpoint: string;
  method: string;
  error_type: string;
  error_message: string;
  traceback: string;
  created_at: string;
}

interface AdminUser {
  user_id: string;
  name?: string | null;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
  username: string;
  session_title: string;
}

interface BADocUploadSummary {
  total_student_chunks: number;
  students_with_uploads: number;
  synced_chunks: number;
  pending_chunks: number;
  last_upload_at: string | null;
}

interface BADocPerStudent {
  user_id: string;
  name: string | null;
  username: string | null;
  chunk_count: number;
  filenames: string[];
  last_upload: string | null;
}

interface BADocQdrantCollection {
  name: string;
  point_count: number;
}

interface BADocEmbeddingService {
  status: "online" | "offline";
  latency_ms: number | null;
}

interface BADocRecentError {
  message: string;
  created_at: string;
}

interface BADocumentStats {
  upload_summary: BADocUploadSummary;
  per_student: BADocPerStudent[];
  qdrant_collections: BADocQdrantCollection[];
  embedding_service: BADocEmbeddingService;
  recent_errors: BADocRecentError[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtRelativeTime(iso: string | null) {
  if (!iso) return "-";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "-";
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 0) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function truncateFilenames(names: string[]) {
  const full = names.join(", ");
  if (full.length <= 30) return { short: full, full };
  return { short: `${full.slice(0, 30)}...`, full };
}

// ── Gauge Component ───────────────────────────────────────────────────────────

function CircleGauge({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 10px" }}>
        <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="60" cy="60" r={r} fill="transparent" stroke="#2a2a2a" strokeWidth="8" />
          <circle cx="60" cy="60" r={r} fill="transparent" stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "Manrope, sans-serif", color: "#e2e2e2" }}>{value}%</span>
          <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#494456", fontFamily: "Manrope, sans-serif" }}>{label}</span>
        </div>
      </div>
    </div>
  );
}

// ── Mini Line Chart ───────────────────────────────────────────────────────────

function MiniLineChart({ data }: { data: FrequencyPoint[] }) {
  if (!data.length) return <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 12 }}>No data yet</div>;

  const maxVal = Math.max(...data.map(d => d.user_messages + d.assistant_messages), 1);
  const W = 600; const H = 160; const PAD = 20;

  const points = data.map((d, i) => {
    const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - ((d.user_messages) / maxVal) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");

  const areaPoints = `${PAD},${H - PAD} ` + points + ` ${PAD + ((data.length - 1) / Math.max(data.length - 1, 1)) * (W - PAD * 2)},${H - PAD}`;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 180, overflow: "visible" }}>
        <defs>
          <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6e28f5" />
            <stop offset="100%" stopColor="#cfbdff" />
          </linearGradient>
          <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6e28f5" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#6e28f5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#areaGrad)" />
        <polyline points={points} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
          const y = H - PAD - (d.user_messages / maxVal) * (H - PAD * 2);
          return <circle key={i} cx={x} cy={y} r="3.5" fill="#cfbdff" />;
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {data.map((d, i) => (
          <span key={i} style={{ fontSize: 9, color: "#333", fontFamily: "Manrope, sans-serif", textTransform: "uppercase" }}>
            {new Date(d.date).toLocaleDateString([], { weekday: "short" })}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Token Bar Chart ───────────────────────────────────────────────────────────

function TokenBarChart({ data }: { data: { date: string; total_tokens: number; model: string }[] }) {
  if (!data.length) return <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 12 }}>No data yet</div>;

  // Group by date
  const byDate: Record<string, number> = {};
  data.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + d.total_tokens; });
  const dates = Object.keys(byDate).slice(-7);
  const maxVal = Math.max(...dates.map(d => byDate[d]), 1);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 180, padding: "0 4px" }}>
      {dates.map((date, i) => {
        const pct = (byDate[date] / maxVal) * 100;
        const isMax = byDate[date] === maxVal;
        return (
          <div key={date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 9, color: isMax ? "#cfbdff" : "#333", fontFamily: "Manrope, sans-serif" }}>{fmtTokens(byDate[date])}</span>
            <div style={{ width: "100%", height: `${pct}%`, background: isMax ? "linear-gradient(to top, #6e28f5, #cfbdff)" : "#2a2a2a", borderRadius: "4px 4px 0 0", transition: "height 0.8s ease", minHeight: 4 }} />
            <span style={{ fontSize: 9, color: "#333", fontFamily: "Manrope, sans-serif" }}>{new Date(date).toLocaleDateString([], { weekday: "short" })}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent, danger }: { icon: string; label: string; value: string | number; sub?: string; accent?: string; danger?: boolean }) {
  return (
    <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "20px 22px", border: danger ? "1px solid rgba(239,68,68,0.15)" : "1px solid rgba(73,68,86,0.1)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14, transition: "border-color 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = danger ? "rgba(239,68,68,0.3)" : "rgba(110,40,245,0.3)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = danger ? "rgba(239,68,68,0.15)" : "rgba(73,68,86,0.1)"}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: danger ? "rgba(239,68,68,0.1)" : "rgba(110,40,245,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: danger ? "#ef4444" : (accent || "#6e28f5"), fontVariationSettings: "'FILL' 1" }}>{icon}</span>
        </div>
        {sub && <span style={{ fontSize: 10, fontWeight: 700, color: danger ? "#ef4444" : "#10b981", fontFamily: "Manrope, sans-serif" }}>{sub}</span>}
      </div>
      <div>
        <p style={{ fontSize: 28, fontWeight: 800, fontFamily: "Manrope, sans-serif", color: danger ? "#ef4444" : "#e2e2e2", margin: 0, letterSpacing: "-0.03em" }}>{value}</p>
        <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#494456", fontFamily: "Manrope, sans-serif", margin: "4px 0 0" }}>{label}</p>
      </div>
    </div>
  );
}

// ── Nav Item ──────────────────────────────────────────────────────────────────

function NavItem({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: active ? 700 : 500, textAlign: "left", transition: "all 0.15s", background: active ? "rgba(110,40,245,0.15)" : "transparent", color: active ? "#cfbdff" : "#6b6b6b" }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#161616"; e.currentTarget.style.color = "#aaa"; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6b6b6b"; } }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span style={{ fontSize: 10, fontWeight: 700, background: "#ef4444", color: "white", borderRadius: 20, padding: "1px 6px", fontFamily: "Manrope, sans-serif" }}>{badge}</span>
      )}
    </button>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

type Tab = "dashboard" | "messages" | "api-logs" | "errors" | "system" | "users";
type NewUserRole = "student" | "teacher";

export default function AdminPage() {
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  // Data state
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [system, setSystem] = useState<SystemHealth | null>(null);
  const [services, setServices] = useState<ServiceHealth | null>(null);
  const [frequency, setFrequency] = useState<FrequencyPoint[]>([]);
  const [tokenSummary, setTokenSummary] = useState<any[]>([]);
  const [apiLogs, setApiLogs] = useState<ApiLog[]>([]);
  const [apiPage, setApiPage] = useState(1);
  const [apiTotal, setApiTotal] = useState(0);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [errorPage, setErrorPage] = useState(1);
  const [errorTotal, setErrorTotal] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgPage, setMsgPage] = useState(1);
  const [msgTotal, setMsgTotal] = useState(0);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<NewUserRole>("student");
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState("");
  const [createUserSuccess, setCreateUserSuccess] = useState("");
  const [exportingUsers, setExportingUsers] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [baDocStats, setBADocStats] = useState<BADocumentStats | null>(null);
  const [baDocRefreshing, setBADocRefreshing] = useState(false);
  const [baDocLastUpdated, setBADocLastUpdated] = useState<string | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && (!token || !user)) router.replace("/login");
    if (mounted && user && (user as any).role !== "admin") router.replace("/student");
  }, [mounted, token, user]);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchDashboard = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const [ovRes, sysRes, svcRes, freqRes, tokRes, baRes] = await Promise.all([
        fetch(`${API}/admin/overview`, { headers }),
        fetch(`${API}/admin/system`, { headers }),
        fetch(`${API}/admin/services/health`, { headers }),
        fetch(`${API}/admin/messages/frequency?days=7`, { headers }),
        fetch(`${API}/admin/logs/api-usage/summary?days=7`, { headers }),
        fetch(`${API}/admin/ba/document-stats`, { headers }),
      ]);
      if (ovRes.ok)   setOverview(await ovRes.json());
      if (sysRes.ok)  setSystem(await sysRes.json());
      if (svcRes.ok)  setServices(await svcRes.json());
      if (freqRes.ok) setFrequency(await freqRes.json());
      if (tokRes.ok)  setTokenSummary(await tokRes.json());
      if (baRes.ok) {
        setBADocStats(await baRes.json());
        setBADocLastUpdated(new Date().toISOString());
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  const fetchApiLogs = useCallback(async (page = 1) => {
    if (!token) return;
    const res = await fetch(`${API}/admin/logs/api-usage?page=${page}&limit=50`, { headers });
    if (res.ok) { const d = await res.json(); setApiLogs(d.logs); setApiTotal(d.total); }
  }, [token]);

  const fetchErrors = useCallback(async (page = 1) => {
    if (!token) return;
    const res = await fetch(`${API}/admin/logs/errors?page=${page}&limit=50`, { headers });
    if (res.ok) { const d = await res.json(); setErrorLogs(d.errors); setErrorTotal(d.total); }
  }, [token]);

  const fetchMessages = useCallback(async (page = 1) => {
    if (!token) return;
    const res = await fetch(`${API}/admin/messages?page=${page}`, { headers });
    if (res.ok) { const d = await res.json(); setMessages(d.messages); setMsgTotal(d.total); }
  }, [token]);

  const fetchUsers = useCallback(async (page = 1, search = "") => {
    if (!token) return;
    const q = search ? `&search=${encodeURIComponent(search)}` : "";
    const res = await fetch(`${API}/admin/users?page=${page}${q}`, { headers });
    if (res.ok) { const d = await res.json(); setUsers(d.users); setUserTotal(d.total); }
  }, [token]);

  const fetchBADocumentStats = useCallback(async () => {
    if (!token) return;
    setBADocRefreshing(true);
    try {
      const res = await fetch(`${API}/admin/ba/document-stats`, { headers });
      if (!res.ok) {
        console.warn(`[Admin] BA document stats returned ${res.status}`);
        return;
      }
      const d = await res.json();
      setBADocStats(d);
      setBADocLastUpdated(new Date().toISOString());
    } catch (error) {
      console.error("[Admin] failed to refresh BA doc stats", error);
    } finally {
      setBADocRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  useEffect(() => {
    if (activeTab === "api-logs") fetchApiLogs(apiPage);
    if (activeTab === "errors")   fetchErrors(errorPage);
    if (activeTab === "messages") fetchMessages(msgPage);
    if (activeTab === "users")    fetchUsers(userPage, userSearch);
  }, [activeTab, apiPage, errorPage, msgPage, userPage]);

  const handleLogout = () => {
    clearAuth();
    document.cookie = "auth_token=; path=/; max-age=0";
    document.cookie = "user_role=; path=/; max-age=0";
    router.replace("/login");
  };

  const toggleUserStatus = async (userId: string, current: boolean) => {
    await fetch(`${API}/admin/users/${userId}/status`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !current }) });
    fetchUsers(userPage, userSearch);
  };

  const deleteUser = async (userId: string) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    await fetch(`${API}/admin/users/${userId}`, { method: "DELETE", headers });
    fetchUsers(userPage, userSearch);
  };

  const createUser = async () => {
    if (!token || creatingUser) return;

    const payload = {
      name: newUserName.trim() || null,
      email: newUserEmail.trim(),
      username: newUserUsername.trim(),
      password: newUserPassword,
      role: newUserRole,
    };

    if (!payload.email || !payload.username || !payload.password) {
      setCreateUserSuccess("");
      setCreateUserError("Email, username, and password are required.");
      return;
    }

    setCreatingUser(true);
    setCreateUserError("");
    setCreateUserSuccess("");

    try {
      const res = await fetch(`${API}/admin/users`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || `Failed to create user (${res.status})`);
      }

      setNewUserName("");
      setNewUserEmail("");
      setNewUserUsername("");
      setNewUserPassword("");
      setNewUserRole("student");
      setCreateUserSuccess(`Created ${payload.role} account for ${payload.username}.`);

      setUserPage(1);
      await Promise.all([fetchUsers(1, userSearch), fetchDashboard()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create user.";
      setCreateUserError(message);
    } finally {
      setCreatingUser(false);
    }
  };

  const exportUsers = async () => {
    if (!token || exportingUsers) return;
    setExportingUsers(true);
    try {
      const res = await fetch(`${API}/admin/users/export`, { headers });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const fileUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = "datalingo_users.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (error) {
      console.error("[Admin] user export failed:", error);
      alert("Failed to export users. Please try again.");
    } finally {
      setExportingUsers(false);
    }
  };

  const displayName = mounted ? ((user as any)?.name?.split(" ")[0] || "Admin") : "...";

  const svcColor = (s: string) => s === "ok" ? "#10b981" : "#ef4444";
  const svcLabel = (s: string) => s === "ok" ? "Operational" : "Not Operational";
  const baMaxChunkCount = Math.max(...(baDocStats?.per_student || []).map(s => s.chunk_count), 1);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #0e0e0e; }
        .material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; display: inline-block; line-height: 1; vertical-align: middle; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 10px; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.3s ease forwards; }
        table { border-collapse: collapse; width: 100%; }
        th { padding: 10px 14px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #494456; font-family: Manrope, sans-serif; font-weight: 700; border-bottom: 1px solid #1f1f1f; }
        td { padding: 12px 14px; font-size: 13px; color: #cbc3d9; font-family: Manrope, sans-serif; border-bottom: 1px solid rgba(73,68,86,0.08); vertical-align: middle; }
        tr:hover td { background: rgba(110,40,245,0.03); }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#0e0e0e", color: "#e2e2e2", fontFamily: "Manrope, sans-serif" }}>

        {/* ── Sidebar ── */}
        <aside style={{ width: 260, flexShrink: 0, position: "fixed", inset: "0 auto 0 0", background: "#111", borderRight: "1px solid rgba(73,68,86,0.08)", display: "flex", flexDirection: "column", padding: "28px 14px 20px", zIndex: 40 }}>
          {/* Logo */}
          <div style={{ padding: "0 8px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ color: "white", fontSize: 16, fontVariationSettings: "'FILL' 1" }}>shield</span>
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 800, color: "#cfbdff", margin: 0, letterSpacing: "0.05em", textTransform: "uppercase" }}>Datalingo</p>
                <p style={{ fontSize: 10, color: "#333", margin: 0, fontWeight: 600 }}>Admin Console</p>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            <NavItem icon="dashboard" label="Dashboard" active={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")} />
            <NavItem icon="forum" label="Messages" active={activeTab === "messages"} onClick={() => { setActiveTab("messages"); fetchMessages(1); }} badge={overview?.messages_today} />
            <NavItem icon="terminal" label="API Logs" active={activeTab === "api-logs"} onClick={() => setActiveTab("api-logs")} />
            <NavItem icon="bug_report" label="Error Logs" active={activeTab === "errors"} onClick={() => setActiveTab("errors")} badge={overview?.errors_today} />
            <NavItem icon="monitor_heart" label="System Health" active={activeTab === "system"} onClick={() => setActiveTab("system")} />
            <NavItem icon="manage_accounts" label="User Management" active={activeTab === "users"} onClick={() => { setActiveTab("users"); fetchUsers(1, ""); }} />
          </nav>

          {/* User card */}
          <div style={{ paddingTop: 16, borderTop: "1px solid rgba(73,68,86,0.08)" }}>
            <button onClick={handleLogout}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#161616"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "white" }}>{displayName[0]?.toUpperCase()}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#e2e2e2", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</p>
                <p style={{ fontSize: 10, color: "#333", margin: 0 }}>Administrator</p>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: "#333" }}>logout</span>
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ marginLeft: 260, flex: 1, minHeight: "100vh", overflowY: "auto", padding: "36px 36px 60px" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 36 }}>
            <div>
              <h1 style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 34, fontStyle: "italic", fontWeight: 400, color: "#e2e2e2", margin: "0 0 6px" }}>
                {activeTab === "dashboard" && "Performance Architecture"}
                {activeTab === "messages" && "Message Stream"}
                {activeTab === "api-logs" && "API Usage Logs"}
                {activeTab === "errors" && "Error Logs"}
                {activeTab === "system" && "System Health"}
                {activeTab === "users" && "User Management"}
              </h1>
              <p style={{ fontSize: 12, color: "#494456", margin: 0, fontWeight: 600 }}>
                {activeTab === "dashboard" && "Real-time telemetry and platform monitoring"}
                {activeTab === "messages" && "All student and assistant messages across sessions"}
                {activeTab === "api-logs" && "Groq API calls, token usage, and latency"}
                {activeTab === "errors" && "Backend errors with full tracebacks"}
                {activeTab === "system" && "Server resources, services, and infrastructure"}
                {activeTab === "users" && "Manage student and staff accounts"}
              </p>
            </div>
            {activeTab === "dashboard" && (
              <button onClick={fetchDashboard}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 10, border: "1px solid rgba(73,68,86,0.2)", background: "#1a1a1a", color: "#cbc3d9", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, transition: "all 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(110,40,245,0.4)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(73,68,86,0.2)"}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15, animation: refreshing ? "spin 1s linear infinite" : "none" }}>refresh</span>
                Refresh
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </button>
            )}
          </div>

          {/* ── DASHBOARD TAB ── */}
          {activeTab === "dashboard" && (
            <div className="fade-up">
              {/* Stat cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
                <StatCard icon="group" label="Total students" value={overview?.total_students ?? "—"} sub={`${overview?.active_7d ?? 0} active 7d`} />
                <StatCard icon="forum" label="Messages today" value={fmtTokens(overview?.messages_today ?? 0)} sub={`${overview?.sessions_today ?? 0} sessions`} />
                <StatCard icon="database" label="Tokens today" value={fmtTokens(overview?.tokens_today ?? 0)} sub={`${fmtTokens(overview?.tokens_total ?? 0)} total`} />
                <StatCard icon="warning" label="Errors today" value={overview?.errors_today ?? "—"} danger />
              </div>

              {/* Charts row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, marginBottom: 28 }}>
                <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "24px 28px", border: "1px solid rgba(73,68,86,0.1)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#e2e2e2" }}>Message Frequency</h3>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#494456" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6e28f5", display: "inline-block" }} /> User messages
                      </span>
                    </div>
                  </div>
                  <MiniLineChart data={frequency} />
                </div>
                <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "24px 28px", border: "1px solid rgba(73,68,86,0.1)" }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 24px", color: "#e2e2e2" }}>Token Usage</h3>
                  <TokenBarChart data={tokenSummary} />
                </div>
              </div>

              {/* Services + Gauges row */}
              <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 }}>
                {/* Services */}
                <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "24px 28px", border: "1px solid rgba(73,68,86,0.1)", borderLeft: "3px solid #f59e0b" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
                    <span className="material-symbols-outlined" style={{ color: "#f59e0b", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>favorite</span>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#e2e2e2" }}>System Vitality</h3>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {[
                      { icon: "database", label: "Postgres", key: "postgres" },
                      { icon: "hub", label: "Qdrant Vector", key: "qdrant" },
                      { icon: "auto_awesome", label: "Embeddings API", key: "embedding" },
                    ].map(svc => {
                      const s = services?.[svc.key as keyof ServiceHealth] as any;
                      const ok = s?.status === "ok";
                      return (
                        <div key={svc.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#1f1f1f", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#494456" }}>{svc.icon}</span>
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "#cbc3d9" }}>{svc.label}</span>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: ok ? "#10b981" : "#ef4444", background: ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {s ? svcLabel(s.status) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Gauges */}
                <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "24px 28px", border: "1px solid rgba(73,68,86,0.1)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#e2e2e2" }}>Infrastructure Load</h3>
                    {system && <span style={{ fontSize: 11, color: "#494456" }}>Uptime: <span style={{ color: "#6e28f5", fontWeight: 700 }}>{fmtUptime(system.uptime_seconds)}</span></span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                    <CircleGauge value={Math.round(system?.cpu_percent ?? 0)} label="CPU" color="#6e28f5" />
                    <CircleGauge value={Math.round(system?.ram_percent ?? 0)} label="RAM" color="#cfbdff" />
                    <CircleGauge value={Math.round(system?.disk_percent ?? 0)} label="Disk" color="#f59e0b" />
                  </div>
                  {system && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 20, paddingTop: 20, borderTop: "1px solid rgba(73,68,86,0.1)" }}>
                      {[
                        { label: "RAM", used: system.ram_used_gb, total: system.ram_total_gb, unit: "GB" },
                        { label: "Disk", used: system.disk_used_gb, total: system.disk_total_gb, unit: "GB" },
                      ].map(m => (
                        <div key={m.label} style={{ textAlign: "center" }}>
                          <p style={{ fontSize: 11, color: "#494456", margin: "0 0 2px", fontWeight: 600 }}>{m.label}</p>
                          <p style={{ fontSize: 13, color: "#e2e2e2", margin: 0, fontWeight: 700 }}>{m.used} / {m.total} {m.unit}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 28, background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#e2e2e2", margin: 0 }}>📄 BA Document Processing</h3>
                  <button
                    onClick={fetchBADocumentStats}
                    title="Refresh"
                    style={{ background: "transparent", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 8, padding: 6, color: "#888", cursor: "pointer", display: "flex", alignItems: "center" }}
                    onMouseEnter={e => e.currentTarget.style.color = "#e2e2e2"}
                    onMouseLeave={e => e.currentTarget.style.color = "#888"}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, animation: baDocRefreshing ? "spin 1s linear infinite" : "none" }}>refresh</span>
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "#888", margin: "0 0 16px" }}>
                  Last updated: {baDocLastUpdated ? new Date(baDocLastUpdated).toLocaleTimeString() : "-"}
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
                  <div style={{ background: "#151515", border: "1px solid rgba(73,68,86,0.15)", borderRadius: 12, padding: "18px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-outlined" style={{ color: "#6e28f5", fontSize: 18, fontVariationSettings: "'FILL' 1" }}>database</span>
                      <span style={{ fontSize: 12, color: "#888" }}>Total Chunks Indexed</span>
                    </div>
                    <p style={{ fontSize: 28, fontWeight: 800, margin: "10px 0 0", color: "#e2e2e2" }}>{baDocStats?.upload_summary.total_student_chunks ?? 0}</p>
                  </div>

                  <div style={{ background: "#151515", border: "1px solid rgba(73,68,86,0.15)", borderRadius: 12, padding: "18px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-outlined" style={{ color: "#2563eb", fontSize: 18, fontVariationSettings: "'FILL' 1" }}>group</span>
                      <span style={{ fontSize: 12, color: "#888" }}>Students with Uploads</span>
                    </div>
                    <p style={{ fontSize: 28, fontWeight: 800, margin: "10px 0 0", color: "#e2e2e2" }}>{`${baDocStats?.upload_summary.students_with_uploads ?? 0} / 20 students`}</p>
                  </div>

                  <div style={{ background: "#151515", border: "1px solid rgba(73,68,86,0.15)", borderRadius: 12, padding: "18px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-outlined" style={{ color: (baDocStats?.upload_summary.pending_chunks ?? 0) > 0 ? "#f59e0b" : "#10b981", fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                        {(baDocStats?.upload_summary.pending_chunks ?? 0) > 0 ? "sync" : "cloud_done"}
                      </span>
                      <span style={{ fontSize: 12, color: "#888" }}>Sync Status</span>
                    </div>
                    <p style={{ fontSize: 23, fontWeight: 800, margin: "10px 0 0", color: "#e2e2e2" }}>
                      {(baDocStats?.upload_summary.synced_chunks ?? 0)} synced / {(baDocStats?.upload_summary.pending_chunks ?? 0)} pending
                    </p>
                  </div>

                  <div style={{ background: "#151515", border: "1px solid rgba(73,68,86,0.15)", borderRadius: 12, padding: "18px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="material-symbols-outlined" style={{ color: baDocStats?.embedding_service.status === "online" ? "#10b981" : "#ef4444", fontSize: 18, fontVariationSettings: "'FILL' 1" }}>memory</span>
                      <span style={{ fontSize: 12, color: "#888" }}>Embedding Service</span>
                    </div>
                    <p style={{ fontSize: 22, fontWeight: 800, margin: "10px 0 0", color: baDocStats?.embedding_service.status === "online" ? "#10b981" : "#ef4444" }}>
                      {baDocStats?.embedding_service.status === "online"
                        ? `Operational - ${baDocStats.embedding_service.latency_ms ?? 0}ms`
                        : "Not Operational"}
                    </p>
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#e2e2e2" }}>Personal Qdrant Collections</p>
                  {baDocStats?.qdrant_collections?.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {baDocStats.qdrant_collections.map((c) => (
                        <span key={c.name} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 999, padding: "6px 10px", color: "#888", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          {c.name} • {c.point_count} vectors
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: "#888", fontSize: 13 }}>No student uploads yet</p>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#e2e2e2" }}>Student Upload Activity</p>
                  <div style={{ border: "1px solid rgba(73,68,86,0.2)", borderRadius: 12, overflow: "hidden" }}>
                    <table>
                      <thead>
                        <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                          <th style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Name</th>
                          <th style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Roll No</th>
                          <th style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Files Uploaded</th>
                          <th style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Chunks</th>
                          <th style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>Last Upload</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(baDocStats?.per_student || []).map((row) => {
                          const names = truncateFilenames(row.filenames || []);
                          const barWidth = Math.max(4, Math.round((row.chunk_count / baMaxChunkCount) * 100));
                          return (
                            <tr key={row.user_id}>
                              <td style={{ padding: "12px 14px" }}>{row.name || "-"}</td>
                              <td style={{ padding: "12px 14px" }}>{row.username || "-"}</td>
                              <td style={{ padding: "12px 14px" }} title={names.full}>{names.short || "-"}</td>
                              <td style={{ padding: "12px 14px", minWidth: 130 }}>
                                <div style={{ fontWeight: 700 }}>{row.chunk_count}</div>
                                <div style={{ marginTop: 4, width: "100%", height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 999 }}>
                                  <div style={{ width: `${barWidth}%`, height: 3, background: "#6e28f5", borderRadius: 999 }} />
                                </div>
                              </td>
                              <td style={{ padding: "12px 14px" }}>{fmtRelativeTime(row.last_upload)}</td>
                            </tr>
                          );
                        })}
                        {(baDocStats?.per_student || []).length === 0 && (
                          <tr>
                            <td colSpan={5} style={{ padding: "14px", color: "#888" }}>No upload activity yet</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "#888" }}>
                    {(baDocStats?.per_student?.length ?? 0)} of 20 BA students have uploaded documents
                  </p>
                </div>

                {(baDocStats?.recent_errors?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <p style={{ margin: "0 0 10px", color: "#ef4444", fontSize: 14, fontWeight: 700 }}>⚠ Recent Upload Errors</p>
                    {baDocStats?.recent_errors.map((err, idx) => (
                      <div key={idx} style={{ background: "rgba(239,68,68,0.08)", borderLeft: "3px solid #ef4444", padding: "8px 12px", borderRadius: 4, fontSize: 13, marginBottom: 6, color: "#fca5a5" }}>
                        <span style={{ color: "#f87171", fontWeight: 700, marginRight: 8 }}>[{fmtDate(err.created_at)}]</span>
                        {err.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── MESSAGES TAB ── */}
          {activeTab === "messages" && (
            <div className="fade-up">
              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(73,68,86,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#494456", fontWeight: 600 }}>{msgTotal} total messages</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => { setMsgPage(p => Math.max(1, p - 1)); }} disabled={msgPage === 1}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: msgPage === 1 ? "#333" : "#958da2", cursor: msgPage === 1 ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>
                      ← Prev
                    </button>
                    <span style={{ fontSize: 12, color: "#494456", padding: "5px 8px" }}>Page {msgPage}</span>
                    <button onClick={() => { setMsgPage(p => p + 1); }} disabled={msgPage * 50 >= msgTotal}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: msgPage * 50 >= msgTotal ? "#333" : "#958da2", cursor: msgPage * 50 >= msgTotal ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>
                      Next →
                    </button>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>
                      <th>Role</th><th>User</th><th>Session</th><th style={{ maxWidth: 400 }}>Content</th><th>Time</th>
                    </tr></thead>
                    <tbody>
                      {messages.map(m => (
                        <tr key={m.id}>
                          <td>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, textTransform: "uppercase", background: m.role === "user" ? "rgba(110,40,245,0.1)" : "rgba(16,185,129,0.1)", color: m.role === "user" ? "#cfbdff" : "#10b981" }}>{m.role}</span>
                          </td>
                          <td style={{ color: "#e2e2e2" }}>{m.username}</td>
                          <td style={{ color: "#494456", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.session_title}</td>
                          <td style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cbc3d9" }}>{m.content}</td>
                          <td style={{ color: "#494456", whiteSpace: "nowrap" }}>{fmtDate(m.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── API LOGS TAB ── */}
          {activeTab === "api-logs" && (
            <div className="fade-up">
              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(73,68,86,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#494456", fontWeight: 600 }}>{apiTotal} total calls</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setApiPage(p => Math.max(1, p - 1))} disabled={apiPage === 1}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: apiPage === 1 ? "#333" : "#958da2", cursor: apiPage === 1 ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>← Prev</button>
                    <span style={{ fontSize: 12, color: "#494456", padding: "5px 8px" }}>Page {apiPage}</span>
                    <button onClick={() => setApiPage(p => p + 1)} disabled={apiPage * 50 >= apiTotal}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: apiPage * 50 >= apiTotal ? "#333" : "#958da2", cursor: apiPage * 50 >= apiTotal ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>Next →</button>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>
                      <th>User</th><th>Model</th><th>Endpoint</th><th>Prompt</th><th>Completion</th><th>Total</th><th>Latency</th><th>Time</th>
                    </tr></thead>
                    <tbody>
                      {apiLogs.map(l => (
                        <tr key={l.id}>
                          <td style={{ color: "#e2e2e2" }}>{l.username || "—"}</td>
                          <td><span style={{ fontSize: 11, color: "#6e28f5", background: "rgba(110,40,245,0.08)", padding: "2px 8px", borderRadius: 5 }}>{l.model}</span></td>
                          <td style={{ color: "#494456" }}>{l.endpoint}</td>
                          <td>{l.prompt_tokens.toLocaleString()}</td>
                          <td>{l.completion_tokens.toLocaleString()}</td>
                          <td style={{ color: "#cfbdff", fontWeight: 700 }}>{l.total_tokens.toLocaleString()}</td>
                          <td style={{ color: l.latency_ms > 3000 ? "#ef4444" : "#10b981" }}>{l.latency_ms}ms</td>
                          <td style={{ color: "#494456", whiteSpace: "nowrap" }}>{fmtDate(l.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── ERRORS TAB ── */}
          {activeTab === "errors" && (
            <div className="fade-up">
              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(73,68,86,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#494456", fontWeight: 600 }}>{errorTotal} total errors</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setErrorPage(p => Math.max(1, p - 1))} disabled={errorPage === 1}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: errorPage === 1 ? "#333" : "#958da2", cursor: errorPage === 1 ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>← Prev</button>
                    <span style={{ fontSize: 12, color: "#494456", padding: "5px 8px" }}>Page {errorPage}</span>
                    <button onClick={() => setErrorPage(p => p + 1)} disabled={errorPage * 50 >= errorTotal}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: errorPage * 50 >= errorTotal ? "#333" : "#958da2", cursor: errorPage * 50 >= errorTotal ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>Next →</button>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {errorLogs.map(e => (
                    <div key={e.id} style={{ borderBottom: "1px solid rgba(73,68,86,0.08)" }}>
                      <div onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}
                        style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", cursor: "pointer", transition: "background 0.15s" }}
                        onMouseEnter={ev => ev.currentTarget.style.background = "rgba(239,68,68,0.03)"}
                        onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#ef4444", flexShrink: 0 }}>error</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#ef4444" }}>{e.error_type}</span>
                            <span style={{ fontSize: 10, color: "#494456", background: "#1f1f1f", padding: "1px 6px", borderRadius: 4 }}>{e.method} {e.endpoint}</span>
                          </div>
                          <p style={{ fontSize: 12, color: "#958da2", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.error_message}</p>
                        </div>
                        <span style={{ fontSize: 11, color: "#333", whiteSpace: "nowrap", marginLeft: 12 }}>{fmtDate(e.created_at)}</span>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#333", transition: "transform 0.2s", transform: expandedError === e.id ? "rotate(180deg)" : "rotate(0)" }}>expand_more</span>
                      </div>
                      {expandedError === e.id && (
                        <div style={{ padding: "0 20px 16px 50px" }}>
                          <pre style={{ margin: 0, padding: "14px 16px", background: "#0e0e0e", borderRadius: 10, fontSize: 11, color: "#ef4444", overflowX: "auto", lineHeight: 1.6, fontFamily: "'Fira Code', monospace", border: "1px solid rgba(239,68,68,0.1)" }}>
                            {e.traceback || "No traceback available"}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                  {errorLogs.length === 0 && (
                    <div style={{ padding: 40, textAlign: "center", color: "#333", fontSize: 13 }}>No errors logged 🎉</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── SYSTEM TAB ── */}
          {activeTab === "system" && (
            <div className="fade-up">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 24 }}>
                <CircleGauge value={Math.round(system?.cpu_percent ?? 0)} label="CPU" color="#6e28f5" />
                <CircleGauge value={Math.round(system?.ram_percent ?? 0)} label="RAM" color="#cfbdff" />
                <CircleGauge value={Math.round(system?.disk_percent ?? 0)} label="Disk" color="#f59e0b" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                {system && [
                  { label: "RAM Used", value: `${system.ram_used_gb} / ${system.ram_total_gb} GB` },
                  { label: "Disk Used", value: `${system.disk_used_gb} / ${system.disk_total_gb} GB` },
                  { label: "Uptime", value: fmtUptime(system.uptime_seconds) },
                  { label: "Platform", value: system.platform },
                ].map(item => (
                  <div key={item.label} style={{ background: "#1a1a1a", borderRadius: 14, padding: "18px 22px", border: "1px solid rgba(73,68,86,0.1)" }}>
                    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#494456", margin: "0 0 6px", fontWeight: 700 }}>{item.label}</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: "#e2e2e2", margin: 0 }}>{item.value}</p>
                  </div>
                ))}
              </div>
              <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "24px 28px", border: "1px solid rgba(73,68,86,0.1)" }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 20px", color: "#e2e2e2" }}>Services</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { icon: "database", label: "PostgreSQL", key: "postgres", detail: "Primary database" },
                    { icon: "hub", label: "Qdrant", key: "qdrant", detail: `${(services?.qdrant as any)?.points_count ?? 0} vectors` },
                    { icon: "auto_awesome", label: "Embedding Service", key: "embedding", detail: "BAAI/bge-large-en-v1.5" },
                  ].map(svc => {
                    const s = services?.[svc.key as keyof ServiceHealth] as any;
                    const ok = s?.status === "ok";
                    return (
                      <div key={svc.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#131313", borderRadius: 12, border: "1px solid rgba(73,68,86,0.08)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: ok ? "#10b981" : "#ef4444" }}>{svc.icon}</span>
                          </div>
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 700, color: "#e2e2e2", margin: 0 }}>{svc.label}</p>
                            <p style={{ fontSize: 11, color: "#494456", margin: 0 }}>{svc.detail}</p>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: ok ? "#10b981" : "#ef4444", boxShadow: ok ? "0 0 6px #10b981" : "0 0 6px #ef4444" }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: ok ? "#10b981" : "#ef4444" }}>{s ? svcLabel(s.status) : "Unknown"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── USERS TAB ── */}
          {activeTab === "users" && (
            <div className="fade-up">
              {/* Add user */}
              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", padding: "18px 20px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e2e2e2" }}>Add teacher or student</p>
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: "#494456" }}>Create new accounts directly from admin dashboard.</p>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "center" }}>
                  <input
                    value={newUserName}
                    onChange={e => setNewUserName(e.target.value)}
                    placeholder="Full name (optional)"
                    style={{ width: "100%", padding: "9px 12px", background: "#131313", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 9, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }}
                  />
                  <input
                    value={newUserEmail}
                    onChange={e => setNewUserEmail(e.target.value)}
                    placeholder="Email"
                    style={{ width: "100%", padding: "9px 12px", background: "#131313", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 9, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }}
                  />
                  <input
                    value={newUserUsername}
                    onChange={e => setNewUserUsername(e.target.value)}
                    placeholder="Username"
                    style={{ width: "100%", padding: "9px 12px", background: "#131313", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 9, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }}
                  />
                  <input
                    type="password"
                    value={newUserPassword}
                    onChange={e => setNewUserPassword(e.target.value)}
                    placeholder="Temporary password"
                    style={{ width: "100%", padding: "9px 12px", background: "#131313", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 9, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }}
                  />
                  <select
                    value={newUserRole}
                    onChange={e => setNewUserRole(e.target.value as NewUserRole)}
                    style={{ width: "100%", padding: "9px 10px", background: "#131313", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 9, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }}
                  >
                    <option value="student">Student</option>
                    <option value="teacher">Teacher</option>
                  </select>
                  <button
                    onClick={createUser}
                    disabled={creatingUser}
                    style={{ padding: "9px 14px", borderRadius: 9, border: "1px solid rgba(110,40,245,0.35)", background: creatingUser ? "#23173f" : "linear-gradient(135deg, #6e28f5, #5b21b6)", color: "#f5f3ff", cursor: creatingUser ? "not-allowed" : "pointer", fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", minHeight: 38 }}
                  >
                    {creatingUser ? "Creating..." : "Create user"}
                  </button>
                </div>

                {(createUserError || createUserSuccess) && (
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: createUserError ? "#ef4444" : "#10b981", fontWeight: 600 }}>
                    {createUserError || createUserSuccess}
                  </p>
                )}
              </div>

              {/* Search + export */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#494456" }}>search</span>
                  <input value={userSearch} onChange={e => { setUserSearch(e.target.value); setUserPage(1); fetchUsers(1, e.target.value); }}
                    placeholder="Search by name or email…"
                    style={{ width: "100%", paddingLeft: 38, paddingRight: 16, paddingTop: 10, paddingBottom: 10, background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 10, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }} />
                </div>
                <button onClick={exportUsers} disabled={exportingUsers}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "1px solid rgba(73,68,86,0.2)", background: "#1a1a1a", color: exportingUsers ? "#6b6b7e" : "#cbc3d9", textDecoration: "none", fontSize: 12, fontWeight: 600, fontFamily: "Manrope, sans-serif", transition: "all 0.15s", cursor: exportingUsers ? "not-allowed" : "pointer" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                  {exportingUsers ? "Exporting..." : "Export CSV"}
                </button>
              </div>

              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(73,68,86,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#494456", fontWeight: 600 }}>{userTotal} users</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => { setUserPage(p => Math.max(1, p - 1)); }} disabled={userPage === 1}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: userPage === 1 ? "#333" : "#958da2", cursor: userPage === 1 ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>← Prev</button>
                    <span style={{ fontSize: 12, color: "#494456", padding: "5px 8px" }}>Page {userPage}</span>
                    <button onClick={() => { setUserPage(p => p + 1); }} disabled={userPage * 50 >= userTotal}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", color: userPage * 50 >= userTotal ? "#333" : "#958da2", cursor: userPage * 50 >= userTotal ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit" }}>Next →</button>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>
                      <th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th>
                    </tr></thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.user_id}>
                          <td>
                            <div>
                              <p style={{ margin: 0, color: "#e2e2e2", fontWeight: 600 }}>{u.name || u.username}</p>
                              {u.name && <p style={{ margin: "2px 0 0", color: "#6f6880", fontSize: 11 }}>@{u.username}</p>}
                            </div>
                          </td>
                          <td style={{ color: "#494456" }}>{u.email}</td>
                          <td>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, textTransform: "uppercase", background: u.role === "admin" ? "rgba(239,68,68,0.1)" : u.role === "teacher" ? "rgba(245,158,11,0.1)" : "rgba(110,40,245,0.1)", color: u.role === "admin" ? "#ef4444" : u.role === "teacher" ? "#f59e0b" : "#cfbdff" }}>{u.role}</span>
                          </td>
                          <td>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, textTransform: "uppercase", background: u.is_active ? "rgba(16,185,129,0.1)" : "rgba(73,68,86,0.1)", color: u.is_active ? "#10b981" : "#494456" }}>{u.is_active ? "Active" : "Suspended"}</span>
                          </td>
                          <td style={{ color: "#494456" }}>{new Date(u.created_at).toLocaleDateString()}</td>
                          <td>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => toggleUserStatus(u.user_id, u.is_active)}
                                title={u.is_active ? "Suspend" : "Activate"}
                                style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(73,68,86,0.2)", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#958da2", transition: "all 0.15s" }}
                                onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#e2e2e2"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#958da2"; }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{u.is_active ? "block" : "check_circle"}</span>
                              </button>
                              <button onClick={() => deleteUser(u.user_id)}
                                title="Delete user"
                                style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(239,68,68,0.15)", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", transition: "all 0.15s" }}
                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}