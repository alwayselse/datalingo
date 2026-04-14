"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Overview {
  total_students: number;
  active_last_7_days: number;
  total_questions: number;
  avg_mastery: number;
  most_asked_topic: string | null;
  most_struggled_topic: string | null;
}

interface Student {
  user_id: string;
  username: string;
  email: string;
  batch: string;
  total_sessions: number;
  total_questions: number;
  avg_mastery: number;
  last_active: string | null;
  at_risk: boolean;
}

interface TopicHeatmap {
  topic_id: string;
  topic_name: string;
  students_assessed: number;
  avg_mastery: number;
  struggling: number;
  mastered: number;
  total_assessments: number;
}

interface AtRisk {
  user_id: string;
  username: string;
  email: string;
  batch: string;
  avg_mastery: number;
  total_questions: number;
  last_active: string | null;
  risk_reason: string;
}

interface MasteryScore {
  topic_id: string;
  topic_name: string;
  p_known: number;
  assessment_count: number;
  last_assessed: string | null;
  level: string;
}

interface StudentDetail {
  student: { user_id: string; username: string; email: string; batch: string; joined: string };
  total_questions: number;
  avg_mastery: number;
  mastery_by_topic: MasteryScore[];
  recent_questions: { question: string; session_title: string; asked_at: string }[];
}

interface BAOverview {
  total_students: number;
  active_last_7_days: number;
  total_messages: number;
  inactive_students: number;
  most_studied_topic: string | null;
  weakest_topic: string | null;
  total_memory_fragments: number;
  topic_activity: Array<{
    topic_id: string;
    student_count: number;
    avg_p_known: number;
    total_sessions: number;
  }>;
  dream_health: Record<string, number>;
}

interface BAStudent {
  user_id: string;
  username: string;
  email: string;
  name: string;
  total_sessions: number;
  total_messages: number;
  palace_sessions: number;
  avg_palace_mastery: number;
  topics_studied: number;
  topics_with_memory: number;
  last_active: string | null;
}

interface BAStudentDetail {
  student: {
    id: string;
    username: string;
    email: string;
    name: string;
    created_at: string;
  };
  palace: Array<{
    topic_id: string;
    topic_name: string;
    p_known: number;
    mastery_level: string;
    session_count: number;
    understanding_summary: string | null;
    misconceptions: any[];
    forge_attempts: any[];
    last_studied_at: string | null;
  }>;
  fragments: Array<{
    topic_id: string;
    fragment_type: string;
    content: string;
    created_at: string;
  }>;
  recent_sessions: Array<{
    id: string;
    title: string;
    created_at: string;
    message_count: number;
  }>;
  weak_topics: any[];
  summary: {
    topics_studied: number;
    topics_with_memory: number;
    total_fragments: number;
    avg_mastery: number;
  };
}

interface Announcement {
  id: string;
  teacher_id: string;
  title: string;
  body: string;
  course: string;
  created_at: string;
  is_active: boolean;
  teacher_name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function masteryColor(p: number, opacity = 1) {
  if (p === 0) return `rgba(42,42,42,${opacity})`;
  if (p < 0.4) return `rgba(124,58,237,${opacity})`;
  if (p < 0.7) return `rgba(59,130,246,${opacity})`;
  return `rgba(16,185,129,${opacity})`;
}

function masteryLabel(p: number) {
  if (p === 0) return { text: "Unassessed", color: "#494456" };
  if (p < 0.4) return { text: "Beginner", color: "#7c3aed" };
  if (p < 0.7) return { text: "Intermediate", color: "#3b82f6" };
  return { text: "Advanced", color: "#10b981" };
}

function fmtAgo(iso: string | null) {
  if (!iso) return "just now";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function shortTopicLabel(topic: string | null | undefined) {
  const clean = (topic || "Unknown topic").replace(/_/g, " ");
  return clean.length > 34 ? `${clean.slice(0, 34)}...` : clean;
}

function topicCoverageColor(count: number) {
  if (count > 15) return "#10b981";
  if (count >= 8) return "#d97706";
  return "#ef4444";
}

function fragmentTypeColor(kind: string) {
  if (kind === "insight") return "#10b981";
  if (kind === "confusion") return "#d97706";
  if (kind === "example_worked") return "#3b82f6";
  if (kind === "forge_attempt") return "#7c3aed";
  return "#494456";
}

// ── Radar Chart (SVG) ─────────────────────────────────────────────────────────

function RadarChart({ data }: { data: MasteryScore[] }) {
  if (!data.length) return null;
  const items = data.slice(0, 12); // max 12 for readability
  const N = items.length;
  const cx = 160; const cy = 160; const R = 130;

  const angleOf = (i: number) => (i / N) * 2 * Math.PI - Math.PI / 2;

  const point = (i: number, r: number) => {
    const a = angleOf(i);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  const rings = [0.25, 0.5, 0.75, 1.0];

  const dataPoints = items.map((d, i) => point(i, d.p_known * R));
  const pathD = dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";

  return (
    <svg viewBox="0 0 320 320" style={{ width: "100%", maxWidth: 300 }}>
      {/* Rings */}
      {rings.map(r => {
        const pts = items.map((_, i) => point(i, r * R));
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";
        return <path key={r} d={d} fill="none" stroke="#2a2a2a" strokeWidth="1" />;
      })}
      {/* Spokes */}
      {items.map((_, i) => {
        const p = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="#1f1f1f" strokeWidth="1" />;
      })}
      {/* Data area */}
      <path d={pathD} fill="rgba(110,40,245,0.15)" stroke="#6e28f5" strokeWidth="2" strokeLinejoin="round" />
      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill={masteryColor(items[i].p_known)} />
      ))}
      {/* Labels */}
      {items.map((d, i) => {
        const p = point(i, R + 18);
        const anchor = p.x < cx - 5 ? "end" : p.x > cx + 5 ? "start" : "middle";
        const name = d.topic_name.length > 10 ? d.topic_name.slice(0, 10) + "…" : d.topic_name;
        return (
          <text key={i} x={p.x} y={p.y} textAnchor={anchor} fontSize="9" fill="#494456" fontFamily="Manrope, sans-serif" dominantBaseline="middle">{name}</text>
        );
      })}
    </svg>
  );
}

// ── Bar Chart per topic ───────────────────────────────────────────────────────

function MasteryBarChart({ data }: { data: MasteryScore[] }) {
  const sorted = [...data].sort((a, b) => b.p_known - a.p_known);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 300 }}>
      {sorted.map(t => (
        <div key={t.topic_id}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "#cbc3d9", fontFamily: "Manrope, sans-serif", fontWeight: 600 }}>{t.topic_name}</span>
            <span style={{ fontSize: 11, color: masteryLabel(t.p_known).color, fontWeight: 700, fontFamily: "Manrope, sans-serif" }}>{Math.round(t.p_known * 100)}%</span>
          </div>
          <div style={{ height: 6, background: "#1f1f1f", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${t.p_known * 100}%`, background: masteryColor(t.p_known), borderRadius: 3, transition: "width 0.8s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Nav Item ──────────────────────────────────────────────────────────────────

function NavItem({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, fontWeight: active ? 700 : 500, textAlign: "left", transition: "all 0.15s", background: active ? "rgba(110,40,245,0.15)" : "transparent", color: active ? "#cfbdff" : "#6b6b6b" }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#161616"; e.currentTarget.style.color = "#aaa"; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6b6b6b"; } }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "20px 22px", border: "1px solid rgba(73,68,86,0.1)", display: "flex", flexDirection: "column", gap: 14 }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(110,40,245,0.3)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(73,68,86,0.1)"}
    >
      <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(110,40,245,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#6e28f5", fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      </div>
      <div>
        <p style={{ fontSize: 28, fontWeight: 800, fontFamily: "Manrope, sans-serif", color: "#e2e2e2", margin: 0, letterSpacing: "-0.03em" }}>{value}</p>
        <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#494456", fontFamily: "Manrope, sans-serif", margin: "4px 0 0" }}>{label}</p>
        {sub && <p style={{ fontSize: 11, color: "#6e28f5", margin: "4px 0 0", fontWeight: 600, fontFamily: "Manrope, sans-serif" }}>{sub}</p>}
      </div>
    </div>
  );
}

type Tab = "overview" | "students" | "at-risk" | "ba";

// ── Main Teacher Page ─────────────────────────────────────────────────────────

export default function TeacherPage() {
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Data
  const [overview, setOverview] = useState<Overview | null>(null);
  const [topics, setTopics] = useState<TopicHeatmap[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [atRisk, setAtRisk] = useState<AtRisk[]>([]);
  const [search, setSearch] = useState("");
  const [batch, setBatch] = useState("");
  const [sortBy, setSortBy] = useState("last_active");

  // Student detail panel
  const [selectedStudent, setSelectedStudent] = useState<StudentDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelLoading, setPanelLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [baOverview, setBAOverview] = useState<BAOverview | null>(null);
  const [baStudents, setBAStudents] = useState<BAStudent[]>([]);
  const [baStudent, setBAStudent] = useState<BAStudentDetail | null>(null);
  const [baPanelOpen, setBAPanelOpen] = useState(false);
  const [baPanelLoading, setBAPanelLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annPosting, setAnnPosting] = useState(false);
  const [baLoading, setBALoading] = useState(false);
  const [baSummaryOpen, setBASummaryOpen] = useState<Record<string, boolean>>({});

  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (mounted && (!token || !user)) router.replace("/login");
    if (mounted && user && !["teacher", "admin"].includes((user as any).role)) router.replace("/student");
  }, [mounted, token, user]);

  const fetchOverview = useCallback(async () => {
    if (!token) return;
    const [ovRes, topRes] = await Promise.all([
      fetch(`${API}/analytics/overview`, { headers }),
      fetch(`${API}/analytics/topics`, { headers }),
    ]);
    if (ovRes.ok) setOverview(await ovRes.json());
    if (topRes.ok) setTopics(await topRes.json());
  }, [token]);

  const fetchStudents = useCallback(async () => {
    if (!token) return;
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (batch) q.set("batch", batch);
    if (sortBy) q.set("sort_by", sortBy);
    const res = await fetch(`${API}/analytics/students?${q}`, { headers });
    if (res.ok) setStudents(await res.json());
  }, [token, search, batch, sortBy]);

  const fetchAtRisk = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API}/analytics/at-risk`, { headers });
    if (res.ok) setAtRisk(await res.json());
  }, [token]);

  const fetchBA = useCallback(async () => {
    if (!token) return;
    setBALoading(true);
    try {
      const [ovRes, stuRes, annRes] = await Promise.all([
        fetch(`${API}/analytics/ba/overview`, { headers }),
        fetch(`${API}/analytics/ba/students`, { headers }),
        fetch(`${API}/analytics/announcements?course=business_analytics`, { headers }),
      ]);
      if (ovRes.ok) setBAOverview(await ovRes.json());
      if (stuRes.ok) setBAStudents(await stuRes.json());
      if (annRes.ok) {
        const rows = await annRes.json();
        setAnnouncements(Array.isArray(rows) ? rows.filter((a: Announcement) => a.is_active) : []);
      }
    } finally {
      setBALoading(false);
    }
  }, [token]);

  const openBAStudent = async (userId: string) => {
    setBAPanelOpen(true);
    setBAPanelLoading(true);
    setBAStudent(null);
    setBASummaryOpen({});
    try {
      const res = await fetch(
        `${API}/analytics/ba/student/${userId}`,
        { headers }
      );
      if (res.ok) setBAStudent(await res.json());
    } finally {
      setBAPanelLoading(false);
    }
  };

  const postAnnouncement = async () => {
    if (!annTitle.trim() || !annBody.trim()) return;
    setAnnPosting(true);
    try {
      const res = await fetch(`${API}/analytics/announcements`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: annTitle,
          body: annBody,
          course: "business_analytics"
        })
      });
      if (res.ok) {
        setAnnTitle("");
        setAnnBody("");
        await fetchBA();
      }
    } finally {
      setAnnPosting(false);
    }
  };

  const deleteAnnouncement = async (id: string) => {
    await fetch(`${API}/analytics/announcements/${id}`, {
      method: "DELETE",
      headers
    });
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  };

  useEffect(() => { fetchOverview(); fetchStudents(); fetchAtRisk(); }, [fetchOverview, fetchStudents, fetchAtRisk]);
  useEffect(() => { fetchStudents(); }, [search, batch, sortBy]);
  useEffect(() => {
    if (activeTab === "ba") fetchBA();
  }, [activeTab, fetchBA]);

  const openStudentPanel = async (userId: string) => {
    setPanelOpen(true);
    setPanelLoading(true);
    setSummary(null);
    setSummaryOpen(false);
    try {
      const res = await fetch(`${API}/analytics/student/${userId}`, { headers });
      if (res.ok) setSelectedStudent(await res.json());
    } finally {
      setPanelLoading(false);
    }
  };

  const generateSummary = async () => {
    if (!selectedStudent) return;
    setSummaryLoading(true);
    try {
      const res = await fetch(`${API}/analytics/student/${selectedStudent.student.user_id}/generate-summary`, { method: "POST", headers });
      if (res.ok) { const d = await res.json(); setSummary(d.summary); setSummaryOpen(true); }
    } finally { setSummaryLoading(false); }
  };

  const handleLogout = () => {
    clearAuth();
    document.cookie = "auth_token=; path=/; max-age=0";
    document.cookie = "user_role=; path=/; max-age=0";
    router.replace("/login");
  };

  const SW = sidebarCollapsed ? 60 : 260;
  const displayName = mounted ? ((user as any)?.name?.split(" ")[0] || "Teacher") : "...";

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
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.3s ease forwards; }
        table { border-collapse: collapse; width: 100%; }
        th { padding: 10px 14px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #494456; font-family: Manrope, sans-serif; font-weight: 700; border-bottom: 1px solid #1f1f1f; }
        td { padding: 12px 14px; font-size: 13px; color: #cbc3d9; font-family: Manrope, sans-serif; border-bottom: 1px solid rgba(73,68,86,0.08); vertical-align: middle; }
        tr:hover td { background: rgba(110,40,245,0.03); cursor: pointer; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#0e0e0e", color: "#e2e2e2", fontFamily: "Manrope, sans-serif" }}>

        {/* ── Sidebar ── */}
        <aside style={{ width: SW, flexShrink: 0, position: "fixed", inset: "0 auto 0 0", background: "#111", borderRight: "1px solid rgba(73,68,86,0.08)", display: "flex", flexDirection: "column", padding: sidebarCollapsed ? "28px 10px 20px" : "28px 14px 20px", zIndex: 40, transition: "width 0.25s cubic-bezier(0.16,1,0.3,1)", overflow: "hidden" }}>

          {/* Logo + collapse */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "space-between", padding: "0 4px 28px", gap: 8 }}>
            {!sidebarCollapsed && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span className="material-symbols-outlined" style={{ color: "white", fontSize: 15, fontVariationSettings: "'FILL' 1" }}>school</span>
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 800, color: "#cfbdff", margin: 0, letterSpacing: "0.05em", textTransform: "uppercase" }}>Datalingo</p>
                  <p style={{ fontSize: 10, color: "#333", margin: 0, fontWeight: 600 }}>Teacher Panel</p>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ color: "white", fontSize: 15, fontVariationSettings: "'FILL' 1" }}>school</span>
              </div>
            )}
            {!sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#333", padding: 4, borderRadius: 8, display: "flex", alignItems: "center" }}
                onMouseEnter={e => { e.currentTarget.style.color = "#cbc3d9"; e.currentTarget.style.background = "#1a1a1a"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#333"; e.currentTarget.style.background = "none"; }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>left_panel_close</span>
              </button>
            )}
          </div>

          {sidebarCollapsed && (
            <button onClick={() => setSidebarCollapsed(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#333", padding: "6px 0", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}
              onMouseEnter={e => e.currentTarget.style.color = "#cbc3d9"}
              onMouseLeave={e => e.currentTarget.style.color = "#333"}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>right_panel_open</span>
            </button>
          )}

          {/* Nav */}
          <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            {sidebarCollapsed ? (
              <>
                {[
                  { icon: "dashboard", tab: "overview" },
                  { icon: "group", tab: "students" },
                  { icon: "warning", tab: "at-risk" },
                  { icon: "analytics", tab: "ba" },
                ].map(item => (
                  <button key={item.tab} onClick={() => setActiveTab(item.tab as Tab)}
                    title={item.tab}
                    style={{ padding: "9px 0", borderRadius: 10, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: activeTab === item.tab ? "rgba(110,40,245,0.15)" : "transparent", color: activeTab === item.tab ? "#cfbdff" : "#444", transition: "all 0.15s" }}
                    onMouseEnter={e => { if (activeTab !== item.tab) { e.currentTarget.style.background = "#161616"; e.currentTarget.style.color = "#aaa"; } }}
                    onMouseLeave={e => { if (activeTab !== item.tab) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#444"; } }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: activeTab === item.tab ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
                  </button>
                ))}
              </>
            ) : (
              <>
                <NavItem icon="dashboard" label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
                <NavItem icon="group" label="Students" active={activeTab === "students"} onClick={() => setActiveTab("students")} />
                <NavItem icon="warning" label="At-Risk Students" active={activeTab === "at-risk"} onClick={() => setActiveTab("at-risk")} />
                <NavItem icon="analytics" label="BA Analytics" active={activeTab === "ba"} onClick={() => setActiveTab("ba")} />
              </>
            )}
          </nav>

          {/* User card */}
          <div style={{ paddingTop: 16, borderTop: "1px solid rgba(73,68,86,0.08)" }}>
            <button onClick={handleLogout}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: sidebarCollapsed ? 0 : 10, justifyContent: sidebarCollapsed ? "center" : "flex-start", padding: sidebarCollapsed ? "9px 0" : "10px 12px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#161616"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "white" }}>{displayName[0]?.toUpperCase()}</span>
              </div>
              {!sidebarCollapsed && (
                <>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#e2e2e2", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</p>
                    <p style={{ fontSize: 10, color: "#333", margin: 0 }}>Teacher</p>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 15, color: "#333" }}>logout</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ marginLeft: SW, flex: 1, minHeight: "100vh", overflowY: "auto", padding: "36px 36px 60px", transition: "margin-left 0.25s cubic-bezier(0.16,1,0.3,1)" }}>

          {/* Header */}
          <div style={{ marginBottom: 36 }}>
            <h1 style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 34, fontStyle: "italic", fontWeight: 400, color: "#e2e2e2", margin: "0 0 6px" }}>
              {activeTab === "overview" && "Class Overview"}
              {activeTab === "students" && "Students"}
              {activeTab === "at-risk" && "At-Risk Students"}
              {activeTab === "ba" && "BA Analytics"}
            </h1>
            <p style={{ fontSize: 12, color: "#494456", margin: 0, fontWeight: 600 }}>
              {activeTab === "overview" && "Class-wide performance and topic mastery heatmap"}
              {activeTab === "students" && "Search, filter and review individual student progress"}
              {activeTab === "at-risk" && "Students flagged for low engagement or mastery"}
              {activeTab === "ba" && "Business Analytics class insights and memory system health"}
            </p>
          </div>

          {/* ── OVERVIEW TAB ── */}
          {activeTab === "overview" && (
            <div className="fade-up">
              {/* Stat cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
                <StatCard icon="group" label="Total students" value={overview?.total_students ?? "—"} />
                <StatCard icon="bolt" label="Active 7 days" value={overview?.active_last_7_days ?? "—"} />
                <StatCard icon="forum" label="Total questions" value={overview?.total_questions?.toLocaleString() ?? "—"} />
                <StatCard icon="psychology" label="Avg mastery" value={overview ? `${Math.round(overview.avg_mastery * 100)}%` : "—"}
                  sub={overview?.most_struggled_topic ? `Struggling: ${overview.most_struggled_topic.replace(/_/g, " ")}` : undefined} />
              </div>

              {/* Topic heatmap */}
              <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "24px 28px", border: "1px solid rgba(73,68,86,0.1)" }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 24px", color: "#e2e2e2" }}>Topic Mastery Heatmap</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
                  {topics.map(t => {
                    const p = t.avg_mastery;
                    const bg = masteryColor(p, 0.12);
                    const border = masteryColor(p, 0.3);
                    const textColor = masteryLabel(p).color;
                    return (
                      <div key={t.topic_id} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "14px 16px", transition: "transform 0.15s", cursor: "default" }}
                        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.03)"}
                        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                      >
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#e2e2e2", margin: "0 0 6px", lineHeight: 1.3 }}>{t.topic_name}</p>
                        <p style={{ fontSize: 22, fontWeight: 800, color: textColor, margin: "0 0 6px", fontFamily: "Manrope, sans-serif" }}>{Math.round(p * 100)}%</p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 9, color: "#7c3aed", fontWeight: 700 }}>↓ {t.struggling} struggling</span>
                          <span style={{ fontSize: 9, color: "#10b981", fontWeight: 700 }}>✓ {t.mastered} mastered</span>
                        </div>
                        <div style={{ height: 3, background: "#1f1f1f", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${p * 100}%`, background: textColor, borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── STUDENTS TAB ── */}
          {activeTab === "students" && (
            <div className="fade-up">
              {/* Filters */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#494456" }}>search</span>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email…"
                    style={{ width: "100%", paddingLeft: 38, paddingRight: 16, paddingTop: 10, paddingBottom: 10, background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 10, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }} />
                </div>
                <select value={batch} onChange={e => setBatch(e.target.value)}
                  style={{ padding: "10px 14px", background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 10, color: "#cbc3d9", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none", cursor: "pointer" }}>
                  <option value="">All batches</option>
                  <option value="2022">2022</option>
                  <option value="2023">2023</option>
                  <option value="2024">2024</option>
                  <option value="2025">2025</option>
                </select>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: "10px 14px", background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 10, color: "#cbc3d9", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none", cursor: "pointer" }}>
                  <option value="last_active">Sort: Last active</option>
                  <option value="mastery">Sort: Mastery</option>
                  <option value="questions">Sort: Questions</option>
                </select>
              </div>

              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>
                      <th>Student</th><th>Batch</th><th>Sessions</th><th>Questions</th><th>Avg Mastery</th><th>Last Active</th><th>Status</th>
                    </tr></thead>
                    <tbody>
                      {students.map(s => (
                        <tr key={s.user_id} onClick={() => openStudentPanel(s.user_id)}>
                          <td>
                            <div>
                              <p style={{ margin: 0, fontWeight: 600, color: "#e2e2e2" }}>{s.username}</p>
                              <p style={{ margin: 0, fontSize: 11, color: "#494456" }}>{s.email}</p>
                            </div>
                          </td>
                          <td><span style={{ fontSize: 11, fontWeight: 700, color: "#6e28f5", background: "rgba(110,40,245,0.08)", padding: "2px 8px", borderRadius: 5 }}>{s.batch}</span></td>
                          <td>{s.total_sessions}</td>
                          <td>{s.total_questions}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 60, height: 4, background: "#1f1f1f", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${s.avg_mastery * 100}%`, background: masteryColor(s.avg_mastery), borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 700, color: masteryLabel(s.avg_mastery).color }}>{Math.round(s.avg_mastery * 100)}%</span>
                            </div>
                          </td>
                          <td style={{ color: "#494456" }}>{fmtDate(s.last_active)}</td>
                          <td>
                            {s.at_risk ? (
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.1)", padding: "3px 8px", borderRadius: 6, textTransform: "uppercase" }}>At Risk</span>
                            ) : (
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "3px 8px", borderRadius: 6, textTransform: "uppercase" }}>OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {students.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#333", fontSize: 13 }}>No students found</div>}
                </div>
              </div>
            </div>
          )}

          {/* ── BA TAB ── */}
          {activeTab === "ba" && (
            <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* BA Overview */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
                <StatCard icon="group" label="BA Students" value={baOverview?.total_students ?? "—"} />
                <StatCard icon="bolt" label="Active 7 Days" value={baOverview?.active_last_7_days ?? "—"} />
                <StatCard icon="chat" label="Total Messages" value={baOverview?.total_messages?.toLocaleString() ?? "—"} />
                <StatCard icon="psychology" label="Memory Fragments" value={baOverview?.total_memory_fragments?.toLocaleString() ?? "—"} />
                <StatCard icon="warning" label="No Activity" value={baOverview?.inactive_students ?? "—"} sub="students never started" />
              </div>

              <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "20px 24px", border: "1px solid rgba(73,68,86,0.1)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#e2e2e2" }}>Topic Coverage Across BA Cohort</h3>
                  {baLoading && <span style={{ fontSize: 11, color: "#494456" }}>Refreshing…</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[...(baOverview?.topic_activity || [])]
                    .sort((a, b) => b.total_sessions - a.total_sessions)
                    .slice(0, 12)
                    .map((topic) => {
                      const total = Math.max(1, baOverview?.total_students || 1);
                      const pct = Math.min(100, (topic.student_count / total) * 100);
                      const tint = masteryColor(Number(topic.avg_p_known || 0));
                      return (
                        <div key={topic.topic_id}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                            <span style={{ minWidth: 220, fontSize: 12, color: "#cbc3d9", fontWeight: 600 }}>{shortTopicLabel(topic.topic_id)}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#cfbdff", background: "rgba(110,40,245,0.1)", border: "1px solid rgba(110,40,245,0.25)", borderRadius: 999, padding: "2px 8px" }}>
                              {topic.student_count} students
                            </span>
                            <span style={{ marginLeft: "auto", fontSize: 10, color: "#494456" }}>{Math.round(Number(topic.avg_p_known || 0) * 100)}% mastery</span>
                          </div>
                          <div style={{ height: 7, borderRadius: 4, background: "#1f1f1f", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: tint, borderRadius: 4, transition: "width 0.35s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  {(baOverview?.topic_activity?.length || 0) === 0 && (
                    <p style={{ margin: 0, fontSize: 12, color: "#494456" }}>No BA topic activity yet.</p>
                  )}
                </div>

                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(73,68,86,0.12)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "#cbc3d9", fontWeight: 700 }}>Memory System</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.12)", borderRadius: 999, padding: "3px 8px" }}>done={baOverview?.dream_health?.done || 0}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#d97706", background: "rgba(217,119,6,0.12)", borderRadius: 999, padding: "3px 8px" }}>pending={baOverview?.dream_health?.pending || 0}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.12)", borderRadius: 999, padding: "3px 8px" }}>failed={baOverview?.dream_health?.failed || 0}</span>
                </div>
              </div>

              {/* BA Students */}
              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", overflow: "hidden" }}>
                <div style={{ padding: "18px 20px 10px" }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#e2e2e2" }}>BA Students</h3>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>
                      <th>Student</th><th>Topics Studied</th><th>Avg Mastery</th><th>Sessions</th><th>Memory</th><th>Last Active</th>
                    </tr></thead>
                    <tbody>
                      {baStudents.map(s => {
                        const mastery = Number(s.avg_palace_mastery || 0);
                        const topicsColor = topicCoverageColor(s.topics_studied);
                        return (
                          <tr key={s.user_id} onClick={() => openBAStudent(s.user_id)}>
                            <td>
                              <div>
                                <p style={{ margin: 0, fontWeight: 600, color: "#e2e2e2" }}>{s.username}</p>
                                <p style={{ margin: 0, fontSize: 11, color: "#494456" }}>{s.name || s.email}</p>
                              </div>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, fontWeight: 700, color: topicsColor }}>{s.topics_studied}/23</span>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, fontWeight: 700, color: masteryLabel(mastery).color, background: masteryColor(mastery, 0.16), border: `1px solid ${masteryColor(mastery, 0.4)}`, borderRadius: 999, padding: "3px 10px" }}>
                                {Math.round(mastery * 100)}%
                              </span>
                            </td>
                            <td>{s.total_sessions}</td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {s.topics_with_memory > 0 && <span className="material-symbols-outlined" style={{ fontSize: 14, color: "#10b981", fontVariationSettings: "'FILL' 1" }}>psychology</span>}
                                <span>{s.topics_with_memory} topics memorized</span>
                              </div>
                            </td>
                            <td style={{ color: "#494456" }}>{fmtDate(s.last_active)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {baStudents.length === 0 && !baLoading && (
                    <div style={{ padding: 40, textAlign: "center", color: "#333", fontSize: 13 }}>No BA students found</div>
                  )}
                </div>
              </div>

              {/* Announcements */}
              <div style={{ background: "#1a1a1a", borderRadius: 16, border: "1px solid rgba(73,68,86,0.1)", padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#cfbdff", fontVariationSettings: "'FILL' 1" }}>campaign</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#e2e2e2" }}>Class Announcements</h3>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                  <input
                    value={annTitle}
                    onChange={e => setAnnTitle(e.target.value)}
                    placeholder="Announcement title"
                    style={{ width: "100%", padding: "10px 12px", background: "#131313", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 10, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none" }}
                  />
                  <textarea
                    value={annBody}
                    onChange={e => setAnnBody(e.target.value)}
                    rows={3}
                    placeholder="Message to all BA students..."
                    style={{ width: "100%", padding: "10px 12px", background: "#131313", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 10, color: "#e2e2e2", fontFamily: "Manrope, sans-serif", fontSize: 13, outline: "none", resize: "vertical" }}
                  />
                  <button
                    onClick={postAnnouncement}
                    disabled={annPosting}
                    style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 10, border: "none", background: annPosting ? "#1f1f1f" : "linear-gradient(135deg, #6e28f5, #3d1a8f)", color: annPosting ? "#494456" : "white", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: annPosting ? "not-allowed" : "pointer" }}
                  >
                    {annPosting ? "Posting..." : "Post to BA Class"}
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {announcements.map((ann) => {
                    const canDelete = ann.teacher_id === String((user as any)?.id || "");
                    return (
                      <div key={ann.id} style={{ background: "#131313", border: "1px solid rgba(73,68,86,0.12)", borderRadius: 12, padding: "12px 14px" }}>
                        <p style={{ margin: "0 0 6px", color: "#fff", fontWeight: 600, fontSize: 14 }}>{ann.title}</p>
                        <p style={{ margin: 0, color: "#cbc3d9", fontSize: 13, lineHeight: 1.6 }}>{ann.body}</p>
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "#494456" }}>{ann.teacher_name} · {fmtDate(ann.created_at)}</span>
                          {canDelete && (
                            <button
                              onClick={() => deleteAnnouncement(ann.id)}
                              style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {announcements.length === 0 && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#494456" }}>No announcements yet</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── AT-RISK TAB ── */}
          {activeTab === "at-risk" && (
            <div className="fade-up">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                {atRisk.map(s => (
                  <div key={s.user_id}
                    onClick={() => { setActiveTab("students"); openStudentPanel(s.user_id); }}
                    style={{ background: "#1a1a1a", borderRadius: 16, padding: "20px", border: "1px solid rgba(239,68,68,0.12)", cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "#1f1a1a"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.12)"; e.currentTarget.style.background = "#1a1a1a"; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#e2e2e2", margin: "0 0 3px" }}>{s.username}</p>
                        <p style={{ fontSize: 11, color: "#494456", margin: 0 }}>{s.email}</p>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.1)", padding: "3px 8px", borderRadius: 6, textTransform: "uppercase", whiteSpace: "nowrap" }}>At Risk</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                      <div>
                        <p style={{ fontSize: 10, color: "#494456", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Mastery</p>
                        <p style={{ fontSize: 18, fontWeight: 800, color: "#ef4444", margin: 0 }}>{Math.round(s.avg_mastery * 100)}%</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 10, color: "#494456", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Questions</p>
                        <p style={{ fontSize: 18, fontWeight: 800, color: "#e2e2e2", margin: 0 }}>{s.total_questions}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 10, color: "#494456", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Batch</p>
                        <p style={{ fontSize: 18, fontWeight: 800, color: "#6e28f5", margin: 0 }}>{s.batch}</p>
                      </div>
                    </div>
                    <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.1)" }}>
                      <p style={{ fontSize: 11, color: "#ef4444", margin: 0, fontWeight: 600 }}>⚠ {s.risk_reason}</p>
                    </div>
                    <p style={{ fontSize: 11, color: "#333", margin: "10px 0 0" }}>Last active: {fmtDate(s.last_active)}</p>
                  </div>
                ))}
                {atRisk.length === 0 && (
                  <div style={{ gridColumn: "1 / -1", padding: 60, textAlign: "center", color: "#333", fontSize: 13 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 40, color: "#10b981", display: "block", marginBottom: 12 }}>check_circle</span>
                    No at-risk students right now 🎉
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* ── BA Student Detail Panel ── */}
        {baPanelOpen && (
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, background: "rgba(10,10,14,0.96)", backdropFilter: "blur(20px)", borderLeft: "1px solid rgba(110,40,245,0.15)", zIndex: 51, display: "flex", flexDirection: "column", animation: "slideIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards", overflowY: "auto" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(10,10,14,0.96)", backdropFilter: "blur(20px)", zIndex: 1 }}>
              <div>
                {baStudent && (
                  <>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e2e2e2", margin: "0 0 3px" }}>{baStudent.student.name || baStudent.student.username}</h2>
                    <p style={{ fontSize: 11, color: "#494456", margin: 0 }}>@{baStudent.student.username}</p>
                    <p style={{ fontSize: 11, color: "#494456", margin: "2px 0 0" }}>{baStudent.student.email}</p>
                  </>
                )}
                {baPanelLoading && <p style={{ fontSize: 14, color: "#494456", margin: 0 }}>Loading…</p>}
              </div>
              <button
                onClick={() => { setBAPanelOpen(false); setBAStudent(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#494456", padding: 4 }}
                onMouseEnter={e => e.currentTarget.style.color = "#e2e2e2"}
                onMouseLeave={e => e.currentTarget.style.color = "#494456"}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>

            {baStudent && !baPanelLoading && (
              <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#cfbdff", background: "rgba(110,40,245,0.12)", borderRadius: 999, padding: "4px 10px" }}>{baStudent.summary.topics_studied} topics studied</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.12)", borderRadius: 999, padding: "4px 10px" }}>{baStudent.summary.total_fragments} memory fragments</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: masteryLabel(baStudent.summary.avg_mastery).color, background: masteryColor(baStudent.summary.avg_mastery, 0.16), borderRadius: 999, padding: "4px 10px" }}>{Math.round(baStudent.summary.avg_mastery * 100)}% avg mastery</span>
                </div>

                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "#cbc3d9", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#7c3aed", fontVariationSettings: "'FILL' 1" }}>psychology</span>
                    Memory Palace
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[...baStudent.palace]
                      .filter(p => p.session_count > 0)
                      .sort((a, b) => Number(b.p_known || 0) - Number(a.p_known || 0))
                      .map((p) => {
                        const mastery = Number(p.p_known || 0);
                        const mid = `${p.topic_id}`;
                        const misconceptions = Array.isArray(p.misconceptions) ? p.misconceptions.length : 0;
                        const forgeAttempts = Array.isArray(p.forge_attempts) ? p.forge_attempts.length : 0;
                        return (
                          <div key={mid} style={{ background: "#131313", borderRadius: 12, padding: "12px 12px", border: "1px solid rgba(73,68,86,0.1)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <p style={{ margin: 0, fontSize: 12, color: "#e2e2e2", fontWeight: 700 }}>{shortTopicLabel(p.topic_name || p.topic_id)}</p>
                              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: masteryLabel(mastery).color, background: masteryColor(mastery, 0.15), borderRadius: 999, padding: "3px 8px" }}>{Math.round(mastery * 100)}%</span>
                            </div>
                            <div style={{ height: 6, background: "#1f1f1f", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                              <div style={{ height: "100%", width: `${mastery * 100}%`, background: masteryColor(mastery), borderRadius: 3 }} />
                            </div>
                            <p style={{ margin: "0 0 8px", fontSize: 11, color: "#494456" }}>studied {p.session_count}x</p>

                            {p.understanding_summary && (
                              <div style={{ marginBottom: 8 }}>
                                <button
                                  onClick={() => setBASummaryOpen(prev => ({ ...prev, [mid]: !prev[mid] }))}
                                  style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", color: "#cfbdff", fontSize: 11, fontWeight: 700 }}
                                >
                                  {baSummaryOpen[mid] ? "Hide summary" : "Show summary"}
                                </button>
                                {baSummaryOpen[mid] && (
                                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#cbc3d9", fontStyle: "italic", lineHeight: 1.55 }}>{p.understanding_summary}</p>
                                )}
                              </div>
                            )}

                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {misconceptions > 0 && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.12)", borderRadius: 999, padding: "3px 8px" }}>{misconceptions} misconceptions corrected</span>
                              )}
                              {forgeAttempts > 0 && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "rgba(124,58,237,0.12)", borderRadius: 999, padding: "3px 8px" }}>{forgeAttempts} forge attempts</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {baStudent.weak_topics.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: "#d97706", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#d97706", fontVariationSettings: "'FILL' 1" }}>warning</span>
                      Needs Attention
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {baStudent.weak_topics.map((topic: any) => {
                        const p = Number(topic.p_known || 0);
                        return (
                          <div key={topic.topic_id} style={{ background: "#131313", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10, padding: "10px 12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                              <span style={{ fontSize: 12, color: "#cbc3d9", fontWeight: 600 }}>{shortTopicLabel(topic.topic_name || topic.topic_id)}</span>
                              <span style={{ fontSize: 11, color: p < 0.25 ? "#ef4444" : "#d97706", fontWeight: 700 }}>{Math.round(p * 100)}%</span>
                            </div>
                            <div style={{ height: 5, background: "#1f1f1f", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${p * 100}%`, background: p < 0.25 ? "#ef4444" : "#d97706", borderRadius: 3 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "#cbc3d9", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Recent Memory Fragments</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {baStudent.fragments.slice(0, 5).map((f, idx) => (
                      <div key={`${f.topic_id}-${idx}`} style={{ background: "#131313", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(73,68,86,0.08)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: fragmentTypeColor(f.fragment_type), background: `${fragmentTypeColor(f.fragment_type)}1f`, borderRadius: 999, padding: "2px 8px" }}>{f.fragment_type}</span>
                        </div>
                        <p style={{ margin: "0 0 6px", fontSize: 12, color: "#cbc3d9", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{f.content}</p>
                        <p style={{ margin: 0, fontSize: 10, color: "#494456" }}>{shortTopicLabel(f.topic_id)} · {fmtAgo(f.created_at)}</p>
                      </div>
                    ))}
                    {baStudent.fragments.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "#494456" }}>No memory fragments yet.</p>}
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "#cbc3d9", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Recent Sessions</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {baStudent.recent_sessions.map((s) => (
                      <div key={s.id} style={{ background: "#131313", borderRadius: 10, border: "1px solid rgba(73,68,86,0.08)", padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <p style={{ margin: "0 0 2px", fontSize: 12, color: "#e2e2e2", fontWeight: 600 }}>{s.title || "Untitled session"}</p>
                          <p style={{ margin: 0, fontSize: 10, color: "#494456" }}>{fmtDate(s.created_at)}</p>
                        </div>
                        <span style={{ fontSize: 10, color: "#cbc3d9", whiteSpace: "nowrap" }}>{s.message_count} messages</span>
                      </div>
                    ))}
                    {baStudent.recent_sessions.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "#494456" }}>No recent sessions.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Student Detail Panel ── */}
        {panelOpen && (
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 520, background: "rgba(10,10,14,0.96)", backdropFilter: "blur(20px)", borderLeft: "1px solid rgba(110,40,245,0.15)", zIndex: 50, display: "flex", flexDirection: "column", animation: "slideIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards", overflowY: "auto" }}>

            {/* Panel header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(10,10,14,0.96)", backdropFilter: "blur(20px)", zIndex: 1 }}>
              <div>
                {selectedStudent && (
                  <>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e2e2e2", margin: "0 0 3px" }}>{selectedStudent.student.username}</h2>
                    <p style={{ fontSize: 11, color: "#494456", margin: 0 }}>{selectedStudent.student.email} · Batch {selectedStudent.student.batch}</p>
                  </>
                )}
                {panelLoading && <p style={{ fontSize: 14, color: "#494456", margin: 0 }}>Loading…</p>}
              </div>
              <button onClick={() => setPanelOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#494456", padding: 4 }}
                onMouseEnter={e => e.currentTarget.style.color = "#e2e2e2"}
                onMouseLeave={e => e.currentTarget.style.color = "#494456"}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>

            {selectedStudent && !panelLoading && (
              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

                {/* Quick stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  {[
                    { label: "Avg Mastery", value: `${Math.round(selectedStudent.avg_mastery * 100)}%`, color: masteryLabel(selectedStudent.avg_mastery).color },
                    { label: "Questions", value: selectedStudent.total_questions },
                    { label: "Topics", value: selectedStudent.mastery_by_topic.length },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#131313", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(73,68,86,0.08)" }}>
                      <p style={{ fontSize: 10, color: "#494456", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{m.label}</p>
                      <p style={{ fontSize: 20, fontWeight: 800, color: (m as any).color || "#e2e2e2", margin: 0 }}>{m.value}</p>
                    </div>
                  ))}
                </div>

                {/* Charts side by side */}
                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "#cbc3d9", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Mastery Breakdown</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div style={{ background: "#131313", borderRadius: 14, padding: 16, border: "1px solid rgba(73,68,86,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <RadarChart data={selectedStudent.mastery_by_topic} />
                    </div>
                    <div style={{ background: "#131313", borderRadius: 14, padding: 16, border: "1px solid rgba(73,68,86,0.08)" }}>
                      <MasteryBarChart data={selectedStudent.mastery_by_topic} />
                    </div>
                  </div>
                </div>

                {/* Recent questions */}
                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "#cbc3d9", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Recent Questions</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {selectedStudent.recent_questions.slice(0, 5).map((q, i) => (
                      <div key={i} style={{ padding: "10px 14px", background: "#131313", borderRadius: 10, border: "1px solid rgba(73,68,86,0.08)" }}>
                        <p style={{ fontSize: 12, color: "#cbc3d9", margin: "0 0 3px", lineHeight: 1.5 }}>{q.question}</p>
                        <p style={{ fontSize: 10, color: "#333", margin: 0 }}>{q.session_title} · {fmtDate(q.asked_at)}</p>
                      </div>
                    ))}
                    {selectedStudent.recent_questions.length === 0 && (
                      <p style={{ fontSize: 12, color: "#333", margin: 0 }}>No questions yet</p>
                    )}
                  </div>
                </div>

                {/* Generate Summary */}
                <div>
                  <button onClick={generateSummary} disabled={summaryLoading}
                    style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: summaryLoading ? "#1f1f1f" : "linear-gradient(135deg, #6e28f5, #3d1a8f)", color: summaryLoading ? "#494456" : "white", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: summaryLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "opacity 0.15s" }}
                    onMouseEnter={e => { if (!summaryLoading) e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >
                    {summaryLoading ? (
                      <><div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Generating AI summary…</>
                    ) : (
                      <><span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span> Generate AI Summary</>
                    )}
                  </button>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

                  {/* Summary result */}
                  {summaryOpen && summary && (
                    <div style={{ marginTop: 16, padding: "16px 18px", background: "rgba(110,40,245,0.06)", border: "1px solid rgba(110,40,245,0.2)", borderRadius: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#6e28f5", fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#cfbdff", textTransform: "uppercase", letterSpacing: "0.08em" }}>AI Summary</span>
                        <button onClick={() => setSummaryOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#494456", padding: 2 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                        </button>
                      </div>
                      <p style={{ fontSize: 13, color: "#cbc3d9", margin: 0, lineHeight: 1.75, fontFamily: "Newsreader, Georgia, serif" }}>{summary}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}