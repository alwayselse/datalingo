"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useAuthStore } from "@/store/auth";
import type { Source } from "@/types";

type ToolKey = "forge" | "formula" | "case" | "exam" | "brief";

type MessageRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  sources?: Source[];
}

interface UploadedDoc {
  filename: string;
  doc_id?: string;
  collection_id?: string;
}

interface SlashCommand {
  cmd: string;
  description: string;
  action: "send" | "tool" | "route";
  tool?: ToolKey;
}

interface ForgeResult {
  score: number;
  feedback: string;
  right: string[];
  strengthen: string[];
}

interface CaseItem {
  company: string;
  industry: string;
  challenge: string;
  data_used: string[];
  ba_techniques: string[];
  decision: string;
  outcome: string;
  discussion_questions: string[];
}

interface RecentSession {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

function materialIconStyle(size: number, color?: string) {
  return {
    fontFamily: "Material Symbols Outlined",
    fontSize: `${size}px`,
    fontStyle: "normal",
    fontWeight: "normal",
    lineHeight: 1,
    letterSpacing: "normal",
    textTransform: "none" as const,
    display: "inline-block",
    whiteSpace: "nowrap" as const,
    WebkitFontFeatureSettings: '"liga"',
    WebkitFontSmoothing: "antialiased" as const,
    color,
  };
}

function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return <span className="material-symbols-outlined" style={materialIconStyle(size, color)}>{name}</span>;
}

const TOOL_LABELS: Record<ToolKey, string> = {
  forge: "Concept Forge",
  formula: "Formula Lab",
  case: "Case Study",
  exam: "Exam Simulator",
  brief: "Pre-class Brief",
};

const BA_TOPICS = [
  "Business Analytics Frameworks & Decision-Making",
  "Customer Data & Analytics Lifecycle",
  "Data Extraction & Analytics",
  "Data Visualization & Dashboards",
  "RFM Analysis",
  "Customer Segmentation & CLV",
  "Causality in Business Analytics",
  "Experimental Design & RCTs",
  "A/B Testing & Hypothesis Testing",
  "Pricing Analytics & Revenue Mgmt",
  "Price Elasticity & Demand Sensitivity",
  "Promotion & Offer Optimization",
  "Time Series Data & Business Applications",
  "Trend, Seasonality & Cycles",
  "Forecasting Methods (MA, ES, ARIMA)",
  "Customer Retention & Churn Analytics",
  "Inventory Control & Demand Planning",
  "Supply Chain Analytics & KPIs",
  "Text & Sentiment Analysis",
  "Advanced Experimentation & Multivariate Testing",
  "Ethics, Bias & Responsible Analytics",
  "Data Privacy & Governance",
  "Capstone Project",
];

const CASE_STUDIES: CaseItem[] = [
  {
    company: "Netflix",
    industry: "Streaming",
    challenge: "Subscriber churn rose after regional price increases and uneven content engagement.",
    data_used: ["Viewing hours by segment", "Plan-level retention", "Recommendation click-through", "Regional pricing response"],
    ba_techniques: ["Churn modeling", "Cohort analysis", "A/B testing", "Price elasticity"],
    decision: "Introduced mobile-only plans in sensitive markets and re-ranked home feed based on early session behavior.",
    outcome: "Quarterly churn dropped and watch-time per active subscriber improved in target regions.",
    discussion_questions: [
      "Which leading indicators would you track weekly to predict churn spikes early?",
      "How would you design a fair A/B test for pricing changes across regions?",
      "What trade-offs exist between personalization depth and catalog diversity?",
    ],
  },
  {
    company: "Amazon",
    industry: "E-commerce",
    challenge: "Cart abandonment was high for same-day eligible products during peak windows.",
    data_used: ["Checkout funnel events", "Delivery promise accuracy", "Warehouse pick times", "Customer support tickets"],
    ba_techniques: ["Funnel analytics", "Queue optimization", "Root cause segmentation", "Forecasting"],
    decision: "Adjusted promise windows by zip-code load and surfaced reliability badges at checkout.",
    outcome: "Checkout completion increased with lower same-day cancellation rates.",
    discussion_questions: [
      "How would you separate UX friction from logistics constraints analytically?",
      "Which dashboard views would operations and product teams each need?",
      "What assumptions could bias your conversion uplift estimate?",
    ],
  },
  {
    company: "Zomato",
    industry: "Food Delivery",
    challenge: "Discount spending grew faster than net margin in key cities.",
    data_used: ["Offer redemption logs", "Order frequency", "Customer lifetime value", "Restaurant commission data"],
    ba_techniques: ["RFM segmentation", "CLV estimation", "Promotion optimization", "Causal inference"],
    decision: "Moved from broad discounts to segment-aware bundles and retention-triggered offers.",
    outcome: "Promo ROI improved with stronger repeat behavior in high-value segments.",
    discussion_questions: [
      "How would you define incremental lift versus cannibalized demand?",
      "What CLV threshold should gate discount eligibility?",
      "How do you avoid overfitting promotions to short-term behavior?",
    ],
  },
  {
    company: "Walmart",
    industry: "Retail",
    challenge: "Frequent stockouts in fast-moving categories while carrying excess inventory in others.",
    data_used: ["POS time series", "Supplier lead times", "Promotion calendar", "Store-level seasonality"],
    ba_techniques: ["EOQ", "Demand forecasting", "Safety stock modeling", "KPI monitoring"],
    decision: "Recalibrated reorder points with category-specific seasonality and lead-time variability.",
    outcome: "Lower stockouts and better inventory turns across pilot stores.",
    discussion_questions: [
      "Which forecast errors most directly hurt shelf availability?",
      "How would you validate EOQ assumptions in volatile demand periods?",
      "What KPI mix best balances service level and carrying cost?",
    ],
  },
  {
    company: "Airbnb",
    industry: "Travel",
    challenge: "Conversion dipped for first-time users despite high listing inventory.",
    data_used: ["Search-to-book funnel", "Host response times", "Review sentiment", "Pricing competitiveness"],
    ba_techniques: ["Sentiment analysis", "Experimentation", "Behavioral segmentation", "Recommendation ranking"],
    decision: "Prioritized trustworthy listings for new users and nudged hosts on response-time SLAs.",
    outcome: "First-book conversion improved and trust-related support issues declined.",
    discussion_questions: [
      "How would you quantify trust signals in a ranking model?",
      "What experiment design isolates host-response effects from price effects?",
      "Which user segments need different onboarding flows?",
    ],
  },
];

const SUGGESTION_CARDS = [
  { icon: "insights", text: "Explain RFM Analysis to me" },
  { icon: "functions", text: "What is price elasticity?" },
  { icon: "timeline", text: "Help me understand CLV formula" },
  { icon: "movie", text: "Case study: How Netflix uses data" },
];

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/mcq", description: "Generate practice questions", action: "send" },
  { cmd: "/doc", description: "Search your uploaded document", action: "send" },
  { cmd: "/forge", description: "Open Concept Forge", action: "tool", tool: "forge" },
  { cmd: "/formula", description: "Open Formula Lab", action: "tool", tool: "formula" },
  { cmd: "/case", description: "Open Case Study", action: "tool", tool: "case" },
  { cmd: "/exam", description: "Open Exam Simulator", action: "tool", tool: "exam" },
  { cmd: "/brief", description: "Open Pre-class Brief", action: "tool", tool: "brief" },
  { cmd: "/graph", description: "View Knowledge Graph", action: "route" },
];

const COLORS = {
  bg: "#0a0a0f",
  sidebar: "#0d0d14",
  surface: "#111118",
  surfaceRaised: "#1a1a24",
  border: "#2a2a3a",
  primary: "#7c3aed",
  primaryHover: "#6d28d9",
  primaryGlow: "rgba(124, 58, 237, 0.15)",
  textPrimary: "#f0f0f5",
  textSecondary: "#8b8b9e",
  textMuted: "#4a4a5e",
  success: "#059669",
  warning: "#d97706",
  error: "#dc2626",
};

function timeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sanitizeMermaid(raw: string): string {
  let c = raw.trim().replace(/\r\n/g, "\n");

  // Strip markdown fences
  c = c.replace(/```mermaid|```/g, "").trim();

  // Fix "graph TDgraph LR" duplicate — strip the second graph directive
  c = c.replace(/^(graph\s+(?:TD|LR|TB|BT|RL))(\s*graph\s+(?:TD|LR|TB|BT|RL))+/m, "$1");

  // Remove ALL edge labels — main source of parse errors
  // -->|any text| → -->
  c = c.replace(/-->\s*\|[^|\n]*\|/g, "-->");

  // Fix node labels: remove numbers, parens, special chars
  c = c.replace(/\[([^\]]+)\]/g, (_, label: string) => {
    const clean = label
      .replace(/\([^)]*\)/g, "")
      .replace(/[#@%^&*+=~`|\\<>{}]/g, "")
      .replace(/\b\d+x\d+\b/gi, "")
      .replace(/\b\d+\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return "[" + (clean || "Step") + "]";
  });

  // Remove dangling arrows at end of lines
  c = c.replace(/-->\s*$/gm, "");

  // Remove blank lines
  c = c.split("\n").filter((l: string) => l.trim() !== "").join("\n");

  // Add graph directive ONLY if missing
  if (!/^(graph|flowchart)\s+(TD|LR|TB|BT|RL)/m.test(c)) {
    c = "graph TD\n" + c;
  }

  return c;
}

function MermaidChart({ chart, isStreaming }: { chart: string; isStreaming?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    // Wait until streaming is fully done before rendering
    if (isStreaming) return;
    if (!ref.current || rendered) return;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;

    const render = async () => {
      try {
        const win = window as any;
        if (!win.mermaid) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
            script.onload = () => resolve();
            script.onerror = () => reject();
            document.head.appendChild(script);
          });
        }
        win.mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
        const { svg } = await win.mermaid.render(id, sanitizeMermaid(chart));
        if (ref.current) {
          ref.current.innerHTML = svg;
          setRendered(true);
        }
      } catch (e) {
        console.error("Mermaid error:", e);
        setError(true);
      }
    };

    render();
  }, [chart, isStreaming]);

  if (isStreaming) return (
    <div style={{ margin: "20px 0", borderRadius: 12, background: "#1b1b1b", border: "1px solid rgba(73,68,86,0.1)", padding: 24, minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "#444", fontSize: 12, fontFamily: "Manrope, sans-serif" }}>Diagram loading…</span>
    </div>
  );

  if (error) return (
    <div style={{ borderRadius: 12, background: "#1b1b1b", border: "1px solid rgba(73,68,86,0.2)", padding: 16, fontFamily: "monospace", fontSize: 13, color: "#958da2", whiteSpace: "pre-wrap" }}>
      {chart}
    </div>
  );

  return (
    <div ref={ref} style={{ margin: "20px 0", display: "flex", justifyContent: "center", overflowX: "auto", borderRadius: 12, background: "#1b1b1b", border: "1px solid rgba(73,68,86,0.1)", padding: 24, minHeight: 80 }}>
      <span style={{ color: "#333", fontSize: 12, fontFamily: "Manrope, sans-serif", alignSelf: "center" }}>Rendering diagram…</span>
    </div>
  );
}

function MessageMarkdown({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({ className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || "");
          const lang = match?.[1]?.toLowerCase();
          const raw = String(children).replace(/\n$/, "").trim();
          const isBlock = String(children).includes("\n") || !!match;
          if (isBlock && lang === "mermaid") return <MermaidChart chart={raw} isStreaming={isStreaming} />;
          if (isBlock) {
            return (
              <pre style={{ margin: "12px 0", padding: "12px 14px", borderRadius: 10, background: COLORS.bg, border: `1px solid ${COLORS.border}`, overflowX: "auto", fontSize: 12, lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
                <code>{raw}</code>
              </pre>
            );
          }
          return (
            <code style={{ background: COLORS.bg, color: "#c4b5fd", padding: "2px 6px", borderRadius: 6, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }} {...props}>
              {children}
            </code>
          );
        },
        pre({ children }: any) {
          return <>{children}</>;
        },
        p({ children }: any) {
          return <p style={{ margin: "0 0 10px", color: COLORS.textPrimary }}>{children}</p>;
        },
        ul({ children }: any) {
          return <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ul>;
        },
        ol({ children }: any) {
          return <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ol>;
        },
        li({ children }: any) {
          return <li style={{ marginBottom: 4 }}>{children}</li>;
        },
        a({ children, href }: any) {
          return <a href={href} target="_blank" rel="noreferrer" style={{ color: "#c4b5fd" }}>{children}</a>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function BusinessAnalyticsPage() {
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();
  const clearUser = clearAuth;
  const API = process.env.NEXT_PUBLIC_API_URL || "https://datalingo.in/api";

  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [uploadedDoc, setUploadedDoc] = useState<UploadedDoc | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [formulaCardIndex, setFormulaCardIndex] = useState(0);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);

  const [slashIndex, setSlashIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);

  const [forgeTopic, setForgeTopic] = useState(BA_TOPICS[0]);
  const [forgeExplanation, setForgeExplanation] = useState("");
  const [forgeLoading, setForgeLoading] = useState(false);
  const [forgeResult, setForgeResult] = useState<ForgeResult | null>(null);

  const [caseIndex, setCaseIndex] = useState(0);

  const [examTopic, setExamTopic] = useState(BA_TOPICS[0]);
  const [examDifficulty, setExamDifficulty] = useState("Intermediate");
  const [examLoading, setExamLoading] = useState(false);
  const [examQuestion, setExamQuestion] = useState("");
  const [examRubric, setExamRubric] = useState<string[]>([]);
  const [examAnswer, setExamAnswer] = useState("");
  const [examScore, setExamScore] = useState<number | null>(null);

  const [briefTopic, setBriefTopic] = useState(BA_TOPICS[0]);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefReady, setBriefReady] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formulaScrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const sidebarNav = [
    { key: "chat", icon: "chat_bubble", label: "Chat" },
    { key: "graph", icon: "account_tree", label: "Knowledge Graph" },
  ];

  const sidebarTools = [
    { key: "forge", icon: "psychology", label: "Concept Forge" },
    { key: "formula", icon: "calculate", label: "Formula Lab" },
    { key: "case", icon: "cases", label: "Case Study" },
    { key: "exam", icon: "quiz", label: "Exam Simulator" },
    { key: "brief", icon: "auto_awesome", label: "Pre-class Brief" },
  ];

  const displayName = user?.name || user?.username || "Student";
  const firstName = (displayName || "Student").split(" ")[0];

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return `Good morning, ${firstName}.`;
    if (h >= 12 && h < 17) return `Good afternoon, ${firstName}.`;
    if (h >= 17 && h < 21) return `Good evening, ${firstName}.`;
    return `Hello, ${firstName}.`;
  }, [firstName]);

  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter.trim()) return SLASH_COMMANDS;
    const q = slashFilter.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.slice(1).includes(q) || c.description.toLowerCase().includes(q));
  }, [slashFilter]);

  useEffect(() => {
    if (slashIndex >= filteredSlashCommands.length) {
      setSlashIndex(0);
    }
  }, [filteredSlashCommands.length, slashIndex]);

  useEffect(() => {
    messageScrollRef.current?.scrollTo({ top: messageScrollRef.current.scrollHeight, behavior: "smooth" });
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!isMobile) return;
    const handleResize = () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  useEffect(() => {
    if (activeTool === "formula") {
      setFormulaCardIndex(0);
      formulaScrollRef.current?.scrollTo({ left: 0, behavior: "auto" });
    }
  }, [activeTool]);

  const fetchRecentSessions = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 50));
    if (!token) {
      setRecentSessions([]);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const primary = await fetch(`${API}/chat/sessions`, { headers });
      if (!primary.ok) {
        setRecentSessions([]);
        return;
      }

      const rows = await primary.json().catch(() => []);

      if (!Array.isArray(rows)) {
        setRecentSessions([]);
        return;
      }
      const normalized = rows
        .map((s: any) => ({
          id: String(s?.id || ""),
          title: String(s?.title || "Untitled chat"),
          created_at: s?.created_at,
          updated_at: s?.updated_at,
        }))
        .filter((s: RecentSession) => !!s.id)
        .slice(0, 5);
      setRecentSessions(normalized);
    } catch {
      setRecentSessions([]);
    }
  }, [API, token]);

  const loadSessionMessages = useCallback(async (sid: string) => {
    if (!token || !sid) return;
    try {
      const res = await fetch(`${API}/chat/sessions/${sid}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      if (!Array.isArray(rows)) return;

      const mapped: ChatMessage[] = rows.map((m: any) => ({
        id: String(m?.id || crypto.randomUUID()),
        role: (m?.role === "user" ? "user" : "assistant") as MessageRole,
        content: String(m?.content || ""),
        timestamp: String(m?.created_at || new Date().toISOString()),
        sources: Array.isArray(m?.sources) ? m.sources : [],
      }));

      sessionIdRef.current = sid;
      setSessionId(sid);
      setMessages(mapped);
      setActiveTool(null);
    } catch {
      // silent
    }
  }, [API, token]);

  const startNewChat = useCallback(async () => {
    setMessages([]);
    setInput("");
    setActiveTool(null);
    setUploadedDoc(null);
    sessionIdRef.current = null;
    setSessionId(null);
    await fetchRecentSessions();
  }, [fetchRecentSessions]);

  useEffect(() => {
    if (!mounted) return;
    if (token === undefined) return;
    if (!token) {
      router.replace("/login");
      return;
    }

    let alive = true;
    const boot = async () => {
      await new Promise((r) => setTimeout(r, 50));
      if (!alive) return;
      await fetchRecentSessions();
    };

    boot();
    return () => {
      alive = false;
    };
  }, [mounted, token, router, fetchRecentSessions]);

  const adjustTextareaHeight = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  const doSendMessage = useCallback(async (actualText: string) => {
    if (!token) return;

    const assistantId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: actualText,
        timestamp: new Date().toISOString(),
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      },
    ]);

    setIsStreaming(true);

    try {
      let sessionToSend = sessionIdRef.current || sessionId;
      if (!sessionToSend) {
        sessionToSend = crypto.randomUUID();
        sessionIdRef.current = sessionToSend;
        setSessionId(sessionToSend);
      }

      const res = await fetch(`${API}/chat/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: actualText,
          session_id: sessionToSend,
        }),
      });

      if (!res.ok || !res.body) throw new Error("chat stream failed");

      const maybeSession = res.headers.get("X-Session-ID");
      if (maybeSession && !sessionIdRef.current) {
        sessionIdRef.current = maybeSession;
        setSessionId(maybeSession);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullAccumulated = "";
      let displayed = "";
      let wordQueue: string[] = [];
      let dripping = false;
      let done = false;

      const stripCitations = (text: string) => text.replace(/\[\[?\d+(?:,\s*\d+)*\]?\]/g, "");

      const drip = () => {
        if (wordQueue.length === 0) {
          dripping = false;
          return;
        }
        dripping = true;
        const next = wordQueue.shift() || "";
        displayed += next;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: stripCitations(displayed) } : m)));
        setTimeout(drip, 22);
      };

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        const chunk = decoder.decode(value, { stream: true });

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") {
            done = true;
            break;
          }

          try {
            const parsed = JSON.parse(raw);
            if (parsed.session_id && !sessionIdRef.current) {
              sessionIdRef.current = parsed.session_id;
              setSessionId(parsed.session_id);
            }

            if (parsed.token) {
              fullAccumulated += parsed.token;
              const words = String(parsed.token).split(/(?<=\s)|(?=\s)/).filter(Boolean);
              wordQueue.push(...words);
              if (!dripping) drip();
            }

            if (parsed.sources) {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, sources: parsed.sources } : m)));
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      await new Promise<void>((resolve) => {
        const check = () => {
          if (wordQueue.length === 0 && !dripping) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: stripCitations(fullAccumulated) } : m)));
      fetchRecentSessions();
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: "Something went wrong. Please try again." } : m)));
    } finally {
      setIsStreaming(false);
    }
  }, [API, token, sessionId, fetchRecentSessions]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setShowSlashMenu(false);

    const lower = text.toLowerCase();

    if (lower === "/graph" || lower.startsWith("/graph ")) {
      router.push("/business-analytics/graph");
      return;
    }

    if (lower === "/forge" || lower.startsWith("/forge ")) {
      setActiveTool("forge");
      return;
    }

    if (lower === "/formula" || lower.startsWith("/formula ")) {
      setActiveTool("formula");
      return;
    }

    if (lower === "/case" || lower.startsWith("/case ")) {
      setActiveTool("case");
      return;
    }

    if (lower === "/exam" || lower.startsWith("/exam ")) {
      setActiveTool("exam");
      return;
    }

    if (lower === "/brief" || lower.startsWith("/brief ")) {
      setActiveTool("brief");
      return;
    }

    await doSendMessage(text);
  }, [input, isStreaming, router, doSendMessage]);

  const selectSlashCommand = useCallback((command: SlashCommand) => {
    if (command.action === "route") {
      router.push("/business-analytics/graph");
      setShowSlashMenu(false);
      setInput("");
      return;
    }

    if (command.action === "tool" && command.tool) {
      setActiveTool(command.tool);
      setShowSlashMenu(false);
      setInput("");
      return;
    }

    setInput(`${command.cmd} `);
    setShowSlashMenu(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [router]);

  const handleTextKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((v) => (v + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((v) => (v - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredSlashCommands[slashIndex];
        if (cmd) selectSlashCommand(cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await sendMessage();
    }
  }, [showSlashMenu, filteredSlashCommands, slashIndex, selectSlashCommand, sendMessage]);

  const uploadFile = useCallback(async (file: File) => {
    if (!token) return;

    if (file.size > 20 * 1024 * 1024) {
      alert("File too large. Max 20MB allowed.");
      return;
    }

    const sid = sessionIdRef.current || sessionId;
    if (!sid) {
      alert("Session not ready yet. Please try again in a moment.");
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API}/ba/documents/upload?session_id=${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Upload failed");
      }

      const payload = await res.json().catch(() => ({}));
      setUploadedDoc({
        filename: payload.filename || file.name,
        doc_id: payload.doc_id,
        collection_id: payload.collection_id,
      });
    } catch {
      alert("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [API, token, sessionId]);

  const handlePickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  }, [uploadFile]);

  const runForgeEvaluation = useCallback(async () => {
    if (!forgeExplanation.trim()) return;

    setForgeLoading(true);

    const payload = {
      topic_id: forgeTopic,
      explanation: forgeExplanation,
      session_id: sessionIdRef.current,
    };

    console.log("[Concept Forge] Coming soon call payload", payload);

    await new Promise((r) => setTimeout(r, 800));

    setForgeResult({
      score: Math.max(1, Math.min(10, Math.round((forgeExplanation.length / 90) * 2))),
      feedback: "Concept Forge API is coming soon. For now this is a placeholder evaluation based on clarity and coverage.",
      right: ["You attempted a structured explanation", "You connected the topic to business impact"],
      strengthen: ["Include one concrete numeric example", "Explain assumptions and edge cases explicitly"],
    });

    setForgeLoading(false);
  }, [forgeExplanation, forgeTopic]);

  const runExamGenerate = useCallback(async () => {
    setExamLoading(true);
    setExamQuestion("");
    setExamRubric([]);
    setExamAnswer("");
    setExamScore(null);

    await new Promise((r) => setTimeout(r, 900));

    setExamQuestion("A company's customer base dropped from 1,200 to 1,080 in Q3. Calculate the churn rate and suggest two retention strategies.");
    setExamRubric([
      "Correct churn calculation (10%)",
      "Two valid strategies (20% each)",
    ]);
    setExamLoading(false);
  }, []);

  const submitExamAnswer = useCallback(() => {
    if (!examAnswer.trim()) return;
    const base = examAnswer.toLowerCase();
    let score = 55;
    if (base.includes("10")) score += 20;
    if (base.includes("retention") || base.includes("loyalty")) score += 10;
    if (base.includes("segment") || base.includes("personal")) score += 10;
    setExamScore(Math.min(100, score));
  }, [examAnswer]);

  const runBrief = useCallback(async () => {
    setBriefLoading(true);
    setBriefReady(false);
    await new Promise((r) => setTimeout(r, 850));
    setBriefReady(true);
    setBriefLoading(false);
  }, []);

  const formulaState = useMemo(() => {
    const r = 5;
    const f = 4;
    const m = 3;
    return {
      rfmRecency: r,
      rfmFrequency: f,
      rfmMonetary: m,
      clvAov: 1200,
      clvFrequency: 6,
      clvLifespan: 3,
      clvMargin: 0.32,
      pedPriceChange: 10,
      pedQtyChange: -18,
      eoqDemand: 24000,
      eoqOrdering: 1500,
      eoqHolding: 120,
      churnStart: 1200,
      churnLost: 120,
    };
  }, []);

  const [formulaInputs, setFormulaInputs] = useState(formulaState);

  const rfmScore = formulaInputs.rfmRecency * 100 + formulaInputs.rfmFrequency * 10 + formulaInputs.rfmMonetary;
  const clv = formulaInputs.clvAov * formulaInputs.clvFrequency * formulaInputs.clvLifespan * formulaInputs.clvMargin;
  const ped = formulaInputs.pedPriceChange === 0 ? 0 : formulaInputs.pedQtyChange / formulaInputs.pedPriceChange;
  const eoq = formulaInputs.eoqHolding <= 0 ? 0 : Math.sqrt((2 * formulaInputs.eoqDemand * formulaInputs.eoqOrdering) / formulaInputs.eoqHolding);
  const churn = formulaInputs.churnStart <= 0 ? 0 : (formulaInputs.churnLost / formulaInputs.churnStart) * 100;

  const rightPanelTitle = activeTool ? TOOL_LABELS[activeTool] : "";

  const recentDateLabel = useCallback((raw?: string) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  }, []);

  const trimTitle = useCallback((value: string) => {
    if (value.length <= 28) return value;
    return `${value.slice(0, 28)}...`;
  }, []);

  if (!mounted) {
    return (
      <div style={{
        height: "100vh",
        background: "#0a0a0f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          width: 32,
          height: 32,
          border: "2px solid #7c3aed",
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100%", overflow: "hidden", background: COLORS.bg, color: COLORS.textPrimary, display: "flex", fontFamily: "Manrope, sans-serif", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        @import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
        * { box-sizing: border-box; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .ba-input::placeholder {
          color: #4a4a5e;
        }
        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          font-style: normal;
          font-weight: normal;
          line-height: 1;
          letter-spacing: normal;
          text-transform: none;
          display: inline-block;
          white-space: nowrap;
          -webkit-font-feature-settings: 'liga';
          -webkit-font-smoothing: antialiased;
        }
        @media (max-width: 767px) {
          .ba-tool-scroll input,
          .ba-tool-scroll select,
          .ba-tool-scroll textarea {
            font-size: 16px !important;
          }
          .ba-tool-scroll button {
            min-height: 44px;
          }
        }
      `}</style>

      {!isMobile && (
        <div style={{ width: isTablet ? 200 : 240, height: "100vh", background: COLORS.sidebar, borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", zIndex: 20 }}>
          <div style={{ height: 48, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="school" size={24} color={COLORS.primary} />
              <span style={{ fontSize: 16, fontWeight: 700, color: COLORS.textPrimary, fontFamily: "Manrope, sans-serif" }}>Datalingo</span>
            </div>
          </div>

          <div style={{ padding: "0 8px" }}>
            <button
              onClick={startNewChat}
              style={{ width: "100%", height: 36, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceRaised, color: COLORS.textPrimary, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.border; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.surfaceRaised; }}
            >
              <Icon name="add" size={16} color={COLORS.textPrimary} />
              New Chat
            </button>
          </div>

          <div style={{ marginTop: 8, padding: "0 8px" }}>
            {sidebarNav.map((item) => {
              const active = item.key === "chat" ? activeTool === null : false;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === "graph") {
                      router.push("/business-analytics/graph");
                      return;
                    }
                    setActiveTool(null);
                  }}
                  style={{ width: "100%", height: 36, margin: "2px 0", padding: "0 12px", borderRadius: 8, border: "none", background: active ? COLORS.surfaceRaised : "transparent", color: active ? COLORS.textPrimary : COLORS.textMuted, display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif" }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = COLORS.surfaceRaised;
                      e.currentTarget.style.color = COLORS.textSecondary;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = COLORS.textMuted;
                    }
                  }}
                >
                  <Icon name={item.icon} size={18} color={active ? COLORS.textPrimary : COLORS.textMuted} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div style={{ borderTop: `1px solid ${COLORS.border}`, margin: "8px 16px" }} />

          <div style={{ padding: "0 8px" }}>
            <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: "0.08em" }}>TOOLS</div>
            {sidebarTools.map((item) => {
              const active = activeTool === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveTool(item.key as ToolKey)}
                  style={{ width: "100%", height: 36, margin: "2px 0", padding: "0 12px", borderRadius: 8, border: "none", background: active ? COLORS.surfaceRaised : "transparent", color: active ? COLORS.primary : COLORS.textMuted, display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif" }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = COLORS.surfaceRaised;
                      e.currentTarget.style.color = COLORS.textSecondary;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = COLORS.textMuted;
                    }
                  }}
                >
                  <Icon name={item.icon} size={18} color={active ? COLORS.primary : COLORS.textMuted} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {recentSessions.length > 0 && (
            <div style={{ padding: "0 8px", marginTop: 8, flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: "0.08em" }}>RECENT</div>
              <div style={{ overflowY: "auto", maxHeight: "100%" }}>
                {recentSessions.slice(0, 5).map((s) => {
                  const active = sessionId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => loadSessionMessages(s.id)}
                      style={{ width: "100%", border: "none", background: active ? COLORS.surfaceRaised : "transparent", borderRadius: 8, padding: "8px 12px", margin: "2px 0", cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif" }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = COLORS.surfaceRaised;
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div style={{ fontSize: 13, color: active ? COLORS.textPrimary : COLORS.textSecondary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trimTitle(s.title || "Untitled chat")}</div>
                      <div style={{ marginTop: 2, fontSize: 11, color: COLORS.textMuted }}>{recentDateLabel(s.updated_at || s.created_at)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginTop: "auto", borderTop: `1px solid ${COLORS.border}`, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: COLORS.primary, color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {(firstName[0] || "S").toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: COLORS.textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>student</div>
              </div>
              <button
                onClick={() => {
                  clearUser();
                  router.push("/login");
                }}
                style={{ width: 32, height: 32, border: "none", borderRadius: 8, background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = COLORS.textPrimary; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = COLORS.textMuted; }}
              >
                <Icon name="logout" size={18} color="currentColor" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: COLORS.bg, overflow: "hidden" }}>
        <div style={{ height: 52, borderBottom: `1px solid ${COLORS.border}`, padding: isMobile ? "0 12px" : "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.primary, animation: isStreaming ? "pulse 1.2s ease-in-out infinite" : "none" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>DataLingo BA</span>
            {!isMobile && <span style={{ fontSize: 13, color: COLORS.textMuted }}>·</span>}
            {!isMobile && <span style={{ fontSize: 13, color: COLORS.primary }}>{activeTool ? TOOL_LABELS[activeTool] : "Chat"}</span>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {uploadedDoc && (
              <div style={{ maxWidth: isMobile ? 36 : 240, width: isMobile ? 36 : "auto", height: isMobile ? 28 : "auto", padding: isMobile ? "0" : "5px 10px", borderRadius: 999, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceRaised, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: COLORS.textSecondary, fontSize: 12 }}>
                <Icon name="description" size={14} color={COLORS.textSecondary} />
                {!isMobile && (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {uploadedDoc.filename.length > 20 ? `${uploadedDoc.filename.slice(0, 20)}...` : uploadedDoc.filename}
                  </span>
                )}
              </div>
            )}
            {!isMobile && <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{messages.length} messages</span>}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <div ref={messageScrollRef} style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : isTablet ? "20px 24px" : "24px 40px", paddingBottom: isMobile ? 180 : 130 }}>
            {messages.length === 0 ? (
              <div style={{ paddingTop: isMobile ? 30 : 80, paddingBottom: 60 }}>
                <h1 style={{ margin: "0 0 8px", fontFamily: "Newsreader, Georgia, serif", fontStyle: "italic", fontSize: isMobile ? 28 : 40, fontWeight: 400, color: COLORS.textPrimary }}>
                  {greeting}
                </h1>
                <p style={{ margin: "0 0 48px", fontFamily: "Newsreader, Georgia, serif", fontStyle: "italic", fontSize: isMobile ? 18 : 24, color: COLORS.textMuted }}>
                  What would you like to learn today?
                </p>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, maxWidth: 600 }}>
                  {SUGGESTION_CARDS.map((card) => (
                    <button
                      key={card.text}
                      onClick={async () => {
                        setInput("");
                        await doSendMessage(card.text);
                        setTimeout(() => textareaRef.current?.focus(), 0);
                      }}
                      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12, textAlign: "left", transition: "all 0.15s ease" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = COLORS.primary;
                        e.currentTarget.style.background = COLORS.surfaceRaised;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = COLORS.border;
                        e.currentTarget.style.background = COLORS.surface;
                      }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 999, background: COLORS.surfaceRaised, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon name={card.icon} size={17} color={COLORS.primary} />
                      </div>
                      <span style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.4, fontFamily: "Manrope, sans-serif" }}>{card.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {messages.map((m) => {
                  if (m.role === "user") {
                    return (
                      <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4, textAlign: "right" }}>
                          You · {timeLabel(m.timestamp)}
                        </div>
                        <div style={{ maxWidth: isMobile ? "88%" : isTablet ? "80%" : "72%", background: COLORS.primary, color: "#ffffff", borderRadius: "16px 16px 4px 16px", padding: "12px 16px", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                          {m.content}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: COLORS.primary }} />
                        <span style={{ color: COLORS.primary, fontWeight: 600 }}>DataLingo</span>
                        <span>·</span>
                        <span>{timeLabel(m.timestamp)}</span>
                      </div>
                      <div style={{ maxWidth: isMobile ? "88%" : isTablet ? "80%" : "82%", background: COLORS.surfaceRaised, color: COLORS.textPrimary, borderRadius: "16px 16px 16px 4px", padding: "14px 18px", fontSize: 14, lineHeight: 1.7, border: `1px solid ${COLORS.border}` }}>
                        <MessageMarkdown content={m.content} isStreaming={isStreaming} />
                      </div>
                    </div>
                  );
                })}

                {isStreaming && (
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: "18px 18px 18px 4px", width: 52, height: 38, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      {[0, 1, 2].map((i) => (
                        <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: COLORS.textSecondary, display: "inline-block", animation: `bounce 1s ${i * 0.12}s infinite` }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ position: "absolute", left: 0, right: 0, bottom: isMobile ? 52 : 0, background: COLORS.bg, padding: isMobile ? `10px 12px calc(10px + env(safe-area-inset-bottom))` : "16px 24px", borderTop: `1px solid ${COLORS.border}`, zIndex: 60 }}>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp" onChange={handlePickFile} />

            <div style={{ position: "relative" }}>
              {showSlashMenu && input.startsWith("/") && (
                <div style={{ position: "absolute", left: 0, right: 0, bottom: isMobile ? 68 : 74, background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxHeight: isMobile ? 240 : 280, overflowY: "auto" }}>
                  {filteredSlashCommands.length === 0 ? (
                    <div style={{ height: isMobile ? 48 : 40, padding: "0 16px", display: "flex", alignItems: "center", color: COLORS.textMuted, fontSize: 12 }}>
                      No matching commands
                    </div>
                  ) : (
                    filteredSlashCommands.map((c, i) => (
                      <button
                        key={c.cmd}
                        onMouseEnter={() => setSlashIndex(i)}
                        onClick={() => selectSlashCommand(c)}
                        style={{
                          width: "100%",
                          height: isMobile ? 48 : 40,
                          padding: "0 16px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          border: "none",
                          cursor: "pointer",
                          background: i === slashIndex ? COLORS.border : "transparent",
                        }}
                      >
                        <span style={{ color: COLORS.primary, fontWeight: 600, fontSize: isMobile ? 14 : 13 }}>{c.cmd}</span>
                        <span style={{ color: COLORS.textSecondary, fontSize: 12 }}>{c.description}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div
                style={{
                  background: COLORS.surfaceRaised,
                  border: `1px solid ${inputFocused ? COLORS.primary : COLORS.border}`,
                  borderRadius: 14,
                  padding: isMobile ? "10px 12px" : "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  boxShadow: inputFocused ? "0 0 0 3px rgba(124,58,237,0.1)" : "none",
                  transition: "all 0.2s",
                }}
              >
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload"
                  style={{ border: "none", background: "transparent", color: COLORS.textMuted, width: isMobile ? 44 : 24, height: isMobile ? 44 : 24, padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {isUploading ? (
                    <span style={{ animation: "spin 0.9s linear infinite", display: "inline-flex" }}><Icon name="progress_activity" size={18} color={COLORS.primary} /></span>
                  ) : (
                    <Icon name="upload" size={18} color={COLORS.textMuted} />
                  )}
                </button>

                <textarea
                  className="ba-input"
                  ref={textareaRef}
                  value={input}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInput(val);
                    if (val.startsWith("/")) {
                      setShowSlashMenu(true);
                      setSlashFilter(val.slice(1).trim());
                      setSlashIndex(0);
                    } else {
                      setShowSlashMenu(false);
                      setSlashFilter("");
                    }
                  }}
                  onKeyDown={handleTextKeyDown}
                  placeholder="Ask anything..."
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: COLORS.textPrimary, fontSize: isMobile ? 16 : 14, fontFamily: "Manrope, sans-serif", resize: "none", minHeight: 22, maxHeight: 120, lineHeight: 1.6 }}
                />

                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isStreaming}
                  style={{ width: isMobile ? 44 : 36, height: isMobile ? 44 : 36, border: "none", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: input.trim() && !isStreaming ? COLORS.primary : COLORS.border, color: input.trim() && !isStreaming ? "#fff" : COLORS.textMuted, cursor: input.trim() && !isStreaming ? "pointer" : "not-allowed", transition: "all 0.2s" }}
                  onMouseEnter={(e) => {
                    if (input.trim() && !isStreaming) {
                      e.currentTarget.style.background = COLORS.primaryHover;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (input.trim() && !isStreaming) {
                      e.currentTarget.style.background = COLORS.primary;
                    }
                  }}
                >
                  <Icon name="arrow_upward" size={18} color={input.trim() && !isStreaming ? "#fff" : COLORS.textMuted} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isMobile && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: `calc(52px + env(safe-area-inset-bottom))`, paddingBottom: "env(safe-area-inset-bottom)", background: COLORS.sidebar, borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-around", alignItems: "center", zIndex: 50 }}>
          {[
            { icon: "chat_bubble", label: "Chat", action: () => setActiveTool(null), active: activeTool === null },
            { icon: "psychology", label: "Forge", action: () => setActiveTool("forge"), active: activeTool === "forge" },
            { icon: "calculate", label: "Formula", action: () => setActiveTool("formula"), active: activeTool === "formula" },
            { icon: "cases", label: "Cases", action: () => setActiveTool("case"), active: activeTool === "case" },
            { icon: "more_horiz", label: "More", action: () => setShowMoreSheet(true), active: showMoreSheet },
          ].map((item) => (
            <button key={item.label} onClick={item.action} style={{ minWidth: 44, minHeight: 44, border: "none", background: "transparent", color: item.active ? COLORS.primary : COLORS.textMuted, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer" }}>
              <Icon name={item.icon} size={22} color={item.active ? COLORS.primary : COLORS.textMuted} />
              <span style={{ fontSize: 9, fontWeight: 500 }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {isMobile && showMoreSheet && (
        <>
          <div onClick={() => setShowMoreSheet(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 149 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150, background: COLORS.sidebar, borderTop: `1px solid ${COLORS.border}`, borderRadius: "16px 16px 0 0", padding: 16, animation: "slideUp 0.3s ease" }}>
            <div style={{ width: 32, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 16px" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {[
                { icon: "quiz", label: "Exam", action: () => setActiveTool("exam") },
                { icon: "auto_awesome", label: "Brief", action: () => setActiveTool("brief") },
                { icon: "account_tree", label: "Graph", action: () => router.push("/business-analytics/graph") },
                { icon: "upload_file", label: "Upload Doc", action: () => fileInputRef.current?.click() },
                { icon: "logout", label: "Logout", action: () => { clearUser(); router.push("/login"); } },
              ].map((item) => (
                <button key={item.label} onClick={() => { item.action(); setShowMoreSheet(false); }} style={{ minHeight: 44, border: "none", borderRadius: 10, background: COLORS.surfaceRaised, color: COLORS.textSecondary, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, cursor: "pointer" }}>
                  <Icon name={item.icon} size={22} color={COLORS.textSecondary} />
                  <span style={{ fontSize: 12 }}>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {isMobile && activeTool && (
        <div onClick={() => setActiveTool(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 199 }} />
      )}

      <div style={isMobile ? { position: "fixed", left: 0, right: 0, bottom: 0, height: "85vh", zIndex: 200, background: COLORS.sidebar, borderTop: `1px solid ${COLORS.border}`, borderRadius: "20px 20px 0 0", overflow: "hidden", transform: activeTool ? "translateY(0)" : "translateY(100%)", transition: "transform 0.3s ease", pointerEvents: activeTool ? "auto" : "none", animation: activeTool ? "slideUp 0.3s ease" : "none", display: "flex", flexDirection: "column" } : { width: activeTool ? (isTablet ? 320 : 380) : 0, opacity: activeTool ? 1 : 0, overflow: "hidden", transition: "width 0.25s ease, opacity 0.25s ease", background: COLORS.sidebar, borderLeft: activeTool ? `1px solid ${COLORS.border}` : "none", display: "flex", flexDirection: "column" }}>
        {activeTool && (
          <>
            {isMobile && <div style={{ width: 32, height: 4, borderRadius: 2, background: COLORS.border, margin: "12px auto 0" }} />}
            <div style={{ minHeight: 52, borderBottom: `1px solid ${COLORS.border}`, padding: isMobile ? "0 16px" : "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.sidebar }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{rightPanelTitle}</div>
              <button onClick={() => setActiveTool(null)} style={{ border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44 }}>
                <Icon name="close" size={18} color={COLORS.textMuted} />
              </button>
            </div>

            <div className="ba-tool-scroll" style={{ flex: 1, overflowY: "auto", padding: isMobile ? 16 : 14 }}>
              {activeTool === "forge" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Pick a topic</label>
                  <select value={forgeTopic} onChange={(e) => setForgeTopic(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
                    {BA_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Explain it in your own words</label>
                  <textarea value={forgeExplanation} onChange={(e) => setForgeExplanation(e.target.value)} placeholder="Pretend you're explaining this to a friend who has never studied business analytics..." style={{ width: "100%", minHeight: 120, resize: "vertical", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.textPrimary, padding: "10px 12px", lineHeight: 1.6, fontSize: 13, marginBottom: 12 }} />

                  <button onClick={runForgeEvaluation} disabled={forgeLoading || !forgeExplanation.trim()} style={{ width: "100%", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, fontWeight: 600, cursor: forgeLoading || !forgeExplanation.trim() ? "not-allowed" : "pointer", opacity: forgeLoading || !forgeExplanation.trim() ? 0.6 : 1 }}>
                    {forgeLoading ? "Analyzing..." : "Evaluate My Understanding"}
                  </button>

                  {!forgeResult && !forgeLoading && (
                    <div style={{ marginTop: 12, background: COLORS.surface, border: `1px dashed ${COLORS.border}`, borderRadius: 10, padding: 12, color: COLORS.textSecondary, fontSize: 12 }}>
                      Coming soon: backend scoring endpoint will be wired in Part 3.
                    </div>
                  )}

                  {forgeResult && (
                    <div style={{ marginTop: 14, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surfaceRaised, padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, color: COLORS.textSecondary }}>Score</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: forgeResult.score <= 4 ? COLORS.error : forgeResult.score <= 7 ? COLORS.warning : COLORS.success }}>{forgeResult.score}/10</span>
                      </div>
                      <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>{forgeResult.feedback}</div>

                      <div style={{ marginBottom: 8 }}>
                        <div style={{ color: COLORS.success, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What you got right</div>
                        {forgeResult.right.map((item) => <div key={item} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 }}>• {item}</div>)}
                      </div>

                      <div style={{ marginBottom: 10 }}>
                        <div style={{ color: COLORS.warning, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What to strengthen</div>
                        {forgeResult.strengthen.map((item) => <div key={item} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 }}>• {item}</div>)}
                      </div>

                      <button onClick={() => { setForgeResult(null); setForgeExplanation(""); }} style={{ border: `1px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 10px", cursor: "pointer", width: "100%" }}>Try again</button>
                    </div>
                  )}
                </div>
              )}

              {activeTool === "formula" && (
                <div>
                  <div
                    ref={formulaScrollRef}
                    onScroll={(e) => {
                      if (!isMobile) return;
                      const el = e.currentTarget;
                      const cardWidth = el.clientWidth + 12;
                      const idx = Math.round(el.scrollLeft / cardWidth);
                      setFormulaCardIndex(Math.max(0, Math.min(4, idx)));
                    }}
                    style={isMobile ? { display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory", paddingBottom: 6, WebkitOverflowScrolling: "touch" } : {}}
                  >
                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>RFM Score</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>RFM = R×100 + F×10 + M</div>
                    {[{ k: "rfmRecency", label: "Recency score (1-5)" }, { k: "rfmFrequency", label: "Frequency score (1-5)" }, { k: "rfmMonetary", label: "Monetary score (1-5)" }].map((f) => (
                      <input
                        key={f.k}
                        type="number"
                        value={(formulaInputs as any)[f.k]}
                        min={1}
                        max={5}
                        onChange={(e) => setFormulaInputs((prev) => ({ ...prev, [f.k]: Number(e.target.value || 0) }))}
                        style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }}
                        placeholder={f.label}
                      />
                    ))}
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{rfmScore}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>{rfmScore === 111 ? "Worst segment" : rfmScore === 555 ? "Best champion" : "Higher is better"}</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Customer Lifetime Value (CLV)</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>CLV = AOV × frequency × lifespan × margin</div>
                    {[
                      { k: "clvAov", label: "Average order value" },
                      { k: "clvFrequency", label: "Purchase frequency per year" },
                      { k: "clvLifespan", label: "Customer lifespan years" },
                      { k: "clvMargin", label: "Gross margin (0-1)" },
                    ].map((f) => (
                      <input
                        key={f.k}
                        type="number"
                        value={(formulaInputs as any)[f.k]}
                        step="any"
                        onChange={(e) => setFormulaInputs((prev) => ({ ...prev, [f.k]: Number(e.target.value || 0) }))}
                        style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }}
                        placeholder={f.label}
                      />
                    ))}
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{clv.toFixed(2)}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Worth acquiring if CAC &lt; CLV</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Price Elasticity of Demand (PED)</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>PED = %ΔQ / %ΔP</div>
                    <input type="number" value={formulaInputs.pedPriceChange} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, pedPriceChange: Number(e.target.value || 0) }))} placeholder="Price change %" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.pedQtyChange} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, pedQtyChange: Number(e.target.value || 0) }))} placeholder="Quantity change %" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{ped.toFixed(2)}</div>
                    <div style={{ color: Math.abs(ped) > 1 ? COLORS.warning : COLORS.success, fontSize: 12 }}>{Math.abs(ped) > 1 ? "Elastic (|PED|>1)" : "Inelastic (|PED|<1)"}</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Economic Order Quantity (EOQ)</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>EOQ = √(2DS/H)</div>
                    <input type="number" value={formulaInputs.eoqDemand} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, eoqDemand: Number(e.target.value || 0) }))} placeholder="Annual demand" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.eoqOrdering} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, eoqOrdering: Number(e.target.value || 0) }))} placeholder="Ordering cost" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.eoqHolding} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, eoqHolding: Number(e.target.value || 0) }))} placeholder="Holding cost per unit" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{Number.isFinite(eoq) ? eoq.toFixed(0) : "0"}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Order {Number.isFinite(eoq) ? eoq.toFixed(0) : "0"} units per order</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Churn Rate</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>Churn = (lost/start) × 100</div>
                    <input type="number" value={formulaInputs.churnStart} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, churnStart: Number(e.target.value || 0) }))} placeholder="Customers start" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.churnLost} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, churnLost: Number(e.target.value || 0) }))} placeholder="Customers lost" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{churn.toFixed(2)}%</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Retention rate = {(100 - churn).toFixed(2)}%</div>
                  </div>
                  </div>

                  {isMobile && (
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
                      {[0, 1, 2, 3, 4].map((idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            const el = formulaScrollRef.current;
                            if (!el) return;
                            el.scrollTo({ left: idx * (el.clientWidth + 12), behavior: "smooth" });
                            setFormulaCardIndex(idx);
                          }}
                          style={{ width: 8, height: 8, borderRadius: 999, border: "none", padding: 0, background: formulaCardIndex === idx ? COLORS.primary : COLORS.border, cursor: "pointer" }}
                          aria-label={`Go to formula card ${idx + 1}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTool === "case" && (
                <div>
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 12, paddingBottom: 4 }}>
                    {CASE_STUDIES.map((c, idx) => (
                      <button
                        key={c.company}
                        onClick={() => setCaseIndex(idx)}
                        style={{ border: `1px solid ${caseIndex === idx ? COLORS.primary : COLORS.border}`, background: caseIndex === idx ? COLORS.primary : COLORS.surfaceRaised, color: caseIndex === idx ? "#fff" : COLORS.textSecondary, borderRadius: 20, padding: "7px 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {c.company}
                      </button>
                    ))}
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.textPrimary }}>{CASE_STUDIES[caseIndex].company}</div>
                      <span style={{ background: COLORS.border, color: COLORS.textSecondary, fontSize: 11, borderRadius: 4, padding: "2px 8px" }}>{CASE_STUDIES[caseIndex].industry}</span>
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>The Challenge</div>
                      <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.6 }}>{CASE_STUDIES[caseIndex].challenge}</div>
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>Data Used</div>
                      {CASE_STUDIES[caseIndex].data_used.map((item) => <div key={item} style={{ color: COLORS.textPrimary, fontSize: 13, marginBottom: 3 }}>• {item}</div>)}
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 6 }}>BA Techniques Applied</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {CASE_STUDIES[caseIndex].ba_techniques.map((item) => <span key={item} style={{ fontSize: 11, color: "#ddd6fe", background: "rgba(124,58,237,0.22)", border: `1px solid ${COLORS.primary}`, borderRadius: 999, padding: "3px 8px" }}>{item}</span>)}
                      </div>
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>The Decision</div>
                      <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.6 }}>{CASE_STUDIES[caseIndex].decision}</div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>Outcome</div>
                      <div style={{ color: COLORS.success, fontSize: 13, lineHeight: 1.6 }}>{CASE_STUDIES[caseIndex].outcome}</div>
                    </div>

                    <div style={{ color: COLORS.primary, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Discuss with AI →</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {CASE_STUDIES[caseIndex].discussion_questions.map((q) => (
                        <button
                          key={q}
                          onClick={async () => {
                            await doSendMessage(q);
                            setActiveTool(null);
                            setTimeout(() => textareaRef.current?.focus(), 0);
                          }}
                          style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary, borderRadius: 16, padding: "7px 10px", fontSize: 12, textAlign: "left", cursor: "pointer" }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTool === "exam" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Topic</label>
                  <select value={examTopic} onChange={(e) => setExamTopic(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                    {BA_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Difficulty</label>
                  <select value={examDifficulty} onChange={(e) => setExamDifficulty(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                    <option>Beginner</option>
                    <option>Intermediate</option>
                    <option>Advanced</option>
                  </select>

                  <button onClick={runExamGenerate} style={{ width: "100%", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>
                    Generate Question
                  </button>

                  {examLoading && (
                    <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10 }}>Generating question...</div>
                  )}

                  {!!examQuestion && (
                    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surfaceRaised, padding: 12, marginBottom: 12 }}>
                      <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>{examQuestion}</div>
                      <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 6 }}>Rubric</div>
                      {examRubric.map((r) => <div key={r} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 3 }}>• {r}</div>)}

                      <textarea value={examAnswer} onChange={(e) => setExamAnswer(e.target.value)} placeholder="Write your answer..." style={{ width: "100%", minHeight: 100, marginTop: 10, resize: "vertical", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.textPrimary, padding: "8px 10px", lineHeight: 1.6 }} />

                      <button onClick={submitExamAnswer} style={{ width: "100%", marginTop: 8, background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, cursor: "pointer" }}>Submit Answer</button>

                      {examScore !== null && (
                        <div style={{ marginTop: 10, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 10, background: COLORS.bg }}>
                          <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Result</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: examScore >= 75 ? COLORS.success : examScore >= 50 ? COLORS.warning : COLORS.error }}>{examScore}/100</div>
                          {examRubric.map((r) => <div key={`${r}-res`} style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 4 }}>• {r}</div>)}
                          <button onClick={() => { setExamQuestion(""); setExamRubric([]); setExamAnswer(""); setExamScore(null); }} style={{ marginTop: 10, width: "100%", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceRaised, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>Next Question</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTool === "brief" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Topic</label>
                  <select value={briefTopic} onChange={(e) => setBriefTopic(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                    {BA_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <button onClick={runBrief} style={{ width: "100%", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>
                    Generate Brief
                  </button>

                  {briefLoading && (
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Generating brief...</div>
                  )}

                  {briefReady && (
                    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden", background: COLORS.surfaceRaised }}>
                      <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, background: "rgba(5,150,105,0.12)" }}>
                        <div style={{ color: COLORS.success, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What you already know</div>
                        <div style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 1.6 }}>You understand baseline metrics and can interpret simple dashboard trends.</div>
                      </div>
                      <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, background: "rgba(59,130,246,0.12)" }}>
                        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What's coming</div>
                        <div style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 1.6 }}>You will connect this topic to business decisions with case-based reasoning and formula trade-offs.</div>
                      </div>
                      <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, background: "rgba(217,119,6,0.12)" }}>
                        <div style={{ color: COLORS.warning, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Watch out for</div>
                        <div style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 1.6 }}>Common mistakes: mixing correlation with causality and ignoring segment-level effects.</div>
                      </div>
                      <div style={{ padding: 12, background: "rgba(124,58,237,0.12)" }}>
                        <div style={{ color: COLORS.primary, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Key formulas to remember</div>
                        <div style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 1.6 }}>CLV, churn, elasticity, and forecasting error basics.</div>
                        <div style={{ marginTop: 8, color: COLORS.textSecondary, fontSize: 11 }}>Estimated read: 5 min prep</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
