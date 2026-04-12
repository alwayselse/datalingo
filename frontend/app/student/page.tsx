"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { useAuthStore } from "@/store/auth";
import { chatApi } from "@/lib/api";
import type { Session, Message as ApiMessage, Source } from "@/types";
import Sidebar from "@/components/sidebar";

// ─── Local types ──────────────────────────────────────────────────────────────

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  followUpSuggestion?: string;
  createdAt: Date;
}

interface MCQOption { label: string; text: string; }

interface MCQQuestion {
  question: string;
  options: MCQOption[];
  correct: string;
  explanation: string;
  level?: string;         // easy / medium / hard (tiered only)
  topicId: string;
}

// /mcq session state
interface MCQSession {
  topicId: string;
  topicName: string;
  level: string;
  questions: MCQQuestion[];
  currentIndex: number;
  answers: Record<number, string>;   // index → selected option label
  submitted: boolean;
  results: Record<number, boolean>;  // index → correct?
}

// Auto-trigger tiered state (3 questions, one at a time)
interface TieredMCQ {
  topicId: string;
  prereqId: string;
  questions: MCQQuestion[];
  currentIndex: number;
  answers: Record<number, string>;
  submitted: boolean;
  pendingMessage: string;
}

// ─── /mcq Session Card ────────────────────────────────────────────────────────

function MCQSessionCard({
  session, onAnswerSelect, onSubmit, onEnd
}: {
  session: MCQSession;
  onAnswerSelect: (qIdx: number, label: string) => void;
  onSubmit: () => void;
  onEnd: () => void;
}) {
  const q = session.questions[session.currentIndex];
  const selectedForCurrent = session.answers[session.currentIndex];
  const answeredCount = Object.keys(session.answers).length;
  const allAnswered = answeredCount === session.questions.length;

  return (
    <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 12, animation: "mcqRise 0.25s cubic-bezier(0.16,1,0.3,1) forwards" }}>
      <div style={{ background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.3)", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(73,68,86,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: 6, background: "#513794", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12, color: "#cfbdff", fontVariationSettings: "'FILL' 1" }}>quiz</span>
            </div>
            <span style={{ fontSize: 10, fontFamily: "Manrope, sans-serif", fontWeight: 700, color: "#cbc3d9", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
              {session.topicName}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#6b6b7e", textTransform: "uppercase" as const, padding: "2px 6px", borderRadius: 4, background: "#1f1f1f", fontFamily: "Manrope, sans-serif" }}>
              {session.level}
            </span>
          </div>
          <button onClick={onEnd}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, fontFamily: "Manrope, sans-serif", fontWeight: 700, color: "#6b6b7e", padding: "4px 10px", borderRadius: 8 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#ececec"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#494456"; }}
          >End session</button>
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px 0" }}>
          {session.questions.map((_, i) => {
            const answered = session.answers[i] !== undefined;
            const isCurrent = i === session.currentIndex;
            const isCorrect = session.submitted ? session.results[i] : null;
            let bg = "#2a2a2a";
            if (session.submitted) bg = isCorrect ? "#22c55e" : "#ef4444";
            else if (answered) bg = "#6e28f5";
            else if (isCurrent) bg = "#3d1a8f";
            return (
              <div key={i} onClick={() => !session.submitted && onAnswerSelect(-1, String(i))}
                style={{ width: isCurrent ? 20 : 8, height: 8, borderRadius: 4, background: bg, transition: "all 0.2s", cursor: "pointer" }} />
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b6b7e", fontFamily: "Manrope, sans-serif" }}>
            {session.currentIndex + 1} / {session.questions.length}
          </span>
        </div>

        {/* Question */}
        <div style={{ padding: "14px 18px 8px" }}>
          <p style={{ margin: 0, fontSize: 14, fontFamily: "Manrope, sans-serif", color: "#ececec", lineHeight: 1.6 }}>{q.question}</p>
        </div>

        {/* Options */}
        <div style={{ padding: "8px 18px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {q.options.map(opt => {
            const isSelected = selectedForCurrent === opt.label;
            const isRight = opt.label === q.correct;
            let bg = "#131313", border = "rgba(73,68,86,0.2)", color = "#ececec";

            if (session.submitted) {
              if (isRight) { bg = "rgba(34,197,94,0.1)"; border = "#22c55e"; color = "#86efac"; }
              else if (isSelected && !isRight) { bg = "rgba(239,68,68,0.1)"; border = "#ef4444"; color = "#fca5a5"; }
              else { color = "rgba(226,226,226,0.3)"; }
            } else if (isSelected) {
              bg = "rgba(110,40,245,0.12)"; border = "#6e28f5"; color = "#e0d3ff";
            }

            return (
              <button key={opt.label}
                onClick={() => !session.submitted && onAnswerSelect(session.currentIndex, opt.label)}
                disabled={session.submitted}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 12, border: `1px solid ${border}`, textAlign: "left" as const, cursor: session.submitted ? "default" : "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, transition: "all 0.2s", background: bg, color }}
                onMouseEnter={e => { if (!session.submitted && !isSelected) { e.currentTarget.style.borderColor = "rgba(73,68,86,0.45)"; e.currentTarget.style.background = "#1f1f1f"; } }}
                onMouseLeave={e => { if (!session.submitted && !isSelected) { e.currentTarget.style.borderColor = "rgba(73,68,86,0.2)"; e.currentTarget.style.background = "#131313"; } }}
              >
                <span style={{ width: 24, height: 24, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, background: isSelected ? border : "#2a2a2a", color: isSelected ? "white" : "#494456", transition: "all 0.2s" }}>
                  {opt.label}
                </span>
                <span style={{ flex: 1 }}>{opt.text}</span>
                {session.submitted && isRight && <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#22c55e", fontVariationSettings: "'FILL' 1" }}>check_circle</span>}
                {session.submitted && isSelected && !isRight && <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#ef4444", fontVariationSettings: "'FILL' 1" }}>cancel</span>}
              </button>
            );
          })}
        </div>

        {/* Nav + Submit */}
        <div style={{ padding: "10px 18px 14px", display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid rgba(73,68,86,0.1)" }}>
          <button
            onClick={() => onAnswerSelect(-1, String(session.currentIndex - 1))}
            disabled={session.currentIndex === 0}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", borderRadius: 10, border: "1px solid rgba(73,68,86,0.2)", background: "none", cursor: session.currentIndex === 0 ? "not-allowed" : "pointer", color: session.currentIndex === 0 ? "#333" : "#958da2", fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>arrow_back</span>
            Prev
          </button>
          <button
            onClick={() => onAnswerSelect(-1, String(session.currentIndex + 1))}
            disabled={session.currentIndex === session.questions.length - 1}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", borderRadius: 10, border: "1px solid rgba(73,68,86,0.2)", background: "none", cursor: session.currentIndex === session.questions.length - 1 ? "not-allowed" : "pointer", color: session.currentIndex === session.questions.length - 1 ? "#333" : "#958da2", fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600 }}
          >
            Next
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>arrow_forward</span>
          </button>

          <div style={{ flex: 1 }} />

          {!session.submitted ? (
            <button
              onClick={onSubmit}
              disabled={!allAnswered}
              style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: allAnswered ? "#6e28f5" : "#1f1f1f", color: allAnswered ? "white" : "#333", cursor: allAnswered ? "pointer" : "not-allowed", fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 700, transition: "all 0.2s" }}
            >
              {allAnswered ? "Submit All" : `Answer ${session.questions.length - answeredCount} more`}
            </button>
          ) : (
            <button onClick={onEnd}
              style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: "#1f1f1f", color: "#ececec", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 700 }}
            >Done</button>
          )}
        </div>

        {/* Bottom hints */}
        <div style={{ padding: "6px 18px 10px", display: "flex", gap: 16 }}>
          {["A/B/C/D to select", "· ← → to navigate"].map(h => (
            <span key={h} style={{ fontSize: 10, color: "#555", fontFamily: "Manrope, sans-serif" }}>{h}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Auto-trigger Tiered MCQ Card (one at a time, no nav) ─────────────────────

function TieredMCQCard({
  tiered, onAnswer, onSkip
}: {
  tiered: TieredMCQ;
  onAnswer: (label: string) => void;
  onSkip: () => void;
}) {
  const q = tiered.questions[tiered.currentIndex];
  const selected = tiered.answers[tiered.currentIndex];

  const levelColors: Record<string, string> = { easy: "#22c55e", medium: "#f59e0b", hard: "#ef4444" };
  const levelColor = levelColors[q.level || "medium"] || "#6e28f5";

  return (
    <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 12, animation: "mcqRise 0.25s cubic-bezier(0.16,1,0.3,1) forwards" }}>
      <div style={{ background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.3)", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(73,68,86,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: 6, background: "#513794", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12, color: "#cfbdff", fontVariationSettings: "'FILL' 1" }}>quiz</span>
            </div>
            <span style={{ fontSize: 10, fontFamily: "Manrope, sans-serif", fontWeight: 700, color: "#cbc3d9", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
              Quick check · {tiered.currentIndex + 1} of {tiered.questions.length}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: levelColor, textTransform: "uppercase" as const, padding: "2px 6px", borderRadius: 4, background: `${levelColor}15`, fontFamily: "Manrope, sans-serif", border: `1px solid ${levelColor}40` }}>
              {q.level}
            </span>
          </div>
          <button onClick={onSkip}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, fontFamily: "Manrope, sans-serif", fontWeight: 700, color: "#6b6b7e", padding: "4px 10px", borderRadius: 8 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#ececec"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#494456"; }}
          >Skip</button>
        </div>

        <div style={{ padding: "14px 18px 8px" }}>
          <p style={{ margin: 0, fontSize: 14, fontFamily: "Manrope, sans-serif", color: "#ececec", lineHeight: 1.6 }}>{q.question}</p>
        </div>

        <div style={{ padding: "8px 18px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {q.options.map(opt => {
            const isSelected = selected === opt.label;
            return (
              <button key={opt.label} onClick={() => !selected && onAnswer(opt.label)} disabled={!!selected}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 12, border: `1px solid ${isSelected ? "#6e28f5" : "rgba(73,68,86,0.2)"}`, textAlign: "left" as const, cursor: selected ? "default" : "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, transition: "all 0.15s", background: isSelected ? "rgba(110,40,245,0.12)" : "#131313", color: isSelected ? "#e0d3ff" : selected ? "rgba(226,226,226,0.35)" : "#ececec" }}
                onMouseEnter={e => { if (!selected) { e.currentTarget.style.borderColor = "rgba(73,68,86,0.45)"; e.currentTarget.style.background = "#1f1f1f"; } }}
                onMouseLeave={e => { if (!selected) { e.currentTarget.style.borderColor = "rgba(73,68,86,0.2)"; e.currentTarget.style.background = "#131313"; } }}
              >
                <span style={{ width: 24, height: 24, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, background: isSelected ? "#6e28f5" : "#2a2a2a", color: isSelected ? "white" : "#494456" }}>{opt.label}</span>
                {opt.text}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "6px 18px 10px", display: "flex", gap: 16 }}>
          {["A/B/C/D to select", "· Esc to skip"].map(h => (
            <span key={h} style={{ fontSize: 10, color: "#555", fontFamily: "Manrope, sans-serif" }}>{h}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Mermaid ──────────────────────────────────────────────────────────────────

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

// ─── Code Block ───────────────────────────────────────────────────────────────

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  if (language === "mermaid") return <MermaidChart chart={children} />;
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", background: "#111", border: "1px solid rgba(73,68,86,0.12)", margin: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", background: "#1a1a1a", borderBottom: "1px solid rgba(110,40,245,0.1)" }}>
        <span style={{ fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "#958da2", fontWeight: 700, fontFamily: "Manrope, sans-serif" }}>
          {language || "code"}
        </span>
        <button
          onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.08em", fontWeight: 700, color: "#958da2", fontFamily: "Manrope, sans-serif" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre style={{ margin: 0, padding: "20px", overflowX: "auto", fontSize: 13, lineHeight: 1.65, color: "#cfbdff", fontFamily: "'Fira Code', 'JetBrains Mono', monospace" }}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message, isStreaming }: { message: LocalMessage; isStreaming?: boolean }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  if (message.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 28 }}>
        <div style={{ maxWidth: "68%", background: "#2a2a2a", borderRadius: "18px 18px 4px 18px", padding: "12px 18px", color: "#ececec", fontFamily: "Manrope, sans-serif", fontSize: 14, lineHeight: 1.65 }}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 36 }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span className="material-symbols-outlined" style={{ color: "white", fontSize: 14, fontVariationSettings: "'FILL' 1" }}>school</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#cbc3d9", fontFamily: "Manrope, sans-serif", letterSpacing: "0.04em", textTransform: "uppercase" as const }}></span>
      </div>

      <div style={{ paddingLeft: 38 }}>
        {/* Markdown content */}
        <div style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 16, color: "#ececec", lineHeight: 1.85 }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={{
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                const lang = match?.[1]?.toLowerCase();
                const raw = String(children).replace(/\n$/, "").trim();
                const isBlock = String(children).includes("\n") || !!match;
                if (isBlock && lang === "mermaid") return <MermaidChart chart={raw} isStreaming={isStreaming} />;
                if (isBlock) return <CodeBlock language={lang}>{raw}</CodeBlock>;
                return <code style={{ background: "#1b1b1b", color: "#cfbdff", padding: "2px 6px", borderRadius: 5, fontSize: 13, fontFamily: "'Fira Code', monospace" }} {...props}>{children}</code>;
              },
              pre({ children }: any) { return <>{children}</>; },
              p({ children }: any) { return <p style={{ margin: "0 0 14px", color: "#ececec" }}>{children}</p>; },
              h1({ children }: any) { return <h1 style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700, fontSize: 20, margin: "24px 0 10px", color: "#ececec" }}>{children}</h1>; },
              h2({ children }: any) { return <h2 style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700, fontSize: 17, margin: "20px 0 8px", color: "#ececec" }}>{children}</h2>; },
              h3({ children }: any) { return <h3 style={{ fontFamily: "Manrope, sans-serif", fontWeight: 600, fontSize: 15, margin: "16px 0 6px", color: "#ececec" }}>{children}</h3>; },
              ul({ children }: any) { return <ul style={{ paddingLeft: 22, margin: "0 0 14px", color: "#ececec" }}>{children}</ul>; },
              ol({ children }: any) { return <ol style={{ paddingLeft: 22, margin: "0 0 14px", color: "#ececec" }}>{children}</ol>; },
              li({ children }: any) { return <li style={{ marginBottom: 4, color: "#ececec" }}>{children}</li>; },
              strong({ children }: any) { return <strong style={{ fontWeight: 600, color: "#ececec" }}>{children}</strong>; },
              blockquote({ children }: any) { return <blockquote style={{ borderLeft: "3px solid #6e28f5", paddingLeft: 14, margin: "0 0 14px", color: "#cbc3d9", fontStyle: "italic" }}>{children}</blockquote>; },
              table({ children }: any) { return <div style={{ overflowX: "auto", margin: "0 0 16px" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>{children}</table></div>; },
              th({ children }: any) { return <th style={{ background: "#1f1f1f", padding: "8px 12px", textAlign: "left" as const, borderBottom: "1px solid #494456", fontFamily: "Manrope", fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "#958da2", fontWeight: 700 }}>{children}</th>; },
              td({ children }: any) { return <td style={{ padding: "8px 12px", borderBottom: "1px solid rgba(73,68,86,0.25)", color: "#ececec" }}>{children}</td>; },
              a({ children, href }: any) { return <a href={href} style={{ color: "#cfbdff", textDecoration: "none" }} target="_blank" rel="noopener noreferrer">{children}</a>; },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => setSourcesOpen(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#6b6b7e", fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: 700, padding: 0, transition: "color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.color = "#958da2"}
              onMouseLeave={e => e.currentTarget.style.color = "#494456"}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>menu_book</span>
              {sourcesOpen ? "Hide" : "Show"} sources ({message.sources.length})
              <span className="material-symbols-outlined" style={{ fontSize: 12, transform: sourcesOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>expand_more</span>
            </button>
            {sourcesOpen && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {message.sources.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: "#252525", border: "1px solid rgba(110,40,245,0.12)", fontSize: 12, fontFamily: "Manrope, sans-serif" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: "#6b6b7e" }}>article</span>
                    <span style={{ color: "#ececec", fontWeight: 500, flex: 1 }}>{s.title}</span>
                    {s.page && <span style={{ color: "#6b6b7e" }}>p. {s.page}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Follow-up suggestion */}
        {message.followUpSuggestion && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(73,68,86,0.1)" }}>
            <p style={{ margin: 0, fontSize: 12, color: "#6b6b7e", fontFamily: "Manrope, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
              <span>💡</span> {message.followUpSuggestion}
            </p>
          </div>
        )}

        {/* Actions on hover */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 2, opacity: hovered ? 1 : 0, transition: "opacity 0.2s" }}>
          {[
            { icon: copied ? "check" : "content_copy", label: copied ? "Copied" : "Copy", action: () => { navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 2000); } },
            { icon: "thumb_up", label: "", action: () => {} },
            { icon: "thumb_down", label: "", action: () => {} },
          ].map((btn, i) => (
            <button key={i} onClick={btn.action}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8, background: "none", border: "none", cursor: "pointer", fontSize: 11, fontFamily: "Manrope, sans-serif", fontWeight: 600, color: "#6b6b7e", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#1f1f1f"; e.currentTarget.style.color = "#ececec"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#494456"; }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{btn.icon}</span>
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MCQ Card ─────────────────────────────────────────────────────────────────

// ─── Thinking dots ────────────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div style={{ marginBottom: 32, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span className="material-symbols-outlined" style={{ color: "white", fontSize: 14, fontVariationSettings: "'FILL' 1" }}>school</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 150, 300].map(d => (
            <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "#6b6b7e", display: "inline-block", animation: `bounce 1.2s ${d}ms infinite` }} />
          ))}
        </div>
        <span style={{ fontSize: 12, color: "#6b6b7e", fontFamily: "Manrope, sans-serif" }}>Drinking water 💧</span>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

const ALL_SUGGESTIONS = [
  { icon: "functions",     text: "Explain gradient descent with an analogy" },
  { icon: "account_tree", text: "How does a decision tree split nodes?" },
  { icon: "terminal",     text: "Write a pandas groupby example" },
  { icon: "schema",       text: "What is the bias-variance tradeoff?" },
  { icon: "psychology",   text: "What is overfitting and how do I prevent it?" },
  { icon: "scatter_plot", text: "Explain PCA in simple terms" },
  { icon: "data_object",  text: "How does backpropagation work?" },
  { icon: "hub",          text: "What is the difference between CNN and RNN?" },
  { icon: "analytics",    text: "How does k-means clustering work?" },
  { icon: "calculate",    text: "What is the chain rule in calculus?" },
  { icon: "memory",       text: "Explain LSTM networks intuitively" },
  { icon: "manage_search",text: "What is cross-validation and why use it?" },
  { icon: "linear_scale", text: "What is regularisation and when to use it?" },
  { icon: "developer_mode",text: "Show me how to use SQL window functions" },
  { icon: "model_training",text: "What is the difference between bagging and boosting?" },
  { icon: "query_stats",  text: "Explain the central limit theorem simply" },
];

function pickRandom4() {
  const shuffled = [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 4);
}

function EmptyState({ username, onSuggestion }: { username: string; onSuggestion: (t: string) => void }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = username;

  const [suggestions, setSuggestions] = useState(ALL_SUGGESTIONS.slice(0, 4));

  useEffect(() => {
    setSuggestions(pickRandom4());
  }, []);

  return (
    <div style={{ paddingTop: 80, paddingBottom: 60 }}>
      <h1 style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 38, color: "#ececec", margin: "0 0 10px", fontStyle: "italic", fontWeight: 400 }}>
        {greeting}, {firstName}.
      </h1>
      <p style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 20, color: "#6b6b7e", margin: "0 0 48px", fontStyle: "italic" }}>
        What would you like to learn today?
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 560 }}>
        {suggestions.map(s => (
          <button key={s.text} onClick={() => onSuggestion(s.text)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.12)", color: "#6b6b7e", fontFamily: "Manrope, sans-serif", fontSize: 13, cursor: "pointer", textAlign: "left" as const, transition: "all 0.15s", lineHeight: 1.4 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#1f1f1f"; e.currentTarget.style.borderColor = "rgba(73,68,86,0.3)"; e.currentTarget.style.color = "#ececec"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#1a1a1a"; e.currentTarget.style.borderColor = "rgba(73,68,86,0.12)"; e.currentTarget.style.color = "#494456"; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17, color: "#555", flexShrink: 0 }}>{s.icon}</span>
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Session Item ─────────────────────────────────────────────────────────────

function SessionItem({ session, active, onClick, onDelete }: { session: Session; active: boolean; onClick: () => void; onDelete: (id: string) => void }) {
  const date = new Date(session.updated_at ?? session.created_at);
  const isToday = new Date().toDateString() === date.toDateString();
  const label = isToday
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  return (
    <>
      <button onClick={onClick} onContextMenu={handleContextMenu}
        style={{ width: "100%", display: "flex", flexDirection: "column" as const, gap: 2, padding: "9px 12px", borderRadius: 10, border: "none", textAlign: "left" as const, cursor: "pointer", fontFamily: "Manrope, sans-serif", transition: "all 0.15s", background: active ? "#1f1f1f" : "transparent", color: active ? "#ececec" : "#555" }}
        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#161616"; e.currentTarget.style.color = "#aaa"; } }}
        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#555"; } }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{session.title}</span>
        <span style={{ fontSize: 10, color: "#555" }}>{label}</span>
      </button>

      {menu && (
        <div
          style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 9999, background: "#1a1a1a", border: "1px solid rgba(73,68,86,0.25)", borderRadius: 10, padding: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", minWidth: 160, animation: "mcqRise 0.15s ease forwards" }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => { setMenu(null); onDelete(session.id); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, color: "#ef4444", textAlign: "left" as const, transition: "background 0.1s" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>delete</span>
            Delete session
          </button>
          <button
            onClick={() => { setMenu(null); onClick(); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontSize: 13, color: "#cbc3d9", textAlign: "left" as const, transition: "background 0.1s" }}
            onMouseEnter={e => e.currentTarget.style.background = "#222"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>open_in_new</span>
            Open session
          </button>
        </div>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StudentPage() {
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [mcqSession, setMcqSession] = useState<MCQSession | null>(null);
  const [tieredMCQ, setTieredMCQ] = useState<TieredMCQ | null>(null);
  const [activeNav, setActiveNav] = useState<"chat" | "graph">("chat");
  const [mounted, setMounted] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(252);
  const [longChatWarning, setLongChatWarning] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);

  useEffect(() => {
    setMounted(true);
    // Restore active session from localStorage on mount
    const savedSession = localStorage.getItem("datalingo_active_session");
    if (savedSession) {
      sessionIdRef.current = savedSession;
      setActiveSessionId(savedSession);
    }
  }, []);

  // Rotate placeholder text
  const PLACEHOLDERS = [
    "Ask anything…",
    "Type / for commands",
    "Try /mcq machine learning",
    "What would you like to learn?",
  ];
  useEffect(() => {
    if (input) return; // don't rotate when typing
    const interval = setInterval(() => {
      setPlaceholderVisible(false);
      setTimeout(() => {
        setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length);
        setPlaceholderVisible(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, [input]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(null); // always in sync, no stale closure
  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Keep ref in sync with state — ref is used inside async callbacks to avoid stale closures
  useEffect(() => { sessionIdRef.current = activeSessionId; }, [activeSessionId]);

  // Auth guard
  useEffect(() => {
    if (!token || !user) router.replace("/login");
  }, [token, user]);

  // Load sessions
  useEffect(() => {
    if (!token) return;
    chatApi.getSessions()
      .then(res => {
        const rows = res.data;
        setSessions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
  }, [token]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + "px";
    }
  }, [input]);

  // Keyboard nav for tiered MCQ (auto-trigger)
  useEffect(() => {
    if (!tieredMCQ || tieredMCQ.submitted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const pending = tieredMCQ.pendingMessage;
        setTieredMCQ(null);
        if (pending) doSendMessage(pending);
      }
      const q = tieredMCQ.questions[tieredMCQ.currentIndex];
      const idx = ["A", "B", "C", "D"].indexOf(e.key.toUpperCase());
      if (idx !== -1 && q.options[idx] && !tieredMCQ.answers[tieredMCQ.currentIndex]) {
        handleTieredAnswer(q.options[idx].label);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tieredMCQ]);

  // Keyboard nav for /mcq session
  useEffect(() => {
    if (!mcqSession) return;
    const handler = (e: KeyboardEvent) => {
      const q = mcqSession.questions[mcqSession.currentIndex];
      // Answer selection only before submit
      if (!mcqSession.submitted) {
        const idx = ["A", "B", "C", "D"].indexOf(e.key.toUpperCase());
        if (idx !== -1 && q.options[idx]) {
          handleSessionAnswerSelect(mcqSession.currentIndex, q.options[idx].label);
        }
      }
      // Navigation always allowed
      if (e.key === "ArrowRight" && mcqSession.currentIndex < mcqSession.questions.length - 1) {
        handleSessionAnswerSelect(-1, String(mcqSession.currentIndex + 1));
      }
      if (e.key === "ArrowLeft" && mcqSession.currentIndex > 0) {
        handleSessionAnswerSelect(-1, String(mcqSession.currentIndex - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mcqSession]);

  const clearStaleSession = (staleSessionId: string) => {
    if (sessionIdRef.current === staleSessionId) {
      sessionIdRef.current = null;
      setActiveSessionId(null);
      setMessages([]);
      localStorage.removeItem("datalingo_active_session");
    }
    setSessions(prev => prev.filter(s => s.id !== staleSessionId));
  };

  const loadSession = async (sessionId: string) => {
    sessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    localStorage.setItem("datalingo_active_session", sessionId);
    if (!token) return;
    try {
      const res = await chatApi.getMessages(sessionId);
      const data = res.data;
      setMessages((data || []).map((m: ApiMessage) => ({
        id: m.id ?? crypto.randomUUID(),
        role: m.role as "user" | "assistant",
        content: m.content,
        sources: m.sources || [],
        createdAt: new Date(m.created_at ?? Date.now()),
      })));
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        clearStaleSession(sessionId);
        return;
      }
    }
  };

  // ── Tiered MCQ (auto-trigger) handlers ───────────────────────────────────

  const handleTieredAnswer = (label: string) => {
    if (!tieredMCQ) return;
    const updated = {
      ...tieredMCQ,
      answers: { ...tieredMCQ.answers, [tieredMCQ.currentIndex]: label },
    };
    // Move to next question or submit all when last answered
    if (tieredMCQ.currentIndex < tieredMCQ.questions.length - 1) {
      setTimeout(() => setTieredMCQ({ ...updated, currentIndex: tieredMCQ.currentIndex + 1 }), 500);
    } else {
      // All 3 answered — submit
      setTimeout(() => submitTieredAnswers(updated), 500);
    }
    setTieredMCQ(updated);
  };

  const submitTieredAnswers = async (state: TieredMCQ) => {
    const pending = state.pendingMessage;
    setTieredMCQ(null);
    if (!token) return;
    const answers = state.questions.map((q, i) => ({
      question_index: i,
      student_answer: state.answers[i] || "",
      correct_answer: q.correct,
      question: q.question,
      level: q.level || "medium",
    }));
    try {
      await chatApi.submitTieredAnswers({
        topic_id: state.topicId,
        answers,
        session_id: sessionIdRef.current,
        is_tiered: true,
      });
    } catch {}
    if (pending) await doSendMessage(pending);
  };

  // ── /mcq Session handlers ─────────────────────────────────────────────────

  const handleSessionAnswerSelect = (qIdx: number, value: string) => {
    if (!mcqSession) return;
    // Navigation is always allowed (even after submit for review)
    const navIdx = parseInt(value);
    if (qIdx === -1 && !isNaN(navIdx)) {
      setMcqSession({ ...mcqSession, currentIndex: Math.max(0, Math.min(navIdx, mcqSession.questions.length - 1)) });
      return;
    }
    // Answer selection only allowed before submit
    if (mcqSession.submitted) return;
    setMcqSession({ ...mcqSession, answers: { ...mcqSession.answers, [qIdx]: value } });
  };

  const handleSessionSubmit = async () => {
    if (!mcqSession || !token) return;
    const answers = mcqSession.questions.map((q, i) => ({
      question_index: i,
      student_answer: mcqSession.answers[i] || "",
      correct_answer: q.correct,
      question: q.question,
      level: mcqSession.level,
    }));
    try {
      const res = await chatApi.mcqBatchSubmit({
        topic_id: mcqSession.topicId,
        answers,
        session_id: sessionIdRef.current,
      });
      const data = res.data;
      const results: Record<number, boolean> = {};
      (data.results || []).forEach((r: any) => { results[r.question_index] = r.correct; });
      setMcqSession({ ...mcqSession, submitted: true, results });
    } catch {
      setMcqSession({ ...mcqSession, submitted: true, results: {} });
    }
  };

  const doSendMessage = async (text: string) => {
    const userMsg: LocalMessage = { id: crypto.randomUUID(), role: "user", content: text, createdAt: new Date() };
    const assistantId = crypto.randomUUID();
    const assistantPlaceholder: LocalMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date(),
    };

    setMessages(prev => [...prev, userMsg, assistantPlaceholder]);
    setIsStreaming(true);
    setIsThinking(true);

    try {
      const sessionToSend = sessionIdRef.current || localStorage.getItem("datalingo_active_session");
      // Keep fetch for SSE token streaming.
      const res = await fetch(`${API}/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, session_id: sessionToSend }),
      });
      if (!res.ok || !res.body) throw new Error();

      const newSessionId = res.headers.get("X-Session-ID");
      if (newSessionId && !sessionIdRef.current) {
        // First message of a new session — persist immediately via ref AND state
        sessionIdRef.current = newSessionId;
        setActiveSessionId(newSessionId);
        localStorage.setItem("datalingo_active_session", newSessionId);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullAccumulated = "";   // complete raw text from LLM
      let displayed = "";         // what's shown to user so far
      let wordQueue: string[] = [];
      let done = false;
      let dripping = false;

      // Strip inline citation markers like [1], [2,3], [[1]] etc.
      const stripCitations = (text: string) =>
        text.replace(/\[\[?\d+(?:,\s*\d+)*\]?\]/g, "");

      // Drip words out one at a time at ~40ms per word
      const drip = () => {
        if (wordQueue.length === 0) { dripping = false; return; }
        dripping = true;
        const word = wordQueue.shift()!;
        displayed += word;
        const clean = stripCitations(displayed);
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: clean } : m
        ));
        setTimeout(drip, 22);
      };

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(raw);
            // Session ID from stream (fallback if CORS strips header)
            if (parsed.session_id && !sessionIdRef.current) {
              sessionIdRef.current = parsed.session_id;
              setActiveSessionId(parsed.session_id);
              localStorage.setItem("datalingo_active_session", parsed.session_id);
            }
            if (parsed.long_chat_warning) {
              setLongChatWarning(true);
              setMessageCount(parsed.message_count || 20);
            }
            if (parsed.token) {
              fullAccumulated += parsed.token;
              // Split incoming token into words and push to queue
              // Keep spaces attached to preceding word for natural spacing
              const words = parsed.token.split(/(?<=\s)|(?=\s)/).filter(Boolean);
              wordQueue.push(...words);
              if (!dripping) {
                setIsThinking(false);
                drip();
              }
            }
            if (parsed.sources) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, sources: parsed.sources } : m
              ));
            }
            if (parsed.follow_up) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, followUpSuggestion: parsed.follow_up } : m
              ));
            }
          } catch { /* non-JSON line, skip */ }
        }
      }

      // Wait for drip queue to finish, then show final clean text
      const waitForDrip = () => new Promise<void>(resolve => {
        const check = () => wordQueue.length === 0 && !dripping ? resolve() : setTimeout(check, 50);
        check();
      });
      await waitForDrip();
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: stripCitations(fullAccumulated) } : m
      ));

      // Refresh sessions list
      chatApi.getSessions()
        .then(res => {
          const rows = res.data;
          setSessions(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {});
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: "Something went wrong. Please try again." } : m));
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
    }
  };

  const SLASH_COMMANDS = [
    { cmd: "/mcq", icon: "quiz",        label: "/mcq",        desc: "Generate MCQ questions on a topic",  example: "/mcq <topic> <level> <count>" },
  ];

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const text = input.trim();
    setInput("");

    // ── /mcq command ──────────────────────────────────────────────────────
    const mcqMatch = text.match(/^[/\\]mcq\s*(.*)/i);
    if (mcqMatch) {
      const args = mcqMatch[1].trim();
      const levelMatch = args.match(/\blevel\s+(easy|medium|hard)\b/i);
      const level = levelMatch ? levelMatch[1].toLowerCase() : "medium";
      const countMatch = args.match(/\b(\d+)\b/);
      const count = countMatch ? Math.min(Math.max(parseInt(countMatch[1]), 1), 30) : 3;
      const topic = args.replace(/\blevel\s+(easy|medium|hard)\b/i, "").replace(/\b\d+\b/, "").trim() || "machine_learning";

      try {
        const res = await chatApi.mcqBatchGenerate({
          topic,
          count,
          level,
          session_id: sessionIdRef.current,
        });
        const data = res.data;
        if (data.error || !data.questions?.length) {
          setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant" as const, content: `❌ Couldn't find topic: **${topic}**. Try \`/mcq machine learning\` or \`/mcq linear algebra level hard 5\``, createdAt: new Date() }]);
          return;
        }
        const questions: MCQQuestion[] = data.questions.map((q: any) => ({
          question: q.question,
          options: (["A", "B", "C", "D"] as const).filter(k => q.options?.[k]).map(k => ({ label: k, text: q.options[k] })),
          correct: q.correct,
          explanation: q.explanation || "",
          topicId: data.topic_id,
        }));
        setMcqSession({ topicId: data.topic_id, topicName: data.topic_name, level, questions, currentIndex: 0, answers: {}, submitted: false, results: {} });
      } catch {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant" as const, content: "Something went wrong starting the MCQ session.", createdAt: new Date() }]);
      }
      return;
    }

    // ── Normal message — check prereqs first ──────────────────────────────
    if (token) {
      try {
        const res = await chatApi.checkPrereqs(
          text,
          sessionIdRef.current || localStorage.getItem("datalingo_active_session")
        );
        const data = res.data;
        const needsMcq = data.mcq_required === true || data.status === "mcq_required";
        if (needsMcq && data.questions?.length) {
          // Auto-trigger tiered MCQ
          const questions: MCQQuestion[] = data.questions.map((q: any) => ({
            question: q.question,
            options: (["A", "B", "C", "D"] as const).filter(k => q.options?.[k]).map(k => ({ label: k, text: q.options[k] })),
            correct: q.correct,
            explanation: q.explanation || "",
            level: q.level || "medium",
            topicId: data.prereq_id,
          }));
          setTieredMCQ({ topicId: data.prereq_id, prereqId: data.prereq_id, questions, currentIndex: 0, answers: {}, submitted: false, pendingMessage: text });
          return;
        }
      } catch {}
    }
    await doSendMessage(text);
  }, [input, isStreaming, token]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashMenuIndex(i => (i + 1) % SLASH_COMMANDS.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlashMenuIndex(i => (i - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length); return; }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const cmd = SLASH_COMMANDS[slashMenuIndex];
        setInput(cmd.example + " ");
        setShowSlashMenu(false);
        setTimeout(() => textareaRef.current?.focus(), 10);
        return;
      }
      if (e.key === "Escape") { setShowSlashMenu(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const startNewChat = () => {
    if (sessionIdRef.current && token) {
      chatApi.endSession(sessionIdRef.current).catch(() => {});
    }
    sessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setLongChatWarning(false);
    setMessageCount(0);
    localStorage.removeItem("datalingo_active_session");
  };

  const deleteSession = async (sessionId: string) => {
    if (!token) return;
    try {
      await chatApi.deleteSession(sessionId);
    } catch {}
    // Remove from sidebar
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    // If deleted session was active, clear the chat
    if (sessionIdRef.current === sessionId) {
      sessionIdRef.current = null;
      setActiveSessionId(null);
      setMessages([]);
      localStorage.removeItem("datalingo_active_session");
    }
  };

  const handleLogout = () => {
    clearAuth();
    document.cookie = "auth_token=; path=/; max-age=0";
    document.cookie = "user_role=; path=/; max-age=0";
    router.replace("/login");
  };

  // Use real name from DB if available, else fall back to email prefix
  const displayName = mounted
    ? (user?.name?.split(" ")[0] || user?.username?.split("@")[0] || "Student")
    : "...";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        @import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #1a1a1a; }
        .material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; display: inline-block; line-height: 1; vertical-align: middle; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3a3a4a; border-radius: 10px; }
        @keyframes mcqRise { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-5px); } }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#1a1a1a", color: "#ececec" }}>

        {/* ── Sidebar ── */}
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onNewChat={startNewChat}
          onSessionClick={loadSession}
          onDeleteSession={deleteSession}
          onCollapse={c => setSidebarWidth(c ? 60 : 252)}
        />

        {/* ── Main ── */}
        <main style={{ marginLeft: sidebarWidth, flex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          {activeNav === "graph" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 52, color: "#1f1f1f" }}>hub</span>
              <p style={{ color: "#555", fontFamily: "Manrope", fontSize: 13, margin: 0, fontWeight: 600 }}>Knowledge Graph — coming soon</p>
              <p style={{ color: "#222", fontFamily: "Manrope", fontSize: 12, margin: 0 }}>D3 force graph of your topic mastery</p>
            </div>
          ) : (
            <>
              {/* Messages */}
              {/* Long chat banner */}
              {longChatWarning && (
                <div style={{ position: "sticky", top: 0, zIndex: 10, padding: "10px 28px 0" }}>
                  <div style={{ maxWidth: 860, margin: "0 auto" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(110,40,245,0.08)", border: "1px solid rgba(110,40,245,0.2)", borderRadius: 12, backdropFilter: "blur(8px)" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#cfbdff", flexShrink: 0 }}>info</span>
                      <p style={{ margin: 0, fontSize: 12, color: "#cbc3d9", fontFamily: "Manrope, sans-serif", flex: 1 }}>
                        This chat is getting long — responses may lose earlier context.{" "}
                        <button onClick={startNewChat} style={{ background: "none", border: "none", cursor: "pointer", color: "#cfbdff", fontWeight: 700, fontSize: 12, fontFamily: "Manrope, sans-serif", padding: 0, textDecoration: "underline" }}>
                          Start a fresh chat
                        </button>{" "}
                        to keep things sharp.
                      </p>
                      <button onClick={() => setLongChatWarning(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#494456", padding: 2, flexShrink: 0 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ flex: 1, overflowY: "auto", padding: "40px 28px 220px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
                {messages.length === 0
                  ? <EmptyState username={displayName} onSuggestion={t => { setInput(t); setTimeout(() => textareaRef.current?.focus(), 50); }} />
                  : <>
                      {messages.map((m, i) => <MessageBubble key={m.id} message={m} isStreaming={isStreaming && i === messages.length - 1} />)}
                      {isThinking && <ThinkingIndicator />}
                      <div ref={messagesEndRef} />
                    </>
                }
              </div>

              {/* Input area */}
              <div style={{ position: "fixed", bottom: 0, left: sidebarWidth, right: 0, padding: "0 28px 24px", transition: "left 0.25s cubic-bezier(0.16,1,0.3,1)", background: "linear-gradient(to top, #1a1a1a 55%, transparent)" }}>
                <div style={{ maxWidth: 784, margin: "0 auto", position: "relative" }}>

                  {mcqSession && (
                    <MCQSessionCard
                      session={mcqSession}
                      onAnswerSelect={handleSessionAnswerSelect}
                      onSubmit={handleSessionSubmit}
                      onEnd={() => setMcqSession(null)}
                    />
                  )}
                  {tieredMCQ && (
                    <TieredMCQCard
                      tiered={tieredMCQ}
                      onAnswer={handleTieredAnswer}
                      onSkip={() => {
                        const pending = tieredMCQ.pendingMessage;
                        setTieredMCQ(null);
                        if (pending) doSendMessage(pending);
                      }}
                    />
                  )}

                  {/* Slash command popup */}
                  {showSlashMenu && !mcqSession && !tieredMCQ && (
                    <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, animation: "mcqRise 0.2s cubic-bezier(0.16,1,0.3,1) forwards" }}>
                      <div style={{ background: "#1e1e24", border: "1px solid rgba(110,40,245,0.25)", borderRadius: 16, overflow: "hidden", boxShadow: "0 16px 48px rgba(0,0,0,0.5)", maxWidth: 420 }}>
                        <div style={{ padding: "10px 14px 6px", borderBottom: "1px solid rgba(73,68,86,0.1)" }}>
                          <span style={{ fontSize: 10, fontFamily: "Manrope, sans-serif", fontWeight: 700, color: "#6b6b7e", textTransform: "uppercase", letterSpacing: "0.1em" }}>Commands</span>
                        </div>
                        {SLASH_COMMANDS.map((cmd, i) => (
                          <button key={i}
                            onClick={() => { setInput(cmd.example + " "); setShowSlashMenu(false); setTimeout(() => textareaRef.current?.focus(), 10); }}
                            style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", border: "none", cursor: "pointer", fontFamily: "Manrope, sans-serif", textAlign: "left", background: slashMenuIndex === i ? "rgba(110,40,245,0.12)" : "transparent", transition: "background 0.1s", borderBottom: i < SLASH_COMMANDS.length - 1 ? "1px solid rgba(73,68,86,0.06)" : "none" }}
                            onMouseEnter={() => setSlashMenuIndex(i)}
                          >
                            <div style={{ width: 32, height: 32, borderRadius: 9, background: slashMenuIndex === i ? "rgba(110,40,245,0.2)" : "#252530", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.15s" }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: slashMenuIndex === i ? "#cfbdff" : "#6b6b7e" }}>{cmd.icon}</span>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: slashMenuIndex === i ? "#cfbdff" : "#ececec" }}>{cmd.label}</span>
                              </div>
                              <span style={{ fontSize: 11, color: "#6b6b7e" }}>{cmd.desc}</span>
                            </div>
                            <span style={{ fontSize: 10, color: "#333", fontFamily: "Manrope, sans-serif", background: "#1a1a1a", padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>Tab to select</span>
                          </button>
                        ))}
                        <div style={{ padding: "6px 14px 8px", display: "flex", gap: 14 }}>
                          {["↑↓ navigate", "Tab/Enter select", "Esc dismiss"].map(h => (
                            <span key={h} style={{ fontSize: 9, color: "#333", fontFamily: "Manrope, sans-serif" }}>{h}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div
                    style={{ display: "flex", alignItems: "flex-end", gap: 8, background: "#222", border: "1px solid rgba(110,40,245,0.15)", borderRadius: 18, padding: "10px 10px 10px 18px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", transition: "border-color 0.2s", position: "relative" }}
                    onFocus={e => e.currentTarget.style.borderColor = "rgba(110,40,245,0.5)"}
                    onBlur={e => e.currentTarget.style.borderColor = "rgba(110,40,245,0.15)"}
                  >
                    {/* Animated placeholder */}
                    {!input && (
                      <span style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontFamily: "Manrope, sans-serif", color: "#444", pointerEvents: "none", transition: "opacity 0.3s ease", opacity: placeholderVisible ? 1 : 0, whiteSpace: "nowrap", overflow: "hidden", maxWidth: "80%" }}>
                        {PLACEHOLDERS[placeholderIdx]}
                      </span>
                    )}
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={e => {
                        const val = e.target.value;
                        setInput(val);
                        if (val === "/" || val.startsWith("/") && !val.includes(" ")) {
                          setShowSlashMenu(true);
                          setSlashMenuIndex(0);
                        } else {
                          setShowSlashMenu(false);
                        }
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder={input ? "" : ""}
                      rows={1}
                      disabled={isStreaming}
                      style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#ececec", fontFamily: "Manrope, sans-serif", fontSize: 14, resize: "none", lineHeight: 1.6, padding: "5px 0", maxHeight: 180, overflowY: "auto" }}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!input.trim() || isStreaming}
                      style={{ width: 38, height: 38, borderRadius: 11, border: "none", background: input.trim() && !isStreaming ? "#6e28f5" : "#1f1f1f", color: input.trim() && !isStreaming ? "white" : "#333", cursor: input.trim() && !isStreaming ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", flexShrink: 0 }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{isStreaming ? "stop" : "arrow_upward"}</span>
                    </button>
                  </div>

                  <p style={{ textAlign: "center", fontSize: 10, color: "#1f1f1f", fontFamily: "Manrope", marginTop: 8, letterSpacing: "0.02em" }}>
                    Shift+Enter for new line · Enter to send
                  </p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}