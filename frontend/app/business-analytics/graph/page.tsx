"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { useAuthStore } from "@/store/auth";
import Sidebar from "@/components/sidebar";

// ── Types ────────────────────────────────────────────────────────────────────

interface TopicNode {
  id: string;
  name: string;
  description: string;
  subtopics: string[];
  prerequisites: string[];
  unit: 1 | 2 | 3 | 4;
  p_known: number;
  assessment_count: number;
  level: "unassessed" | "beginner" | "intermediate" | "advanced";
}

interface BATopic {
  id: number;
  name: string;
  unit: 1 | 2 | 3 | 4;
  x: number;
  y: number;
  z: number;
}

interface NodeMesh extends THREE.Mesh {
  userData: {
    id: string;
    baseColor: THREE.Color;
    glowColor: THREE.Color;
    baseEmissiveIntensity: number;
    velocity: THREE.Vector3;
    targetPos: THREE.Vector3;
  };
}

// ── Static topic data (prerequisites graph) ──────────────────────────────────

const BA_TOPICS: BATopic[] = [
  { id: 1,  name: "BA Frameworks & Decision-Making",      unit: 1, x: -6, y: 3, z: 0 },
  { id: 2,  name: "Customer Data & Analytics Lifecycle",  unit: 1, x: -2, y: 3, z: 0 },
  { id: 3,  name: "Data Extraction & Analytics",          unit: 1, x: 2, y: 3, z: 0 },
  { id: 4,  name: "Data Visualization & Dashboards",      unit: 1, x: 6, y: 3, z: 0 },
  { id: 5,  name: "RFM Analysis",                         unit: 2, x: -4, y: 1, z: 0 },
  { id: 6,  name: "Customer Segmentation & CLV",          unit: 2, x: -6, y: -1, z: 0 },
  { id: 7,  name: "Causality in Business Analytics",      unit: 2, x: -1, y: 1, z: 0 },
  { id: 8,  name: "Experimental Design & RCTs",           unit: 2, x: 1, y: -1, z: 0 },
  { id: 9,  name: "A/B Testing & Hypothesis Testing",     unit: 2, x: 3, y: 1, z: 0 },
  { id: 10, name: "Pricing Analytics & Revenue Mgmt",     unit: 2, x: 0, y: -3, z: 0 },
  { id: 11, name: "Price Elasticity & Demand Sensitivity", unit: 2, x: -2, y: -5, z: 0 },
  { id: 12, name: "Promotion & Offer Optimization",       unit: 2, x: 2, y: -5, z: 0 },
  { id: 13, name: "Time Series Data & Business Apps",     unit: 3, x: 6, y: 1, z: 0 },
  { id: 14, name: "Trend, Seasonality & Cycles",          unit: 3, x: 8, y: -1, z: 0 },
  { id: 15, name: "Forecasting Methods (MA, ES, ARIMA)",  unit: 3, x: 8, y: -3, z: 0 },
  { id: 16, name: "Customer Retention & Churn Analytics", unit: 3, x: -4, y: -7, z: 0 },
  { id: 17, name: "Inventory Control & Demand Planning",  unit: 3, x: 6, y: -5, z: 0 },
  { id: 18, name: "Supply Chain Analytics & KPIs",        unit: 3, x: 6, y: -7, z: 0 },
  { id: 19, name: "Text & Sentiment Analysis",            unit: 4, x: -6, y: -9, z: 0 },
  { id: 20, name: "Advanced Experimentation & MVT",       unit: 4, x: -2, y: -9, z: 0 },
  { id: 21, name: "Ethics, Bias & Responsible Analytics", unit: 4, x: 2, y: -9, z: 0 },
  { id: 22, name: "Data Privacy & Governance",            unit: 4, x: 6, y: -9, z: 0 },
  { id: 23, name: "Capstone Project",                     unit: 4, x: 0, y: -11, z: 0 },
];

const BA_EDGES: [number, number][] = [
  [2, 5], [3, 5], [5, 6], [1, 7], [7, 8], [8, 9], [9, 10], [6, 10],
  [10, 11], [11, 12], [9, 12],
  [3, 13], [13, 14], [14, 15], [6, 16], [9, 16], [15, 17], [17, 18], [4, 18],
  [3, 19], [9, 20], [1, 21], [21, 22],
  [6, 23], [12, 23], [15, 23], [16, 23], [18, 23], [19, 23], [20, 23], [22, 23],
];

  const BA_TOPIC_DETAILS: Record<number, { description: string; subtopics: string[] }> = {
    1:  { description: "Frameworks for structuring analytics problems and driving decisions with data.",
      subtopics: ["CRISP-DM", "Decision trees", "KPI design", "Problem framing"] },
    2:  { description: "How customer data is collected, stored, and used across the analytics lifecycle.",
      subtopics: ["Data sources", "ETL basics", "Customer journey", "Data quality"] },
    3:  { description: "Techniques for querying, cleaning, and preparing data for analysis.",
      subtopics: ["SQL queries", "Data wrangling", "Missing values", "Aggregations"] },
    4:  { description: "Principles of visual communication and building effective dashboards.",
      subtopics: ["Chart selection", "Tableau/Power BI", "Storytelling", "KPI dashboards"] },
    5:  { description: "Scoring customers on Recency, Frequency, and Monetary value to prioritize outreach.",
      subtopics: ["RFM scoring", "Quintile segmentation", "Score weighting", "Campaign targeting"] },
    6:  { description: "Grouping customers by behavior and calculating long-term revenue value.",
      subtopics: ["K-means clustering", "CLV formula", "Cohort analysis", "Persona mapping"] },
    7:  { description: "Understanding cause-effect relationships vs correlation in business data.",
      subtopics: ["Confounding variables", "Causal graphs", "Observational studies", "Counterfactuals"] },
    8:  { description: "Designing controlled experiments to test business hypotheses reliably.",
      subtopics: ["Control vs treatment", "Sample size", "Randomization", "Experiment validity"] },
    9:  { description: "Statistical testing to determine if observed differences are significant.",
      subtopics: ["Null hypothesis", "p-value", "Z-test", "Type I/II errors", "Power analysis"] },
    10: { description: "Setting prices strategically to maximize revenue across customer segments.",
      subtopics: ["Price optimization", "Revenue curves", "Willingness to pay", "Yield management"] },
    11: { description: "Measuring how sensitive demand is to price changes.",
      subtopics: ["PED formula", "Elastic vs inelastic", "Cross-price elasticity", "Demand curves"] },
    12: { description: "Designing offers and discounts that maximize conversion without eroding margins.",
      subtopics: ["Discount optimization", "Bundle pricing", "Promo ROI", "Uplift modeling"] },
    13: { description: "Understanding data indexed by time and its unique analytical properties.",
      subtopics: ["Time index", "Stationarity", "Autocorrelation", "Business cycles"] },
    14: { description: "Decomposing time series into trend, seasonal, and residual components.",
      subtopics: ["STL decomposition", "Additive vs multiplicative", "Seasonal indices", "Cycle detection"] },
    15: { description: "Applying moving average, exponential smoothing, and ARIMA to forecast business metrics.",
      subtopics: ["MA(n)", "Holt-Winters", "ARIMA(p,d,q)", "Forecast error metrics"] },
    16: { description: "Predicting which customers will leave and designing retention interventions.",
      subtopics: ["Churn rate", "Survival analysis", "Logistic regression", "Retention campaigns"] },
    17: { description: "Optimizing stock levels to balance holding costs and stockout risk.",
      subtopics: ["EOQ model", "Safety stock", "Reorder point", "ABC analysis"] },
    18: { description: "Measuring and optimizing the flow of goods from supplier to customer.",
      subtopics: ["Supply chain KPIs", "Lead time", "Bullwhip effect", "Vendor analytics"] },
    19: { description: "Extracting sentiment and topics from customer reviews, social media, and support tickets.",
      subtopics: ["Sentiment scoring", "TF-IDF", "Topic modeling", "NPS text analysis"] },
    20: { description: "Running multiple simultaneous experiments across variables and interactions.",
      subtopics: ["Factorial design", "Interaction effects", "ANOVA", "Multi-armed bandit"] },
    21: { description: "Recognizing and mitigating bias in data collection, models, and decision-making.",
      subtopics: ["Selection bias", "Algorithmic fairness", "Proxy variables", "Audit frameworks"] },
    22: { description: "Legal and ethical frameworks governing how customer data is collected and used.",
      subtopics: ["GDPR basics", "Data minimization", "Consent management", "Anonymization"] },
    23: { description: "End-to-end business analytics project integrating all course concepts.",
      subtopics: ["Problem scoping", "Data pipeline", "Model + insights", "Stakeholder presentation"] },
  };

const TOPIC_GRAPH: Record<string, { name: string; prerequisites: string[]; subtopics: string[]; description: string; unit: 1 | 2 | 3 | 4 }> =
  BA_TOPICS.reduce((acc, topic) => {
    const prerequisites = BA_EDGES
      .filter(([from, to]) => to === topic.id)
      .map(([from]) => String(from));

    acc[String(topic.id)] = {
      name: topic.name,
      prerequisites,
      subtopics: BA_TOPIC_DETAILS[topic.id]?.subtopics ?? [],
      description: BA_TOPIC_DETAILS[topic.id]?.description ?? "",
      unit: topic.unit,
    };

    return acc;
  }, {} as Record<string, { name: string; prerequisites: string[]; subtopics: string[]; description: string; unit: 1 | 2 | 3 | 4 }>);

// ── Color helpers ─────────────────────────────────────────────────────────────

function getUnitColor(unit: number): { base: string; glow: string } {
  if (unit === 1) return { base: "#6e28f5", glow: "#6e28f5" };
  if (unit === 2) return { base: "#2563eb", glow: "#2563eb" };
  if (unit === 3) return { base: "#059669", glow: "#059669" };
  return { base: "#dc2626", glow: "#dc2626" };
}

// ── Knowledge Graph Page ──────────────────────────────────────────────────────

export default function KnowledgeGraphPage() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animFrameRef = useRef<number>(0);
  const nodesRef = useRef<NodeMesh[]>([]);
  const particlesRef = useRef<THREE.Points[]>([]);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const autoRotateRef = useRef(true);
  const cameraAngleRef = useRef({ theta: 0, phi: Math.PI / 3 });
  const cameraRadiusRef = useRef(38);

  const [topics, setTopics] = useState<Record<string, TopicNode>>({});
  const [selectedTopic, setSelectedTopic] = useState<TopicNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(252);

  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => { setMounted(true); }, []);

  // Auth guard
  useEffect(() => {
    if (mounted && (!token || !user)) router.replace("/login");
  }, [mounted, token, user]);

  // Fetch mastery data
  useEffect(() => {
    if (!token || !user) return;
    fetch(`${API}/analytics/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) {
          const detail = await r.text();
          throw new Error(detail || `Failed to load mastery data (${r.status})`);
        }
        return r.json();
      })
      .then(data => {
        setLoadError(null);
        const masteryMap: Record<string, { p_known: number; assessment_count: number }> = {};
        (data.mastery_by_topic || []).forEach((m: any) => {
          masteryMap[m.topic_id] = { p_known: m.p_known, assessment_count: m.assessment_count };
        });

        const built: Record<string, TopicNode> = {};
        Object.entries(TOPIC_GRAPH).forEach(([id, info]) => {
          const mastery = masteryMap[id];
          const p = mastery?.p_known ?? -1;
          const level = p < 0 ? "unassessed" : p < 0.4 ? "beginner" : p < 0.7 ? "intermediate" : "advanced";
          built[id] = {
            id, ...info,
            p_known: p < 0 ? 0 : p,
            assessment_count: mastery?.assessment_count ?? 0,
            level,
          };
        });
        setTopics(built);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[KnowledgeGraph] mastery fetch error:", err);
        setLoadError("Could not load your mastery data. Showing graph without scores.");
        // Fallback: build with no mastery
        const built: Record<string, TopicNode> = {};
        Object.entries(TOPIC_GRAPH).forEach(([id, info]) => {
          built[id] = { id, ...info, p_known: 0, assessment_count: 0, level: "unassessed" };
        });
        setTopics(built);
        setLoading(false);
      });
  }, [token, user]);

  // Build Three.js scene
  useEffect(() => {
    if (!mountRef.current || loading || Object.keys(topics).length === 0) return;

    const W = mountRef.current.clientWidth;
    const H = mountRef.current.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 500);
    camera.position.set(0, 12, 38);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Ambient + point lights
    scene.add(new THREE.AmbientLight(0x1a0a3e, 2));
    const pLight = new THREE.PointLight(0x6e28f5, 3, 60);
    pLight.position.set(0, 20, 0);
    scene.add(pLight);
    const pLight2 = new THREE.PointLight(0x3b82f6, 2, 40);
    pLight2.position.set(-15, -10, 10);
    scene.add(pLight2);

    // Starfield background
    const starGeo = new THREE.BufferGeometry();
    const starVerts = [];
    for (let i = 0; i < 2000; i++) {
      starVerts.push((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300);
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Points(starGeo, starMat));

    // Layout nodes in 3D space using force-like positions
    const topicIds = Object.keys(topics);
    const positions: Record<string, THREE.Vector3> = {};

    // Layered layout — dependency depth determines Y level
    const depth: Record<string, number> = {};
    const getDepth = (id: string): number => {
      if (depth[id] !== undefined) return depth[id];
      const prereqs = TOPIC_GRAPH[id]?.prerequisites || [];
      if (prereqs.length === 0) { depth[id] = 0; return 0; }
      depth[id] = Math.max(...prereqs.map(p => getDepth(p))) + 1;
      return depth[id];
    };
    topicIds.forEach(id => getDepth(id));

    const maxDepth = Math.max(...Object.values(depth));
    const byDepth: Record<number, string[]> = {};
    topicIds.forEach(id => {
      const d = depth[id];
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(id);
    });

    // Position nodes in spiral layers
    topicIds.forEach(id => {
      const d = depth[id];
      const siblings = byDepth[d];
      const idx = siblings.indexOf(id);
      const angle = (idx / siblings.length) * Math.PI * 2 + d * 0.4;
      const radius = 6 + d * 4.5 + Math.random() * 2;
      const y = (d - maxDepth / 2) * 5 + (Math.random() - 0.5) * 3;
      positions[id] = new THREE.Vector3(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      );
    });

    // Create node meshes
    const nodes: NodeMesh[] = [];
    topicIds.forEach(id => {
      const topic = topics[id];
      const colors = getUnitColor(topic.unit);
      const baseColor = new THREE.Color(colors.base);
      const glowColor = new THREE.Color(colors.glow);

      let nodeScale = 1.0;
      let emissiveIntensity = 0.4;
      let opacity = 0.5;

      if (topic.level === "beginner") {
        opacity = 0.75;
        nodeScale = 1.0;
        emissiveIntensity = 0.5;
      }
      if (topic.level === "intermediate") {
        opacity = 0.88;
        nodeScale = 1.15;
        emissiveIntensity = 0.7;
      }
      if (topic.level === "advanced") {
        opacity = 1.0;
        nodeScale = 1.3;
        emissiveIntensity = 1.0;
      }

      const geo = new THREE.SphereGeometry(0.7, 32, 32);
      const mat = new THREE.MeshPhongMaterial({
        color: baseColor,
        emissive: glowColor,
        emissiveIntensity,
        shininess: 100,
        transparent: true,
        opacity,
      });
      const mesh = new THREE.Mesh(geo, mat) as unknown as NodeMesh;
      mesh.position.copy(positions[id]);
      mesh.scale.setScalar(nodeScale);
      mesh.userData = {
        id,
        baseColor,
        glowColor,
        baseEmissiveIntensity: emissiveIntensity,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.01,
          (Math.random() - 0.5) * 0.005,
          (Math.random() - 0.5) * 0.01
        ),
        targetPos: positions[id].clone(),
      };
      scene.add(mesh);
      nodes.push(mesh);

      // Glow halo
      const haloGeo = new THREE.SphereGeometry(1.1, 16, 16);
      const haloMat = new THREE.MeshBasicMaterial({
        color: glowColor, transparent: true, opacity: 0.08, side: THREE.BackSide,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      mesh.add(halo);

      if (topic.level === "unassessed") {
        const ringGeo = new THREE.RingGeometry(1.0, 1.1, 32);
        const ringEdges = new THREE.EdgesGeometry(ringGeo);
        const ringMat = new THREE.LineDashedMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.15,
          dashSize: 0.08,
          gapSize: 0.05,
        });
        const ring = new THREE.LineSegments(ringEdges, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.computeLineDistances();
        mesh.add(ring);
      }

      // Label sprite
      const canvas = document.createElement("canvas");
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillRect(0, 0, 256, 64);
      ctx.font = "bold 22px Manrope, sans-serif";
      ctx.fillStyle = colors.glow;
      ctx.textAlign = "center";
      ctx.fillText(topic.name, 128, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9 });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.y = 1.4;
      sprite.scale.set(4, 1, 1);
      mesh.add(sprite);
    });
    nodesRef.current = nodes;

    // Draw edges with particle flow
    const edgeParticles: THREE.Points[] = [];
    topicIds.forEach(id => {
      TOPIC_GRAPH[id].prerequisites.forEach(prereqId => {
        if (!positions[prereqId] || !positions[id]) return;

        const from = positions[prereqId];
        const to = positions[id];

        // Static edge line
        const edgeGeo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x6e28f5, transparent: true, opacity: 0.15,
        });
        scene.add(new THREE.Line(edgeGeo, edgeMat));

        // Particle flow along edge
        const particleCount = 12;
        const pGeo = new THREE.BufferGeometry();
        const pPositions = new Float32Array(particleCount * 3);
        const pProgress = new Float32Array(particleCount);
        for (let i = 0; i < particleCount; i++) {
          pProgress[i] = i / particleCount;
          const t = pProgress[i];
          pPositions[i * 3]     = from.x + (to.x - from.x) * t;
          pPositions[i * 3 + 1] = from.y + (to.y - from.y) * t;
          pPositions[i * 3 + 2] = from.z + (to.z - from.z) * t;
        }
        pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
        pGeo.userData = { from, to, progress: pProgress, particleCount };

        const pMat = new THREE.PointsMaterial({
          color: 0x9b5de5, size: 0.18, transparent: true, opacity: 0.7,
        });
        const particles = new THREE.Points(pGeo, pMat);
        scene.add(particles);
        edgeParticles.push(particles);
      });
    });
    particlesRef.current = edgeParticles;

    // Raycaster for clicks
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onMouseClick = (e: MouseEvent) => {
      if (!mountRef.current || isDraggingRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(nodes);
      if (hits.length > 0) {
        const mesh = hits[0].object as NodeMesh;
        const id = mesh.userData.id;
        setSelectedTopic(topics[id] || null);
        setPanelOpen(true);
        autoRotateRef.current = false;
      } else {
        setPanelOpen(false);
      }
    };

    // Mouse drag for orbit
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = false;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      if (e.buttons === 1 && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        isDraggingRef.current = true;
        autoRotateRef.current = false;
        cameraAngleRef.current.theta -= dx * 0.005;
        cameraAngleRef.current.phi = Math.max(0.3, Math.min(Math.PI - 0.3, cameraAngleRef.current.phi + dy * 0.005));
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      }
    };
    const onWheel = (e: WheelEvent) => {
      cameraRadiusRef.current = Math.max(15, Math.min(70, cameraRadiusRef.current + e.deltaY * 0.05));
    };

    renderer.domElement.addEventListener("click", onMouseClick);
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("wheel", onWheel);

    // Animation loop
    const clock = new THREE.Timer();
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      clock.update();
      const t = clock.getElapsed();

      // Auto-rotate
      if (autoRotateRef.current) {
        cameraAngleRef.current.theta += 0.002;
      }

      // Update camera
      const { theta, phi } = cameraAngleRef.current;
      const r = cameraRadiusRef.current;
      camera.position.set(
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, 0, 0);

      // Animate nodes — subtle float
      nodes.forEach((node, i) => {
        node.position.y = node.userData.targetPos.y + Math.sin(t * 0.5 + i * 0.7) * 0.15;
        node.rotation.y += 0.004;
        // Pulse emissive
        const mat = node.material as THREE.MeshPhongMaterial;
        mat.emissiveIntensity = node.userData.baseEmissiveIntensity + Math.sin(t * 1.2 + i) * 0.12;
      });

      // Animate particles along edges
      edgeParticles.forEach(pts => {
        const { from, to, progress, particleCount } = pts.geometry.userData;
        const positions = pts.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          progress[i] = (progress[i] + 0.004) % 1;
          const p = progress[i];
          positions[i * 3]     = from.x + (to.x - from.x) * p;
          positions[i * 3 + 1] = from.y + (to.y - from.y) * p;
          positions[i * 3 + 2] = from.z + (to.z - from.z) * p;
        }
        pts.geometry.attributes.position.needsUpdate = true;
        // Fade particles at endpoints
        const mat = pts.material as THREE.PointsMaterial;
        mat.opacity = 0.5 + Math.sin(t * 2) * 0.2;
      });

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
      if (!mountRef.current) return;
      const W = mountRef.current.clientWidth;
      const H = mountRef.current.clientHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      renderer.domElement.removeEventListener("click", onMouseClick);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mountRef.current) mountRef.current.removeChild(renderer.domElement);
    };
  }, [topics, loading]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayName = mounted ? (user?.username?.split("@")[0] ?? "Student") : "...";

  const masteryLabel = (level: string) => {
    if (level === "unassessed") return { text: "Not assessed", color: "#494456" };
    if (level === "beginner")    return { text: "Beginner",     color: "#7c3aed" };
    if (level === "intermediate") return { text: "Intermediate", color: "#3b82f6" };
    return { text: "Advanced", color: "#10b981" };
  };

  const prereqsMet = selectedTopic
    ? selectedTopic.prerequisites.every(prereqId => {
        const prereq = topics[prereqId];
        return prereq && prereq.assessment_count > 0;
      })
    : true;

  const unmetPrereqIds = selectedTopic
    ? selectedTopic.prerequisites.filter(id => topics[id]?.assessment_count === 0)
    : [];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0f; overflow: hidden; }
        .material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; display: inline-block; line-height: 1; vertical-align: middle; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 10px; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
      `}</style>

      <div style={{ width: "100vw", height: "100vh", background: "radial-gradient(ellipse at center, #0f0818 0%, #050508 70%)", position: "relative", overflow: "hidden", fontFamily: "Manrope, sans-serif" }}>

        {/* ── Sidebar ── */}
        <Sidebar
          onCollapse={(c: boolean) => setSidebarWidth(c ? 60 : 252)}
          chatPath="/business-analytics"
          graphPath="/business-analytics/graph"
        />

        {/* ── Top bar (legend only) ── */}
        <div style={{ position: "absolute", top: 0, left: sidebarWidth, right: 0, zIndex: 20, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(to bottom, rgba(5,5,8,0.9), transparent)", transition: "left 0.25s cubic-bezier(0.16,1,0.3,1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="material-symbols-outlined" style={{ color: "white", fontSize: 14, fontVariationSettings: "'FILL' 1" }}>hub</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#e2e2e2", letterSpacing: "-0.03em" }}>BA Knowledge Graph</span>
          </div>
          {/* Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {[
              { label: "Unit 1", color: "#6e28f5" },
              { label: "Unit 2", color: "#2563eb" },
              { label: "Unit 3", color: "#059669" },
              { label: "Unit 4", color: "#dc2626" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: l.color, boxShadow: `0 0 6px ${l.color}` }} />
                <span style={{ fontSize: 11, color: "#494456", fontWeight: 600 }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {loadError && !loading && (
          <div style={{ position: "absolute", top: 66, left: sidebarWidth + 24, zIndex: 21, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
            {loadError}
          </div>
        )}

        {/* ── Hint ── */}
        {!loading && (
          <div style={{ position: "absolute", bottom: 24, left: `calc(${sidebarWidth}px + 50%)`, transform: "translateX(-50%)", zIndex: 20, display: "flex", alignItems: "center", gap: 16, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 20, padding: "8px 20px", animation: "fadeIn 1s ease 2s both" }}>
            {[
              { icon: "drag_pan", text: "Drag to orbit" },
              { icon: "scroll", text: "Scroll to zoom" },
              { icon: "ads_click", text: "Click node for details" },
            ].map(h => (
              <div key={h.text} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14, color: "#494456" }}>{h.icon}</span>
                <span style={{ fontSize: 11, color: "#333", fontWeight: 600 }}>{h.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, zIndex: 30 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", border: "2px solid rgba(110,40,245,0.2)", borderTopColor: "#6e28f5", animation: "spin 0.8s linear infinite" }} />
            <p style={{ color: "#494456", fontSize: 13, fontWeight: 600 }}>Loading knowledge graph…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Three.js Canvas Mount ── */}
        <div ref={mountRef} style={{ position: "absolute", left: sidebarWidth, top: 0, right: 0, bottom: 0, cursor: "grab", transition: "left 0.25s cubic-bezier(0.16,1,0.3,1)" }} />

        {/* ── Side Panel ── */}
        {panelOpen && selectedTopic && (
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: 320,
            background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)",
            borderLeft: "1px solid rgba(110,40,245,0.15)",
            zIndex: 30, animation: "slideIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Panel header */}
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e2e2e2", letterSpacing: "-0.02em", margin: "0 0 6px" }}>
                    {selectedTopic.name}
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {(() => { const m = masteryLabel(selectedTopic.level); return (
                      <span style={{ fontSize: 10, fontWeight: 700, color: m.color, textTransform: "uppercase", letterSpacing: "0.1em", padding: "3px 8px", borderRadius: 6, background: `${m.color}18`, border: `1px solid ${m.color}40` }}>
                        {m.text}
                      </span>
                    ); })()}
                  </div>
                </div>
                <button onClick={() => setPanelOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#494456", padding: 4 }}
                  onMouseEnter={e => e.currentTarget.style.color = "#e2e2e2"}
                  onMouseLeave={e => e.currentTarget.style.color = "#494456"}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
                </button>
              </div>
              <p style={{ fontSize: 12, color: "#494456", lineHeight: 1.6, margin: 0 }}>{selectedTopic.description}</p>
            </div>

            {/* Panel body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Mastery score */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#333", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Mastery</p>
                <div style={{ background: "#0f0f18", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.04)" }}>
                  {selectedTopic.level === "unassessed" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => {
                          const topicNameEncoded = encodeURIComponent(selectedTopic.name);
                          router.push(`/business-analytics?mcq=${topicNameEncoded}`);
                        }}
                        style={{
                          padding: "10px 14px", borderRadius: 10, border: "none",
                          background: "linear-gradient(135deg, #6e28f5, #3d1a8f)",
                          color: "white", fontFamily: "inherit", fontSize: 13,
                          fontWeight: 700, cursor: "pointer", textAlign: "left",
                          display: "flex", alignItems: "center", gap: 8
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>quiz</span>
                        Start assessment now
                      </button>

                      <button
                        onClick={() => {
                          const msg = `Teach me about ${selectedTopic.name}`;
                          router.push(`/business-analytics?prompt=${encodeURIComponent(msg)}`);
                        }}
                        style={{
                          padding: "10px 14px", borderRadius: 10,
                          border: "1px solid rgba(110,40,245,0.3)",
                          background: "transparent", color: "#a78bfa",
                          fontFamily: "inherit", fontSize: 13,
                          fontWeight: 600, cursor: "pointer", textAlign: "left",
                          display: "flex", alignItems: "center", gap: 8
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>school</span>
                        Learn this topic first
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: masteryLabel(selectedTopic.level).color, fontFamily: "Newsreader, serif", fontStyle: "italic" }}>
                          {Math.round(selectedTopic.p_known * 100)}%
                        </span>
                        <span style={{ fontSize: 11, color: "#333", fontWeight: 600 }}>{selectedTopic.assessment_count} assessments</span>
                      </div>
                      <div style={{ height: 4, background: "#1a1a2a", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${selectedTopic.p_known * 100}%`, background: `linear-gradient(90deg, ${masteryLabel(selectedTopic.level).color}88, ${masteryLabel(selectedTopic.level).color})`, borderRadius: 2, transition: "width 0.8s ease" }} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Subtopics */}
              {selectedTopic.subtopics.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#333", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Subtopics</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedTopic.subtopics.map(s => (
                      <span key={s} style={{ fontSize: 11, fontWeight: 600, color: "#6e28f5", background: "rgba(110,40,245,0.08)", border: "1px solid rgba(110,40,245,0.2)", borderRadius: 6, padding: "4px 10px" }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Prerequisites */}
              {selectedTopic.prerequisites.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#333", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Prerequisites</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selectedTopic.prerequisites.map(prereqId => {
                      const prereq = topics[prereqId];
                      if (!prereq) return null;
                      const m = masteryLabel(prereq.level);
                      return (
                        <button key={prereqId}
                          onClick={() => { setSelectedTopic(prereq); }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0f0f18", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 10, cursor: "pointer", textAlign: "left", transition: "all 0.15s", fontFamily: "inherit" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(110,40,245,0.3)"}
                          onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)"}
                        >
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: m.color, flexShrink: 0, boxShadow: `0 0 4px ${m.color}` }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#cbc3d9", flex: 1 }}>{prereq.name}</span>
                          <span style={{ fontSize: 10, color: m.color, fontWeight: 700 }}>{m.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick MCQ button */}
              <div style={{ marginTop: "auto" }}>
                {!prereqsMet && selectedTopic.prerequisites.length > 0 ? (
                  <div style={{
                    padding: "10px 14px", borderRadius: 10,
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.2)",
                    marginTop: "auto"
                  }}>
                    <p style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600, margin: "0 0 6px" }}>
                      ⚠ Complete prerequisites first
                    </p>
                    <p style={{ fontSize: 11, color: "#888", margin: 0, lineHeight: 1.5 }}>
                      Assess these topics before testing here:
                    </p>
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      {unmetPrereqIds.map(id => (
                        <span key={id} style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>
                          • {topics[id]?.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const topicNameEncoded = encodeURIComponent(selectedTopic.name);
                      router.push(`/business-analytics?mcq=${topicNameEncoded}`);
                    }}
                    style={{ width: "100%", padding: "11px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", color: "white", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "opacity 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>quiz</span>
                    Test my knowledge
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}