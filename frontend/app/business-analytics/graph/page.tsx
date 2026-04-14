"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";

declare global {
  interface Window {
    THREE?: any;
  }
}

type UnitId = 1 | 2 | 3 | 4;
type UnitFilter = "all" | "1" | "2" | "3" | "4";
type MasteryState = "locked" | "unassessed" | "explored" | "intermediate" | "advanced";

interface TopicDef {
  id: string;
  name: string;
  unit: UnitId;
  order: number;
  prerequisites: string[];
  subtopics: string[];
  description: string;
}

interface TopicMerged extends TopicDef {
  p_known: number;
  mastery_level: string;
  session_count: number;
  last_studied_at: string | null;
  understanding_summary: string | null;
  misconceptions_count: number;
  forge_attempts_count: number;
  state: MasteryState;
}

interface PalaceRow {
  topic_id?: string;
  topic_name?: string;
  p_known?: number;
  mastery_level?: string;
  understanding_summary?: string;
  session_count?: number;
  last_studied_at?: string;
  misconceptions?: unknown[] | number;
  forge_attempts?: unknown[] | number;
  name?: string;
}

interface MasteryRow {
  topic_id?: string;
  topic_name?: string;
  p_known?: number;
  mastery_level?: string;
  assessment_count?: number;
  name?: string;
}

interface TooltipState {
  x: number;
  y: number;
  topicId: string;
}

const COLORS = {
  bg: "#0a0a0f",
  surface: "#111118",
  surfaceRaised: "#1a1a24",
  border: "#2a2a3a",
  primary: "#7c3aed",
  textPrimary: "#f0f0f5",
  textSecondary: "#8b8b9e",
  textMuted: "#4a4a5e",
  unit1: "#6e28f5",
  unit2: "#2563eb",
  unit3: "#059669",
  unit4: "#dc2626",
  success: "#059669",
  warning: "#d97706",
};

const SHORT_LABELS: Record<string, string> = {
  ba_frameworks: "BA Frameworks",
  customer_data: "Customer Data",
  data_extraction: "Data Extraction",
  data_viz_dashboards: "Dashboards",
  rfm_analysis: "RFM Analysis",
  customer_seg_clv: "Seg. & CLV",
  causality_ba: "Causality",
  experimental_design: "Exp. Design",
  ab_testing: "A/B Testing",
  pricing_analytics: "Pricing Analytics",
  price_elasticity: "Price Elasticity",
  promo_optimization: "Promo Optim.",
  time_series_ba: "Time Series",
  trend_seasonality: "Trend & Seasonality",
  forecasting_methods: "Forecasting",
  churn_analytics: "Churn Analytics",
  inventory_control: "Inventory Control",
  supply_chain_kpis: "Supply Chain",
  text_sentiment: "Text & Sentiment",
  multivariate_testing: "Multivariate Test",
  ethics_bias: "Ethics & Bias",
  data_privacy: "Data Privacy",
  ba_capstone: "BA Capstone",
};

const UNIT_META: Record<UnitId, { name: string; color: string; center: { x: number; y: number; z: number } }> = {
  1: { name: "Foundations", color: COLORS.unit1, center: { x: 0, y: 0, z: 0 } },
  2: { name: "Customer", color: COLORS.unit2, center: { x: 120, y: 40, z: 0 } },
  3: { name: "Forecasting", color: COLORS.unit3, center: { x: -120, y: 40, z: 0 } },
  4: { name: "Advanced", color: COLORS.unit4, center: { x: 0, y: 120, z: -20 } },
};

const TOPICS: TopicDef[] = [
  {
    id: "ba_frameworks",
    name: "Business Analytics Frameworks & Decision-Making",
    unit: 1,
    order: 1,
    prerequisites: [],
    subtopics: ["CRISP-DM", "Decision frameworks", "KPI mapping"],
    description: "Core frameworks for turning ambiguous business questions into measurable analytics decisions.",
  },
  {
    id: "customer_data",
    name: "Customer Data & Analytics Lifecycle",
    unit: 1,
    order: 2,
    prerequisites: [],
    subtopics: ["Data lifecycle", "Touchpoints", "Governance basics"],
    description: "How customer data is captured, cleaned, analyzed, and fed back into business operations.",
  },
  {
    id: "data_extraction",
    name: "Data Extraction & Analytics",
    unit: 1,
    order: 3,
    prerequisites: ["customer_data"],
    subtopics: ["SQL extraction", "Cleaning", "Feature-ready datasets"],
    description: "Transforming raw business data into reliable analytical datasets.",
  },
  {
    id: "data_viz_dashboards",
    name: "Data Visualization & Dashboards",
    unit: 1,
    order: 4,
    prerequisites: ["ba_frameworks"],
    subtopics: ["Dashboard hierarchy", "Visual encoding", "Narrative design"],
    description: "Creating decision-ready dashboards that communicate signal over noise.",
  },
  {
    id: "rfm_analysis",
    name: "RFM Analysis",
    unit: 2,
    order: 5,
    prerequisites: ["customer_data"],
    subtopics: ["Recency", "Frequency", "Monetary scoring"],
    description: "Segmenting customers by value and engagement using RFM logic.",
  },
  {
    id: "customer_seg_clv",
    name: "Customer Segmentation & CLV",
    unit: 2,
    order: 6,
    prerequisites: ["rfm_analysis"],
    subtopics: ["Behavioral segments", "CLV components", "Retention targeting"],
    description: "Combining segmentation and lifetime value to prioritize acquisition and retention.",
  },
  {
    id: "causality_ba",
    name: "Causality in Business Analytics",
    unit: 2,
    order: 7,
    prerequisites: ["ba_frameworks"],
    subtopics: ["Causal graphs", "Confounders", "Counterfactuals"],
    description: "Distinguishing true causal impact from correlation in business decisions.",
  },
  {
    id: "experimental_design",
    name: "Experimental Design & RCTs",
    unit: 2,
    order: 8,
    prerequisites: ["causality_ba"],
    subtopics: ["Randomization", "Sample size", "Control/treatment"],
    description: "Designing valid experiments for product and growth decisions.",
  },
  {
    id: "ab_testing",
    name: "A/B Testing & Hypothesis Testing",
    unit: 2,
    order: 9,
    prerequisites: ["experimental_design"],
    subtopics: ["p-values", "Power", "Significance vs impact"],
    description: "Operationalizing business hypotheses through robust experimentation.",
  },
  {
    id: "pricing_analytics",
    name: "Pricing Analytics & Revenue Mgmt",
    unit: 2,
    order: 10,
    prerequisites: ["customer_seg_clv"],
    subtopics: ["Price ladders", "Yield management", "Revenue optimization"],
    description: "Using analytics to set prices that optimize growth and profitability.",
  },
  {
    id: "price_elasticity",
    name: "Price Elasticity & Demand Sensitivity",
    unit: 2,
    order: 11,
    prerequisites: ["pricing_analytics"],
    subtopics: ["Elasticity", "Demand curves", "Sensitivity bands"],
    description: "Estimating demand response to pricing changes across segments.",
  },
  {
    id: "promo_optimization",
    name: "Promotion & Offer Optimization",
    unit: 2,
    order: 12,
    prerequisites: ["price_elasticity", "ab_testing"],
    subtopics: ["Offer design", "Lift modeling", "ROI control"],
    description: "Optimizing promotional strategy without destroying long-term margin.",
  },
  {
    id: "time_series_ba",
    name: "Time Series Data & Business Applications",
    unit: 3,
    order: 13,
    prerequisites: ["data_extraction"],
    subtopics: ["Temporal granularity", "Lag effects", "Business cycles"],
    description: "Applying time-indexed analytics to business performance trends.",
  },
  {
    id: "trend_seasonality",
    name: "Trend, Seasonality & Cycles",
    unit: 3,
    order: 14,
    prerequisites: ["time_series_ba"],
    subtopics: ["Decomposition", "Seasonality", "Cycle interpretation"],
    description: "Separating long-term trend from periodic patterns in business data.",
  },
  {
    id: "forecasting_methods",
    name: "Forecasting Methods (MA, ES, ARIMA)",
    unit: 3,
    order: 15,
    prerequisites: ["trend_seasonality"],
    subtopics: ["Moving average", "Exponential smoothing", "ARIMA"],
    description: "Selecting and evaluating forecasting methods for planning decisions.",
  },
  {
    id: "churn_analytics",
    name: "Customer Retention & Churn Analytics",
    unit: 3,
    order: 16,
    prerequisites: ["customer_seg_clv"],
    subtopics: ["Churn diagnostics", "Retention interventions", "Risk scoring"],
    description: "Predicting churn risk and designing effective retention actions.",
  },
  {
    id: "inventory_control",
    name: "Inventory Control & Demand Planning",
    unit: 3,
    order: 17,
    prerequisites: ["forecasting_methods"],
    subtopics: ["EOQ", "Safety stock", "Reorder points"],
    description: "Balancing stock availability with carrying costs through demand planning.",
  },
  {
    id: "supply_chain_kpis",
    name: "Supply Chain Analytics & KPIs",
    unit: 3,
    order: 18,
    prerequisites: ["inventory_control"],
    subtopics: ["OTIF", "Lead-time variability", "Fill-rate dashboards"],
    description: "Tracking supply chain performance with operational KPI systems.",
  },
  {
    id: "text_sentiment",
    name: "Text & Sentiment Analysis",
    unit: 4,
    order: 19,
    prerequisites: ["data_extraction"],
    subtopics: ["Sentiment scoring", "Theme extraction", "Feedback mining"],
    description: "Extracting business signal from unstructured customer text.",
  },
  {
    id: "multivariate_testing",
    name: "Advanced Experimentation & Multivariate Testing",
    unit: 4,
    order: 20,
    prerequisites: ["ab_testing"],
    subtopics: ["Factor effects", "Interaction terms", "Multi-factor tests"],
    description: "Scaling beyond A/B into multi-variable experimentation.",
  },
  {
    id: "ethics_bias",
    name: "Ethics, Bias & Responsible Analytics",
    unit: 4,
    order: 21,
    prerequisites: ["ba_frameworks"],
    subtopics: ["Bias audits", "Fairness checks", "Responsible deployment"],
    description: "Ensuring analytics systems are fair, transparent, and accountable.",
  },
  {
    id: "data_privacy",
    name: "Data Privacy & Governance",
    unit: 4,
    order: 22,
    prerequisites: ["ethics_bias"],
    subtopics: ["Consent", "Retention policy", "Regulatory obligations"],
    description: "Governing business data usage under privacy and compliance constraints.",
  },
  {
    id: "ba_capstone",
    name: "Capstone Project",
    unit: 4,
    order: 23,
    prerequisites: ["forecasting_methods", "promo_optimization", "supply_chain_kpis"],
    subtopics: ["Problem framing", "Integrated solution", "Decision narrative"],
    description: "End-to-end business analytics application combining all course capabilities.",
  },
];

function normalizeTopicName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeterministicPosition(topic: TopicDef) {
  const center = UNIT_META[topic.unit].center;
  const rand = mulberry32(topic.order * 9973 + topic.unit * 101);
  const radius = 8 + rand() * 32;
  const theta = rand() * Math.PI * 2;
  const phi = Math.acos(2 * rand() - 1);

  return {
    x: center.x + radius * Math.sin(phi) * Math.cos(theta),
    y: center.y + radius * Math.cos(phi),
    z: center.z + radius * Math.sin(phi) * Math.sin(theta),
  };
}

function shadeHex(hex: string, factor: number) {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(0, 2), 16) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(2, 4), 16) * factor)));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(4, 6), 16) * factor)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function relativeTime(value: string | null) {
  if (!value) return "Never";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "Unknown";
  const diff = Date.now() - dt.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return dt.toLocaleDateString();
}

function getStateLabel(state: MasteryState) {
  if (state === "locked") return "Locked";
  if (state === "unassessed") return "Unassessed";
  if (state === "explored") return "Exploring";
  if (state === "intermediate") return "Intermediate";
  return "Advanced";
}

function getTopicLabel(topicId: string) {
  return SHORT_LABELS[topicId] ?? topicId;
}

function toUnitFromFilter(filter: UnitFilter): UnitId | null {
  if (filter === "all") return null;
  const asNum = Number(filter);
  if (asNum >= 1 && asNum <= 4) return asNum as UnitId;
  return null;
}

function materialIconStyle(size: number, color = "#8b8b9e") {
  return {
    fontFamily: "Material Symbols Outlined",
    fontSize: `${size}px`,
    fontStyle: "normal" as const,
    fontWeight: "normal" as const,
    lineHeight: 1,
    letterSpacing: "normal",
    textTransform: "none" as const,
    display: "inline-block" as const,
    whiteSpace: "nowrap" as const,
    WebkitFontFeatureSettings: '"liga"',
    WebkitFontSmoothing: "antialiased" as const,
    color,
  };
}

function getStateVisual(topic: TopicMerged) {
  const unitColor = UNIT_META[topic.unit].color;

  if (topic.state === "locked") {
    return {
      radius: 3.7,
      color: "#1a1a24",
      opacity: 0.18,
      glow: 0,
      wireframe: false,
      labelColor: "#272736",
      pulse: false,
      particles: false,
      crown: false,
      clickable: false,
    };
  }

  if (topic.state === "unassessed") {
    return {
      radius: 4.2,
      color: "#3a3a52",
      opacity: 0.32,
      glow: 0,
      wireframe: true,
      labelColor: "#58597a",
      pulse: false,
      particles: false,
      crown: false,
      clickable: true,
    };
  }

  if (topic.state === "explored") {
    return {
      radius: 5.2,
      color: shadeHex(unitColor, 0.52),
      opacity: 0.72,
      glow: 0.38,
      wireframe: false,
      labelColor: "#9ea0b8",
      pulse: false,
      particles: false,
      crown: false,
      clickable: true,
    };
  }

  if (topic.state === "intermediate") {
    return {
      radius: 7.2,
      color: shadeHex(unitColor, 0.86),
      opacity: 0.95,
      glow: 0.92,
      wireframe: false,
      labelColor: "#f5f6ff",
      pulse: true,
      particles: false,
      crown: false,
      clickable: true,
    };
  }

  return {
    radius: 9.4,
    color: unitColor,
    opacity: 1,
    glow: 1.35,
    wireframe: false,
    labelColor: "#ffffff",
    pulse: false,
    particles: true,
    crown: true,
    clickable: true,
  };
}

function classifyState(topic: TopicDef, pKnown: number, sessionCount: number, allById: Record<string, TopicMerged | null>) {
  const hasPrereqs = topic.prerequisites.length > 0;
  const locked = hasPrereqs && topic.prerequisites.every((pid) => (allById[pid]?.p_known ?? 0) < 0.3);
  if (locked) return "locked" as MasteryState;
  if (pKnown <= 0 && sessionCount <= 0) return "unassessed" as MasteryState;
  if (sessionCount > 0 && pKnown < 0.4) return "explored" as MasteryState;
  if (pKnown >= 0.7) return "advanced" as MasteryState;
  return "intermediate" as MasteryState;
}

async function ensureThreeR128() {
  if (window.THREE) return window.THREE;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-three-r128="1"]') as HTMLScriptElement | null;
    if (existing && window.THREE) {
      resolve();
      return;
    }

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Three.js")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
    script.async = true;
    script.dataset.threeR128 = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Three.js r128"));
    document.head.appendChild(script);
  });

  return window.THREE;
}

function buildLockTexture(THREE: any) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.clearRect(0, 0, 96, 96);
  ctx.strokeStyle = "#8b8b9e";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(48, 34, 16, Math.PI, 0);
  ctx.stroke();

  ctx.fillStyle = "#1a1a24";
  ctx.strokeStyle = "#8b8b9e";
  ctx.lineWidth = 4;
  ctx.fillRect(28, 42, 40, 32);
  ctx.strokeRect(28, 42, 40, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function buildFallbackTopics() {
  const fallback: Record<string, TopicMerged> = {};
  TOPICS.forEach((topic) => {
    fallback[topic.id] = {
      ...topic,
      p_known: 0,
      mastery_level: "unassessed",
      session_count: 0,
      last_studied_at: null,
      understanding_summary: null,
      misconceptions_count: 0,
      forge_attempts_count: 0,
      state: "unassessed",
    };
  });

  Object.values(fallback).forEach((topic) => {
    fallback[topic.id] = { ...topic, state: classifyState(topic, topic.p_known, topic.session_count, fallback as any) };
  });

  return fallback;
}

export default function BAGraphPage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const API = process.env.NEXT_PUBLIC_API_URL || "https://datalingo.in/api";

  const mountRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const raycasterRef = useRef<any>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const frameRef = useRef<number>(0);
  const nodeMeshMapRef = useRef<Record<string, any>>({});
  const nodeMetaRef = useRef<Record<string, { position: { x: number; y: number; z: number }; visual: ReturnType<typeof getStateVisual> }>>({});
  const ringMapRef = useRef<Record<string, any>>({});
  const labelMapRef = useRef<Record<string, HTMLDivElement>>({});

  const edgeItemsRef = useRef<Array<{ sourceId: string; targetId: string; state: "locked" | "available" | "mastered"; line: any; dash?: any; particles?: any[]; from: any; to: any }>>([]);
  const advancedOrbitsRef = useRef<Array<{ topicId: string; orbitGroup: any; angleOffset: number }>>([]);
  const hoveredTopicIdRef = useRef<string | null>(null);
  const selectedTopicIdRef = useRef<string | null>(null);
  const unitFilterRef = useRef<UnitFilter>("all");
  const topicsRef = useRef<Record<string, TopicMerged>>({});

  const dragRef = useRef({ active: false, lastX: 0, lastY: 0, touchDist: 0 });
  const sphericalRef = useRef({ theta: 0, phi: 1.279, radius: 208.8 });
  const autoRotateRef = useRef(true);
  const hasInteractedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [topics, setTopics] = useState<Record<string, TopicMerged>>({});
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [hoveredTopicId, setHoveredTopicId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const [unitFilter, setUnitFilter] = useState<UnitFilter>("all");
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTopic = selectedTopicId ? topics[selectedTopicId] || null : null;

  useEffect(() => {
    hoveredTopicIdRef.current = hoveredTopicId;
  }, [hoveredTopicId]);

  useEffect(() => {
    selectedTopicIdRef.current = selectedTopicId;
  }, [selectedTopicId]);

  useEffect(() => {
    unitFilterRef.current = unitFilter;

    const activeUnit = toUnitFromFilter(unitFilter);

    Object.entries(nodeMeshMapRef.current).forEach(([topicId, mesh]) => {
      const topic = topics[topicId];
      if (!topic || !mesh) return;

      const visibleForUnit = activeUnit === null || topic.unit === activeUnit;
      mesh.userData.filterTarget = visibleForUnit ? 1 : 0.08;

      const label = labelMapRef.current[topicId];
      if (label) {
        label.style.opacity = visibleForUnit ? "1" : "0.12";
      }
    });

    edgeItemsRef.current.forEach((edge) => {
      const sourceTopic = topics[edge.sourceId];
      const targetTopic = topics[edge.targetId];
      if (!sourceTopic || !targetTopic) return;

      const visibleForUnit = activeUnit === null || sourceTopic.unit === activeUnit || targetTopic.unit === activeUnit;
      const edgeFade = visibleForUnit ? 1 : 0.08;
      const baseOpacity = edge.state === "mastered" ? 0.85 : edge.state === "available" ? 0.5 : 0.3;

      if (edge.line?.material) {
        edge.line.material.opacity = baseOpacity * edgeFade;
      }
      if (edge.dash?.material) {
        edge.dash.material.opacity = 0.9 * edgeFade;
      }
      if (edge.particles?.length) {
        edge.particles.forEach((particle) => {
          particle.visible = edgeFade > 0.09;
          particle.material.opacity = 0.85 * edgeFade;
        });
      }
    });
  }, [unitFilter, topics]);

  useEffect(() => {
    if (isMobile) {
      setTooltip(null);
      setHoveredTopicId(null);
      setLegendOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  const advancedCount = useMemo(() => Object.values(topics).filter((t) => t.state === "advanced").length, [topics]);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (token === undefined) return;
    if (!token) {
      setTopics(buildFallbackTopics());
      setLoading(false);
      return;
    }

    let alive = true;

    const loadData = async () => {
      await new Promise((r) => setTimeout(r, 50));
      if (!alive) return;
      setLoading(true);

      try {
        const headers = { Authorization: `Bearer ${token}` };

        const [masteryRes, palaceRes] = await Promise.all([
          fetch(`${API}/analytics/me`, { headers }),
          fetch(`${API}/analytics/ba/palace`, { headers }).catch(() => null),
        ]);

        let masteryPayload: any = {};
        if (masteryRes.ok) {
          masteryPayload = await masteryRes.json().catch(() => ({}));
        }

        let palaceRows: PalaceRow[] = [];
        if (palaceRes && palaceRes.ok) {
          const payload = await palaceRes.json().catch(() => []);
          if (Array.isArray(payload)) palaceRows = payload;
          if (Array.isArray(payload?.rows)) palaceRows = payload.rows;
        }

        const masteryRows: MasteryRow[] = [
          ...(Array.isArray(masteryPayload?.concept_mastery) ? masteryPayload.concept_mastery : []),
          ...(Array.isArray(masteryPayload?.mastery_by_topic) ? masteryPayload.mastery_by_topic : []),
        ];

        const byIdMastery: Record<string, MasteryRow> = {};
        const byNameMastery: Record<string, MasteryRow> = {};

        masteryRows.forEach((row) => {
          if (row.topic_id) byIdMastery[String(row.topic_id)] = row;
          const n = row.topic_name || row.name;
          if (n) byNameMastery[normalizeTopicName(n)] = row;
        });

        const byIdPalace: Record<string, PalaceRow> = {};
        const byNamePalace: Record<string, PalaceRow> = {};

        palaceRows.forEach((row) => {
          if (row.topic_id) byIdPalace[String(row.topic_id)] = row;
          const n = row.topic_name || row.name;
          if (n) byNamePalace[normalizeTopicName(n)] = row;
        });

        const placeholder: Record<string, TopicMerged | null> = {};
        TOPICS.forEach((topic) => {
          placeholder[topic.id] = null;
        });

        const merged: Record<string, TopicMerged> = {};
        TOPICS.forEach((topic) => {
          const nameKey = normalizeTopicName(topic.name);
          const masteryRow = byIdMastery[topic.id] || byNameMastery[nameKey];
          const palaceRow = byIdPalace[topic.id] || byNamePalace[nameKey];

          const pKnown = Number(
            palaceRow?.p_known ?? masteryRow?.p_known ?? 0,
          );
          const sessionCount = Number(palaceRow?.session_count ?? masteryRow?.assessment_count ?? 0);

          const misconceptionsRaw = palaceRow?.misconceptions;
          const forgeRaw = palaceRow?.forge_attempts;

          const misconceptionsCount = Array.isArray(misconceptionsRaw)
            ? misconceptionsRaw.length
            : typeof misconceptionsRaw === "number"
              ? misconceptionsRaw
              : 0;

          const forgeAttemptsCount = Array.isArray(forgeRaw)
            ? forgeRaw.length
            : typeof forgeRaw === "number"
              ? forgeRaw
              : 0;

          merged[topic.id] = {
            ...topic,
            p_known: Number.isFinite(pKnown) ? Math.max(0, Math.min(1, pKnown)) : 0,
            mastery_level: String(palaceRow?.mastery_level || masteryRow?.mastery_level || "unassessed"),
            session_count: Number.isFinite(sessionCount) ? Math.max(0, sessionCount) : 0,
            last_studied_at: palaceRow?.last_studied_at || null,
            understanding_summary: palaceRow?.understanding_summary || null,
            misconceptions_count: misconceptionsCount,
            forge_attempts_count: forgeAttemptsCount,
            state: "unassessed",
          };
        });

        const withState: Record<string, TopicMerged> = {};
        Object.values(merged).forEach((topic) => {
          withState[topic.id] = {
            ...topic,
            state: classifyState(topic, topic.p_known, topic.session_count, placeholder as any),
          };
        });

        Object.values(withState).forEach((topic) => {
          withState[topic.id] = {
            ...topic,
            state: classifyState(topic, topic.p_known, topic.session_count, withState as any),
          };
        });

        if (!alive) return;
        setTopics(withState);
      } catch {
        if (!alive) return;
        setTopics(buildFallbackTopics());
      } finally {
        if (alive) setLoading(false);
      }
    };

    loadData();

    return () => {
      alive = false;
    };
  }, [API, token, mounted]);

  useEffect(() => {
    if (loading || Object.keys(topics).length === 0 || !mountRef.current || !labelsRef.current) {
      return;
    }

    let cleaned = false;

    const setup = async () => {
      const THREE = await ensureThreeR128();
      if (cleaned || !mountRef.current || !labelsRef.current) return;

      const mountEl = mountRef.current;
      const labelsEl = labelsRef.current;
      labelsEl.innerHTML = "";

      const width = mountEl.clientWidth;
      const height = mountEl.clientHeight;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.setClearColor(0x000000, 0);
      mountEl.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
      const initialRadius = isMobile ? 300 : isTablet ? 240 : 208.8;
      const initialPhi = isMobile ? 1.12 : 1.279;
      sphericalRef.current = { theta: 0, phi: initialPhi, radius: initialRadius };
      camera.position.set(0, isMobile ? 80 : 60, initialRadius);
      camera.lookAt(0, 0, 0);

      const raycaster = new THREE.Raycaster();

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      raycasterRef.current = raycaster;

      nodeMeshMapRef.current = {};
      nodeMetaRef.current = {};
      ringMapRef.current = {};
      labelMapRef.current = {};
      edgeItemsRef.current = [];
      advancedOrbitsRef.current = [];

      scene.add(new THREE.AmbientLight(0xffffff, 0.25));

      const keyLight = new THREE.PointLight(0x7c3aed, 1.4, 1000);
      keyLight.position.set(0, 200, 260);
      scene.add(keyLight);

      const fillLight = new THREE.PointLight(0x2563eb, 1.1, 1000);
      fillLight.position.set(-220, -120, 120);
      scene.add(fillLight);

      const rimLight = new THREE.PointLight(0x059669, 0.9, 1000);
      rimLight.position.set(240, 80, -220);
      scene.add(rimLight);

      const starsGeo = new THREE.BufferGeometry();
      const starPos = new Float32Array(1800 * 3);
      for (let i = 0; i < 1800; i += 1) {
        starPos[i * 3] = (Math.random() - 0.5) * 1800;
        starPos[i * 3 + 1] = (Math.random() - 0.5) * 1800;
        starPos[i * 3 + 2] = (Math.random() - 0.5) * 1800;
      }
      starsGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
      const stars = new THREE.Points(
        starsGeo,
        new THREE.PointsMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, size: 1.5, sizeAttenuation: true }),
      );
      scene.add(stars);

      const lockTexture = buildLockTexture(THREE);

      const positions: Record<string, any> = {};
      Object.values(topics).forEach((topic) => {
        const pos = buildDeterministicPosition(topic);
        positions[topic.id] = new THREE.Vector3(pos.x, pos.y, pos.z);
      });

      Object.values(topics).forEach((topic) => {
        const visual = getStateVisual(topic);
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(visual.radius, 28, 28),
          new THREE.MeshPhongMaterial({
            color: new THREE.Color(visual.color),
            transparent: true,
            opacity: visual.opacity,
            emissive: new THREE.Color(UNIT_META[topic.unit].color),
            emissiveIntensity: visual.glow,
            shininess: 80,
          }),
        );

        mesh.position.copy(positions[topic.id]);
        mesh.userData = {
          id: topic.id,
          state: topic.state,
          baseOpacity: visual.opacity,
          baseScale: 1,
          clickable: visual.clickable,
          pulse: visual.pulse,
          filterUnit: topic.unit,
          filterTarget: 1,
          hoverScale: 1,
          selectedScale: 1,
        };

        if (visual.wireframe) {
          const wire = new THREE.Mesh(
            new THREE.SphereGeometry(visual.radius + 0.35, 20, 20),
            new THREE.MeshBasicMaterial({ color: 0x4a4a5e, transparent: true, opacity: 0.7, wireframe: true }),
          );
          mesh.add(wire);
        }

        if (visual.glow > 0) {
          const glow = new THREE.Mesh(
            new THREE.SphereGeometry(visual.radius * 1.3, 20, 20),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(UNIT_META[topic.unit].color), transparent: true, opacity: 0.15 + visual.glow * 0.1, side: THREE.BackSide }),
          );
          mesh.add(glow);
        }

        if (topic.state === "advanced") {
          const core = new THREE.Mesh(
            new THREE.SphereGeometry(visual.radius * 0.42, 18, 18),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34 }),
          );
          mesh.add(core);

          const aura = new THREE.Mesh(
            new THREE.SphereGeometry(visual.radius * 1.55, 20, 20),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(UNIT_META[topic.unit].color), transparent: true, opacity: 0.2, side: THREE.BackSide }),
          );
          mesh.add(aura);

          const orbitGroup = new THREE.Group();
          for (let i = 0; i < 3; i += 1) {
            const p = new THREE.Mesh(
              new THREE.SphereGeometry(1, 10, 10),
              new THREE.MeshBasicMaterial({ color: new THREE.Color(UNIT_META[topic.unit].color), transparent: true, opacity: 0.95 }),
            );
            p.userData.angle = (Math.PI * 2 * i) / 3;
            orbitGroup.add(p);
          }
          mesh.add(orbitGroup);
          advancedOrbitsRef.current.push({ topicId: topic.id, orbitGroup, angleOffset: Math.random() * Math.PI * 2 });
        }

        if (topic.state === "advanced" && visual.crown) {
          const crown = new THREE.Mesh(
            new THREE.SphereGeometry(1.4, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
          );
          crown.position.set(0, visual.radius + 4.2, 0);
          mesh.add(crown);
        }

        if (topic.state === "locked") {
          const lockSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTexture, transparent: true, opacity: 0.9 }));
          lockSprite.scale.set(10, 10, 1);
          lockSprite.position.set(0, visual.radius + 8, 0);
          mesh.add(lockSprite);
        }

        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(visual.radius + 2.4, 0.42, 12, 48),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(UNIT_META[topic.unit].color), transparent: true, opacity: 0.95 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.visible = false;
        mesh.add(ring);

        ringMapRef.current[topic.id] = ring;

        scene.add(mesh);
        nodeMeshMapRef.current[topic.id] = mesh;
        nodeMetaRef.current[topic.id] = {
          position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
          visual,
        };

        const label = document.createElement("div");
        label.textContent = getTopicLabel(topic.id);
        label.style.position = "absolute";
        label.style.pointerEvents = "none";
        label.style.fontFamily = "Manrope, sans-serif";
        label.style.fontSize = "11px";
        label.style.color = visual.labelColor;
        label.style.textShadow = "0 2px 8px rgba(0,0,0,0.95), 0 0 1px rgba(0,0,0,0.8)";
        label.style.transform = "translateX(-50%) translateY(-50%)";
        label.style.whiteSpace = "nowrap";
        label.style.fontWeight = topic.state === "advanced" ? "700" : "500";
        label.style.letterSpacing = "0.01em";
        label.style.padding = "2px 4px";
        label.style.borderRadius = "6px";
        label.style.background = "rgba(10,10,15,0.22)";
        labelsEl.appendChild(label);
        labelMapRef.current[topic.id] = label;
      });

      Object.values(topics).forEach((target) => {
        target.prerequisites.forEach((sourceId) => {
          const source = topics[sourceId];
          if (!source) return;

          const sourceMesh = nodeMeshMapRef.current[sourceId];
          const targetMesh = nodeMeshMapRef.current[target.id];
          if (!sourceMesh || !targetMesh) return;

          const sourcePos = sourceMesh.position.clone();
          const targetPos = targetMesh.position.clone();

          let edgeState: "locked" | "available" | "mastered" = "locked";

          if ((source.state === "intermediate" || source.state === "advanced") && (target.state === "intermediate" || target.state === "advanced")) {
            edgeState = "mastered";
          } else if (source.p_known >= 0.7 && target.state === "unassessed") {
            edgeState = "available";
          } else if (source.state === "unassessed" || target.state === "unassessed") {
            edgeState = "locked";
          }

          let line: any;
          let dash: any;
          let particles: any[] | undefined;

          if (edgeState === "locked") {
            const geom = new THREE.BufferGeometry().setFromPoints([sourcePos, targetPos]);
            const mat = new THREE.LineDashedMaterial({ color: new THREE.Color(COLORS.border), transparent: true, opacity: 0.3, dashSize: 5, gapSize: 3 });
            line = new THREE.Line(geom, mat);
            line.computeLineDistances();
            scene.add(line);
          } else if (edgeState === "available") {
            const baseGeom = new THREE.BufferGeometry().setFromPoints([sourcePos, targetPos]);
            const baseMat = new THREE.LineBasicMaterial({ color: new THREE.Color(UNIT_META[target.unit].color), transparent: true, opacity: 0.5 });
            line = new THREE.Line(baseGeom, baseMat);
            scene.add(line);

            const dashGeom = new THREE.BufferGeometry().setFromPoints([sourcePos, targetPos]);
            const dashMat = new THREE.LineDashedMaterial({ color: new THREE.Color(UNIT_META[target.unit].color), transparent: true, opacity: 0.9, dashSize: 4, gapSize: 2 });
            dash = new THREE.Line(dashGeom, dashMat);
            dash.computeLineDistances();
            dash.material.userData = { dashOffset: 0 };
            scene.add(dash);
          } else {
            const geom = new THREE.BufferGeometry();
            const points = new Float32Array([
              sourcePos.x, sourcePos.y, sourcePos.z,
              targetPos.x, targetPos.y, targetPos.z,
            ]);
            const colors = new Float32Array([
              new THREE.Color(UNIT_META[source.unit].color).r,
              new THREE.Color(UNIT_META[source.unit].color).g,
              new THREE.Color(UNIT_META[source.unit].color).b,
              new THREE.Color(UNIT_META[target.unit].color).r,
              new THREE.Color(UNIT_META[target.unit].color).g,
              new THREE.Color(UNIT_META[target.unit].color).b,
            ]);
            geom.setAttribute("position", new THREE.BufferAttribute(points, 3));
            geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
            line = new THREE.Line(geom, mat);
            scene.add(line);

            particles = [];
            for (let i = 0; i < 3; i += 1) {
              const p = new THREE.Mesh(
                new THREE.SphereGeometry(1.1, 8, 8),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(UNIT_META[target.unit].color), transparent: true, opacity: 0.95 }),
              );
              p.userData.t = i / 3;
              scene.add(p);
              particles.push(p);
            }
          }

          edgeItemsRef.current.push({
            sourceId,
            targetId: target.id,
            state: edgeState,
            line,
            dash,
            particles,
            from: sourcePos,
            to: targetPos,
          });
        });
      });

      const onResize = () => {
        if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
        const w = mountRef.current.clientWidth;
        const h = mountRef.current.clientHeight;
        rendererRef.current.setSize(w, h);
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      };

      const setInteraction = () => {
        if (!hasInteractedRef.current) {
          hasInteractedRef.current = true;
          autoRotateRef.current = false;
        }
      };

      const canvas = renderer.domElement;

      const updatePointerNorm = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        pointerRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      };

      const performHoverRaycast = (clientX: number, clientY: number) => {
        updatePointerNorm(clientX, clientY);
        raycaster.setFromCamera(pointerRef.current, camera);
        const meshes = Object.values(nodeMeshMapRef.current);
        const hits = raycaster.intersectObjects(meshes, false);
        const hit = hits.find((h: any) => h.object?.userData?.id);

        if (!hit) {
          setHoveredTopicId(null);
          setTooltip(null);
          canvas.style.cursor = "default";
          return;
        }

        const id = String(hit.object.userData.id);
        const canClick = Boolean(hit.object.userData.clickable);
        setHoveredTopicId(id);
        setTooltip({ x: clientX, y: clientY, topicId: id });
        canvas.style.cursor = canClick ? "pointer" : "default";
      };

      const onMouseDown = (e: MouseEvent) => {
        dragRef.current.active = true;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
      };

      const onMouseMove = (e: MouseEvent) => {
        performHoverRaycast(e.clientX, e.clientY);
        if (!dragRef.current.active) return;

        const dx = e.clientX - dragRef.current.lastX;
        const dy = e.clientY - dragRef.current.lastY;

        if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
          setInteraction();
          sphericalRef.current.theta -= dx * 0.005;
          sphericalRef.current.phi = Math.max(0.22, Math.min(Math.PI - 0.22, sphericalRef.current.phi + dy * 0.005));
          dragRef.current.lastX = e.clientX;
          dragRef.current.lastY = e.clientY;
        }
      };

      const onMouseUp = () => {
        dragRef.current.active = false;
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        setInteraction();
        sphericalRef.current.radius = Math.max(80, Math.min(420, sphericalRef.current.radius + e.deltaY * 0.2));
      };

      const onClick = (e: MouseEvent) => {
        updatePointerNorm(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerRef.current, camera);

        const meshes = Object.values(nodeMeshMapRef.current);
        const hits = raycaster.intersectObjects(meshes, false);
        const hit = hits.find((h: any) => h.object?.userData?.id);

        if (!hit) {
          setSelectedTopicId(null);
          return;
        }

        const id = String(hit.object.userData.id);
        if (!hit.object.userData.clickable) return;
        setSelectedTopicId(id);
      };

      const touchDistance = (t1: Touch, t2: Touch) => {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const onTouchStart = (e: TouchEvent) => {
        setInteraction();
        if (e.touches.length === 1) {
          dragRef.current.active = true;
          dragRef.current.lastX = e.touches[0].clientX;
          dragRef.current.lastY = e.touches[0].clientY;
        }
        if (e.touches.length === 2) {
          dragRef.current.touchDist = touchDistance(e.touches[0], e.touches[1]);
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 1 && dragRef.current.active) {
          const dx = e.touches[0].clientX - dragRef.current.lastX;
          const dy = e.touches[0].clientY - dragRef.current.lastY;
          sphericalRef.current.theta -= dx * 0.006;
          sphericalRef.current.phi = Math.max(0.22, Math.min(Math.PI - 0.22, sphericalRef.current.phi + dy * 0.006));
          dragRef.current.lastX = e.touches[0].clientX;
          dragRef.current.lastY = e.touches[0].clientY;
        }

        if (e.touches.length === 2) {
          const nextDist = touchDistance(e.touches[0], e.touches[1]);
          const delta = dragRef.current.touchDist - nextDist;
          sphericalRef.current.radius = Math.max(80, Math.min(420, sphericalRef.current.radius + delta * 0.4));
          dragRef.current.touchDist = nextDist;
        }
      };

      const onTouchEnd = () => {
        dragRef.current.active = false;
      };

      window.addEventListener("resize", onResize);
      canvas.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("click", onClick);
      canvas.addEventListener("touchstart", onTouchStart, { passive: true });
      canvas.addEventListener("touchmove", onTouchMove, { passive: true });
      canvas.addEventListener("touchend", onTouchEnd, { passive: true });

      const tmpVec = new THREE.Vector3();
      const clock = new THREE.Clock();

      const animate = () => {
        if (cleaned) return;

        const t = clock.getElapsedTime();

        if (autoRotateRef.current) {
          sphericalRef.current.theta += 0.001;
        }

        const theta = sphericalRef.current.theta;
        const phi = sphericalRef.current.phi;
        const radius = sphericalRef.current.radius;

        camera.position.set(
          radius * Math.sin(phi) * Math.sin(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.cos(theta),
        );
        camera.lookAt(0, 0, 0);

        Object.values(topics).forEach((topic) => {
          const mesh = nodeMeshMapRef.current[topic.id];
          const visual = nodeMetaRef.current[topic.id]?.visual;
          if (!mesh || !visual) return;

          const mat = mesh.material;

          const filterFactor = Number(mesh.userData.filterTarget ?? 1);
          const targetOpacity = visual.opacity * filterFactor;
          mat.opacity += (targetOpacity - mat.opacity) * 0.1;

          const isHovered = hoveredTopicIdRef.current === topic.id;
          const isSelected = selectedTopicIdRef.current === topic.id;

          let pulse = 1;
          if (visual.pulse) {
            pulse = 1 + 0.05 * Math.sin((Math.PI * 2 * t) / 3);
          }

          const hoverScale = isHovered ? 1.2 : 1;
          const selectedScale = isSelected ? 1.3 : 1;
          const targetScale = pulse * hoverScale * selectedScale;
          mesh.scale.x += (targetScale - mesh.scale.x) * 0.15;
          mesh.scale.y += (targetScale - mesh.scale.y) * 0.15;
          mesh.scale.z += (targetScale - mesh.scale.z) * 0.15;

          const ring = ringMapRef.current[topic.id];
          if (ring) {
            ring.visible = isSelected;
            if (isSelected) {
              ring.rotation.z += 0.02;
            }
          }

          if (topic.state === "intermediate") {
            mat.emissiveIntensity = visual.glow + 0.14 * Math.sin(t * 1.5);
          } else if (topic.state === "advanced") {
            mat.emissiveIntensity = visual.glow + 0.36 * Math.sin(t * 2);
          } else {
            mat.emissiveIntensity = visual.glow;
          }

          const label = labelMapRef.current[topic.id];
          if (label) {
            tmpVec.copy(mesh.position);
            tmpVec.project(camera);

            const lx = (tmpVec.x * 0.5 + 0.5) * width;
            const ly = (-tmpVec.y * 0.5 + 0.5) * height;
            const activeFilterUnit = toUnitFromFilter(unitFilterRef.current);
            const passesFilter = activeFilterUnit === null || topic.unit === activeFilterUnit;
            const mobileAllowed = !isMobile || isSelected || isHovered || topic.state === "intermediate" || topic.state === "advanced";

            label.style.left = `${lx}px`;
            label.style.top = `${ly}px`;
            const shouldShowLabel = passesFilter && mobileAllowed;
            label.style.display = tmpVec.z > 1 || !shouldShowLabel ? "none" : "block";

            if (isHovered || isSelected) {
              label.style.fontSize = isMobile ? "12px" : "14px";
              label.style.color = COLORS.textPrimary;
              label.style.fontWeight = "700";
              label.style.background = "rgba(10,10,15,0.72)";
            } else {
              label.style.fontSize = isMobile ? "10px" : "11.5px";
              label.style.color = visual.labelColor;
              label.style.fontWeight = topic.state === "advanced" ? "700" : "500";
              label.style.background = "rgba(10,10,15,0.22)";
            }
          }
        });

        edgeItemsRef.current.forEach((edge) => {
          const sourceTopic = topicsRef.current[edge.sourceId];
          const targetTopic = topicsRef.current[edge.targetId];

          const activeFilter = toUnitFromFilter(unitFilterRef.current);
          const fade = activeFilter === null || sourceTopic?.unit === activeFilter || targetTopic?.unit === activeFilter ? 1 : 0.08;

          if (edge.line?.material) {
            edge.line.material.opacity += ((edge.state === "mastered" ? 0.85 : edge.state === "available" ? 0.5 : 0.3) * fade - edge.line.material.opacity) * 0.1;
          }

          if (edge.state === "available" && edge.dash?.material) {
            edge.dash.material.opacity += (0.9 * fade - edge.dash.material.opacity) * 0.1;
            edge.dash.material.userData.dashOffset = (edge.dash.material.userData.dashOffset || 0) - 0.08;
            edge.dash.material.dashOffset = edge.dash.material.userData.dashOffset;
          }

          if (edge.state === "mastered" && edge.particles?.length) {
            edge.particles.forEach((particle) => {
              particle.visible = fade > 0.09;
              particle.material.opacity = 0.85 * fade;
              particle.userData.t = (particle.userData.t + 0.008) % 1;
              const tt = particle.userData.t;
              particle.position.set(
                edge.from.x + (edge.to.x - edge.from.x) * tt,
                edge.from.y + (edge.to.y - edge.from.y) * tt,
                edge.from.z + (edge.to.z - edge.from.z) * tt,
              );
            });
          }
        });

        advancedOrbitsRef.current.forEach((item) => {
          const mesh = nodeMeshMapRef.current[item.topicId];
          if (!mesh) return;
          item.orbitGroup.children.forEach((child: any, idx: number) => {
            const base = (child.userData.angle || 0) + item.angleOffset + t * (0.8 + idx * 0.2);
            const r = 10 + idx * 1.5;
            child.position.set(Math.cos(base) * r, Math.sin(base * 1.2) * 2.5, Math.sin(base) * r);
          });
        });

        renderer.render(scene, camera);
        frameRef.current = requestAnimationFrame(animate);
      };

      frameRef.current = requestAnimationFrame(animate);

      const cleanup = () => {
        cancelAnimationFrame(frameRef.current);

        window.removeEventListener("resize", onResize);
        canvas.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("click", onClick);
        canvas.removeEventListener("touchstart", onTouchStart);
        canvas.removeEventListener("touchmove", onTouchMove);
        canvas.removeEventListener("touchend", onTouchEnd);

        Object.values(labelMapRef.current).forEach((el) => el.remove());
        labelMapRef.current = {};

        edgeItemsRef.current.forEach((edge) => {
          if (edge.line) scene.remove(edge.line);
          if (edge.dash) scene.remove(edge.dash);
          edge.particles?.forEach((p) => scene.remove(p));
        });
        edgeItemsRef.current = [];

        Object.values(nodeMeshMapRef.current).forEach((mesh) => {
          scene.remove(mesh);
          mesh.geometry?.dispose?.();
          mesh.material?.dispose?.();
        });

        nodeMeshMapRef.current = {};
        ringMapRef.current = {};
        advancedOrbitsRef.current = [];

        renderer.dispose();
        if (renderer.domElement.parentElement === mountEl) {
          mountEl.removeChild(renderer.domElement);
        }
      };

      (renderer as any).__cleanup = cleanup;
    };

    setup();

    return () => {
      cleaned = true;
      const r = rendererRef.current as any;
      if (r?.__cleanup) {
        r.__cleanup();
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      raycasterRef.current = null;
    };
  }, [topics, loading, isMobile, isTablet]);

  const tooltipTopic = tooltip?.topicId ? topics[tooltip.topicId] : null;

  const canStartLearning = selectedTopic && selectedTopic.state !== "locked";
  const showTestMyself = selectedTopic && (selectedTopic.state === "intermediate" || selectedTopic.state === "advanced");

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
    <div style={{ width: "100vw", height: "100vh", background: COLORS.bg, position: "relative", overflow: "hidden", fontFamily: "Manrope, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #0a0a0f; }
        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          font-weight: normal;
          font-style: normal;
          font-size: 20px;
          line-height: 1;
          display: inline-block;
          white-space: nowrap;
          direction: ltr;
          -webkit-font-feature-settings: 'liga';
          -webkit-font-smoothing: antialiased;
        }
      `}</style>

      <div ref={mountRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />
      <div ref={labelsRef} style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }} />

      {!isMobile && tooltip && tooltipTopic && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x + 16,
            top: tooltip.y + 16,
            width: 200,
            background: COLORS.surfaceRaised,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            zIndex: 30,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: COLORS.textPrimary, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{getTopicLabel(tooltipTopic.id)}</div>
          <div style={{ width: "100%", height: 4, borderRadius: 4, background: COLORS.border, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ width: `${Math.round((tooltipTopic.p_known || 0) * 100)}%`, height: "100%", background: UNIT_META[tooltipTopic.unit].color }} />
          </div>
          <div style={{ color: COLORS.textSecondary, fontSize: 11 }}>{Math.round((tooltipTopic.p_known || 0) * 100)}% mastery</div>
          {tooltipTopic.session_count > 0 && (
            <div style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 4 }}>Sessions: {tooltipTopic.session_count}</div>
          )}
        </div>
      )}

      <button
        onClick={() => router.push("/business-analytics")}
        style={{
          position: "absolute",
          top: isMobile ? 10 : 16,
          left: isMobile ? 10 : 16,
          zIndex: 20,
          background: COLORS.surfaceRaised,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8,
          padding: isMobile ? "10px" : "8px 14px",
          minWidth: isMobile ? 44 : "auto",
          minHeight: isMobile ? 44 : "auto",
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 0 : 6,
          fontSize: 13,
          color: COLORS.textSecondary,
          cursor: "pointer",
        }}
      >
        <span className="material-symbols-outlined" style={materialIconStyle(20, "#8b8b9e")}>arrow_back</span>
        {!isMobile && <span>Workspace</span>}
      </button>

      <div style={{ position: "absolute", top: isMobile ? 20 : 16, left: "50%", transform: "translateX(-50%)", zIndex: 20, color: COLORS.textPrimary, fontSize: isMobile ? 13 : 14, fontWeight: 600 }}>
        Knowledge Graph
      </div>

      <div style={{ position: "absolute", top: isMobile ? 10 : 16, right: isMobile ? 10 : 16, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        {isMobile && (
          <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 999, padding: "6px 10px", color: COLORS.textSecondary, fontSize: 11 }}>
            {advancedCount}/23 mastered
          </div>
        )}
        <button
          onClick={() => setLegendOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: COLORS.surfaceRaised,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: isMobile ? "10px" : "7px 10px",
            minWidth: isMobile ? 44 : "auto",
            minHeight: isMobile ? 44 : "auto",
            color: COLORS.textSecondary,
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          <span className="material-symbols-outlined" style={materialIconStyle(20, "#8b8b9e")}>legend_toggle</span>
          {!isMobile && <span style={{ fontSize: 12 }}>Legend</span>}
        </button>

        {legendOpen && (
          <div style={{ marginTop: 0, background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, width: isMobile ? 168 : 200 }}>
            {[
              { label: "Locked", color: "#272736" },
              { label: "Unassessed", color: "#58597a" },
              { label: "Exploring", color: "#9ea0b8" },
              { label: "Intermediate", color: "#f5f6ff" },
              { label: "Advanced", color: "#ffffff" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: item.color, display: "inline-block" }} />
                <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ position: "absolute", bottom: isMobile ? 10 : 16, left: "50%", transform: "translateX(-50%)", zIndex: 20, display: "flex", gap: 8, background: "transparent", maxWidth: isMobile ? "94vw" : "none", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? "env(safe-area-inset-bottom)" : 0 }}>
        {([
          { id: "all", label: "All" },
          { id: "1", label: "Foundations" },
          { id: "2", label: "Customer" },
          { id: "3", label: "Forecasting" },
          { id: "4", label: "Advanced" },
        ] as Array<{ id: UnitFilter; label: string }>).map((item) => {
          const active = unitFilter === item.id;
          const activeColor = item.id === "all" ? COLORS.primary : UNIT_META[Number(item.id) as UnitId].color;
          return (
            <button
              key={String(item.id)}
              onClick={() => setUnitFilter(item.id)}
              style={{
                border: `1px solid ${active ? activeColor : COLORS.border}`,
                background: active ? activeColor : COLORS.surfaceRaised,
                color: active ? "#fff" : COLORS.textSecondary,
                borderRadius: 999,
                padding: isMobile ? "10px 12px" : "7px 12px",
                minHeight: isMobile ? 44 : "auto",
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {isMobile ? (item.id === "1" ? "Fdn" : item.id === "2" ? "Cust" : item.id === "3" ? "Fcast" : item.id === "4" ? "Adv" : "All") : item.label}
            </button>
          );
        })}
      </div>

      {!isMobile && (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            width: 260,
            background: COLORS.surfaceRaised,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 12,
            zIndex: 20,
          }}
        >
          <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Course Progress</div>
          <div style={{ width: "100%", height: 6, borderRadius: 3, background: COLORS.surface, overflow: "hidden", marginBottom: 8 }}>
            <div
              style={{
                width: `${(advancedCount / 23) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg, #7c3aed 0%, #2563eb 100%)",
              }}
            />
          </div>
          <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>{advancedCount} of 23 topics mastered</div>
        </div>
      )}

      {loading && (
        <div style={{ position: "absolute", inset: 0, zIndex: 22, background: "rgba(10,10,15,0.62)", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textSecondary, fontSize: 14 }}>
          Building knowledge graph...
        </div>
      )}

      {isMobile && selectedTopic && (
        <div onClick={() => setSelectedTopicId(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.58)", zIndex: 23 }} />
      )}

      <div
        style={isMobile ? {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          height: "82vh",
          background: "#0d0d14",
          borderTop: `1px solid ${COLORS.border}`,
          borderRadius: "16px 16px 0 0",
          transform: selectedTopic ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.24s ease",
          zIndex: 24,
          display: "flex",
          flexDirection: "column",
          pointerEvents: selectedTopic ? "auto" : "none",
        } : {
          position: "absolute",
          top: 0,
          right: 0,
          width: isTablet ? 300 : 320,
          height: "100%",
          background: "#0d0d14",
          borderLeft: `1px solid ${COLORS.border}`,
          transform: selectedTopic ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease",
          zIndex: 24,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {selectedTopic && (
          <>
            {isMobile && <div style={{ width: 32, height: 4, borderRadius: 2, background: COLORS.border, margin: "10px auto 2px" }} />}
            <div style={{ height: 4, width: "100%", background: UNIT_META[selectedTopic.unit].color }} />
            <div style={{ padding: isMobile ? "16px 16px" : 20, borderBottom: `1px solid ${COLORS.border}`, position: "relative" }}>
              <button
                onClick={() => setSelectedTopicId(null)}
                style={{
                  position: "absolute",
                  top: isMobile ? 10 : 16,
                  right: isMobile ? 10 : 16,
                  border: "none",
                  background: "transparent",
                  color: COLORS.textMuted,
                  cursor: "pointer",
                  width: isMobile ? 44 : "auto",
                  height: isMobile ? 44 : "auto",
                }}
              >
                <span className="material-symbols-outlined" style={materialIconStyle(18, "#8b8b9e")}>close</span>
              </button>
              <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1.3, paddingRight: 32 }}>{getTopicLabel(selectedTopic.id)}</div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "14px 16px 150px" : "16px 20px 120px" }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 }}>Mastery</div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="32" stroke={COLORS.border} strokeWidth="7" fill="none" />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      stroke={UNIT_META[selectedTopic.unit].color}
                      strokeWidth="7"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 32}
                      strokeDashoffset={(1 - selectedTopic.p_known) * 2 * Math.PI * 32}
                      transform="rotate(-90 40 40)"
                    />
                    <text x="40" y="44" textAnchor="middle" fill={COLORS.textPrimary} fontSize="14" fontWeight="700">
                      {Math.round(selectedTopic.p_known * 100)}%
                    </text>
                  </svg>
                  <div>
                    <div style={{ color: UNIT_META[selectedTopic.unit].color, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{getStateLabel(selectedTopic.state)}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>p_known: {selectedTopic.p_known.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              {selectedTopic.session_count > 0 && (
                <div style={{ marginBottom: 18, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surfaceRaised, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.primary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    <span className="material-symbols-outlined" style={materialIconStyle(16, "#8b8b9e")}>psychology</span>
                    Memory Palace
                  </div>
                  {selectedTopic.understanding_summary && (
                    <div style={{ color: COLORS.textSecondary, fontSize: 13, fontStyle: "italic", lineHeight: 1.6, marginBottom: 8 }}>{selectedTopic.understanding_summary}</div>
                  )}
                  <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>Sessions studied: {selectedTopic.session_count}</div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>Last studied: {relativeTime(selectedTopic.last_studied_at)}</div>
                  {selectedTopic.misconceptions_count > 0 && (
                    <div style={{ color: COLORS.success, fontSize: 12 }}>Corrected {selectedTopic.misconceptions_count} misconceptions</div>
                  )}
                </div>
              )}

              <div style={{ marginBottom: 18 }}>
                <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 }}>Prerequisites</div>
                {selectedTopic.prerequisites.length === 0 ? (
                  <div style={{ color: COLORS.textMuted, fontSize: 12 }}>None</div>
                ) : (
                  selectedTopic.prerequisites.map((pid) => {
                    const pTopic = topics[pid];
                    const p = pTopic?.p_known ?? 0;
                    const color = p > 0.7 ? COLORS.success : p >= 0.4 ? COLORS.warning : COLORS.border;
                    const symbol = p > 0.7 ? "check_circle" : "circle";
                    return (
                      <button
                        key={pid}
                        onClick={() => {
                          setSelectedTopicId(pid);
                          setHoveredTopicId(pid);
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          background: "transparent",
                          border: "none",
                          padding: "6px 0",
                          color: COLORS.textSecondary,
                          textAlign: "left",
                          cursor: "pointer",
                          minHeight: isMobile ? 44 : "auto",
                        }}
                      >
                        <span className="material-symbols-outlined" style={materialIconStyle(14, color)}>{symbol}</span>
                        <span style={{ fontSize: 12 }}>{pTopic ? getTopicLabel(pTopic.id) : getTopicLabel(pid)}</span>
                      </button>
                    );
                  })
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 }}>Subtopics</div>
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {selectedTopic.subtopics.map((item) => (
                    <li key={item} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: isMobile ? "12px 14px calc(12px + env(safe-area-inset-bottom))" : 14, borderTop: `1px solid ${COLORS.border}`, background: "#0d0d14" }}>
              {!canStartLearning ? (
                <button
                  disabled
                  style={{
                    width: "100%",
                    border: "none",
                    borderRadius: 8,
                    background: COLORS.border,
                    color: COLORS.textMuted,
                    padding: isMobile ? "12px" : "11px 12px",
                    minHeight: isMobile ? 44 : "auto",
                    cursor: "not-allowed",
                    fontWeight: 600,
                  }}
                >
                  Complete prerequisites first
                </button>
              ) : (
                <>
                  <button
                    onClick={() => router.push(`/business-analytics?prompt=${encodeURIComponent(`Let me learn about ${selectedTopic.name}`)}`)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderRadius: 8,
                      background: COLORS.primary,
                      color: "#fff",
                      padding: isMobile ? "12px" : "11px 12px",
                      minHeight: isMobile ? 44 : "auto",
                      cursor: "pointer",
                      fontWeight: 600,
                      marginBottom: showTestMyself ? 8 : 0,
                    }}
                  >
                    {selectedTopic.state === "intermediate" || selectedTopic.state === "advanced" ? "Continue Learning →" : "Start Learning →"}
                  </button>

                  {showTestMyself && (
                    <button
                      onClick={() => router.push(`/business-analytics?mcq=${encodeURIComponent(selectedTopic.name)}`)}
                      style={{
                        width: "100%",
                        border: `1px solid ${COLORS.primary}`,
                        borderRadius: 8,
                        background: "transparent",
                        color: COLORS.primary,
                        padding: isMobile ? "12px" : "11px 12px",
                        minHeight: isMobile ? 44 : "auto",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Test Myself →
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
