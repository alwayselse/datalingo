"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatApi } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import Sidebar from "@/components/sidebar";
import type { Message as ApiMessage, Session, Source } from "@/types";

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  sources?: Source[];
  docOnly?: boolean;
}

interface UploadedFileMeta {
  filename: string;
  doc_id?: string;
  chunk_count: number;
  uploaded_at: string;
  summary?: string;
  key_terms?: string[];
}

interface SlashCommand {
  cmd: string;
  label: string;
  insertText: string;
  desc: string;
  icon: string;
}

const BASE_SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/mcq", label: "/mcq [topic]", insertText: "/mcq", desc: "Generate MCQ questions on a topic", icon: "quiz" },
  { cmd: "/graph", label: "/graph", insertText: "/graph", desc: "Open your knowledge graph", icon: "hub" },
];

function getDocHintName(filename: string) {
  return filename
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[_\-\s]/)[0]
    .trim();
}

function fmtWhen(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({ message }: { message: LocalMessage }) {
  if (message.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
        <div style={{ maxWidth: "72%", background: "#2a2a2a", borderRadius: "16px 16px 4px 16px", padding: "10px 14px" }}>
          {message.docOnly && (
            <div style={{ display: "inline-block", fontSize: 11, color: "#6e28f5", border: "1px solid rgba(110,40,245,0.35)", background: "rgba(110,40,245,0.08)", borderRadius: 999, padding: "2px 8px", marginBottom: 7, fontFamily: "Manrope, sans-serif", fontWeight: 700 }}>
              📄 Document Query
            </div>
          )}
          <div style={{ color: "#ececec", fontSize: 14, fontFamily: "Manrope, sans-serif", lineHeight: 1.6 }}>{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 24, height: 24, borderRadius: 8, background: "linear-gradient(135deg, #6e28f5, #3d1a8f)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: "white", fontVariationSettings: "'FILL' 1" }}>school</span>
        </div>
        <span style={{ fontSize: 11, color: "#6b6b7e", fontFamily: "Manrope, sans-serif", fontWeight: 700, textTransform: "uppercase" }}>Datalingo</span>
      </div>
      <div style={{ paddingLeft: 32, color: "#ececec", fontFamily: "Manrope, sans-serif", fontSize: 14, lineHeight: 1.7 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        {message.sources && message.sources.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {message.sources.map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: "#958da2", background: "#1f1f1f", border: "1px solid rgba(73,68,86,0.2)", borderRadius: 10, padding: "6px 10px" }}>
                {s.title} {s.page ? `(p.${s.page})` : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BusinessAnalyticsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user } = useAuthStore();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(252);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileMeta[]>([]);
  const [uploadStatus, setUploadStatus] = useState<{ text: string; color: string } | null>(null);
  const [showUploadsPopover, setShowUploadsPopover] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handledMcqParamRef = useRef<string | null>(null);
  const handledPromptParamRef = useRef<string | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const clearStaleSession = useCallback((staleSessionId: string) => {
    if (sessionIdRef.current === staleSessionId) {
      sessionIdRef.current = null;
      setActiveSessionId(null);
      setMessages([]);
      setUploadedFiles([]);
      localStorage.removeItem("datalingo_active_session");
    }
    setSessions((prev) => prev.filter((s) => s.id !== staleSessionId));
  }, []);

  const activeSessionUploadCount = uploadedFiles.length;
  const multiUploadTooltip = useMemo(
    () => uploadedFiles.map((f) => `${f.filename} (${f.chunk_count})`).join("\n"),
    [uploadedFiles]
  );

  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (uploadedFiles.length === 0) {
      return [
        {
          cmd: "/doc",
          label: "/doc [question]",
          insertText: "/doc",
          desc: "Search your uploaded document",
          icon: "description",
        },
        ...BASE_SLASH_COMMANDS,
      ];
    }

    if (uploadedFiles.length === 1) {
      const single = uploadedFiles[0];
      return [
        {
          cmd: "/doc",
          label: "/doc [question]",
          insertText: "/doc",
          desc: `Search ${single.filename}`,
          icon: "description",
        },
        ...BASE_SLASH_COMMANDS,
      ];
    }

    const docSpecific = uploadedFiles.map((f) => {
      const hint = getDocHintName(f.filename) || "doc";
      return {
        cmd: "/doc",
        label: `/doc ${hint} [question]`,
        insertText: `/doc ${hint}`,
        desc: `Search ${f.filename}`,
        icon: "description",
      } as SlashCommand;
    });

    return [
      ...docSpecific,
      {
        cmd: "/doc",
        label: "/doc [question]",
        insertText: "/doc",
        desc: "Search most recent document",
        icon: "description",
      },
      ...BASE_SLASH_COMMANDS,
    ];
  }, [uploadedFiles]);

  const fetchSessions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await chatApi.getSessions();
      const rows: Session[] = Array.isArray(res.data) ? res.data : [];
      setSessions(rows);

      if (sessionIdRef.current) {
        const current = rows.find((s) => s.id === sessionIdRef.current);
        const files = current?.session_memory?.uploaded_files || [];
        setUploadedFiles(files);
      }
    } catch {
      // no-op
    }
  }, [token]);

  const fetchSessionUploads = useCallback(async (sessionId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/ba/documents/session/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 404) {
          clearStaleSession(sessionId);
        }
        return;
      }
      const data = await res.json();
      const files = Array.isArray(data.uploaded_files) ? data.uploaded_files : [];
      setUploadedFiles(files);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                session_memory: {
                  ...(s.session_memory || {}),
                  uploaded_collection: data.uploaded_collection,
                  uploaded_files: files,
                },
              }
            : s
        )
      );
    } catch {
      // no-op
    }
  }, [token, API, clearStaleSession]);

  const loadSession = useCallback(async (sessionId: string) => {
    if (!token) return;

    sessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    localStorage.setItem("datalingo_active_session", sessionId);

    try {
      const res = await chatApi.getMessages(sessionId);
      const rows: ApiMessage[] = Array.isArray(res.data) ? res.data : [];
      setMessages(
        rows.map((m) => ({
          id: m.id || crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          content: String(m.content || "").replace(/^\[DOC_ONLY\]\s*/i, ""),
          docOnly: /^\[DOC_ONLY\]\s*/i.test(String(m.content || "")),
          sources: m.sources || [],
          createdAt: new Date(m.created_at || Date.now()),
        }))
      );
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        clearStaleSession(sessionId);
        return;
      }
      setMessages([]);
    }

    await fetchSessionUploads(sessionId);
  }, [token, fetchSessionUploads, clearStaleSession]);

  useEffect(() => {
    if (!token || !user) {
      router.replace("/login");
      return;
    }
    fetchSessions();

    const saved = localStorage.getItem("datalingo_active_session");
    if (saved) {
      loadSession(saved);
    }
  }, [token, user, fetchSessions, loadSession, router]);

  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const doSendMessage = useCallback(async (
    actualText: string,
    options?: { displayText?: string; docOnly?: boolean }
  ) => {
    if (!token) return;

    const assistantId = crypto.randomUUID();
    const displayText = options?.displayText || actualText;

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: displayText,
        createdAt: new Date(),
        docOnly: !!options?.docOnly,
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date(),
      },
    ]);

    setIsStreaming(true);

    try {
      const res = await fetch(`${API}/chat/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: actualText,
          session_id: sessionIdRef.current,
        }),
      });

      if (!res.ok || !res.body) throw new Error("chat stream failed");

      const maybeSession = res.headers.get("X-Session-ID");
      if (maybeSession && !sessionIdRef.current) {
        sessionIdRef.current = maybeSession;
        setActiveSessionId(maybeSession);
        localStorage.setItem("datalingo_active_session", maybeSession);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

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
              setActiveSessionId(parsed.session_id);
              localStorage.setItem("datalingo_active_session", parsed.session_id);
            }

            if (parsed.token) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + parsed.token } : m
                )
              );
            }

            if (parsed.sources) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, sources: parsed.sources } : m
                )
              );
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      await fetchSessions();
      if (sessionIdRef.current) {
        await fetchSessionUploads(sessionIdRef.current);
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "Something went wrong. Please try again." } : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }, [token, API, fetchSessions, fetchSessionUploads]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const text = input.trim();
    setInput("");
    setShowSlashMenu(false);

    if (text.toLowerCase() === "/doc") {
      return;
    }

    if (text.toLowerCase().startsWith("/doc ")) {
      const rest = text.slice(5).trim();
      if (!rest) return;

      const words = rest.split(/\s+/);
      const knownDocs = uploadedFiles.map((f) =>
        f.filename.toLowerCase().replace(/\.[^.]+$/, "")
      );
      const firstWord = (words[0] || "").toLowerCase();
      const isDocTarget = knownDocs.some((d) => d.includes(firstWord) || firstWord.includes(d.split("_")[0] || ""));

      if (isDocTarget && words.length > 1) {
        const query = words.slice(1).join(" ");
        await doSendMessage(`[DOC_ONLY:${firstWord}] ${query}`, { displayText: query, docOnly: true });
      } else {
        await doSendMessage(`[DOC_ONLY] ${rest}`, { displayText: rest, docOnly: true });
      }
      return;
    }

    if (text.toLowerCase().startsWith("/graph")) {
      router.push("/business-analytics/graph");
      return;
    }

    if (text.toLowerCase().startsWith("/mcq")) {
      await doSendMessage(text);
      return;
    }

    await doSendMessage(text);
  }, [input, isStreaming, router, doSendMessage, uploadedFiles]);

  useEffect(() => {
    if (!token) return;

    const mcqParam = searchParams.get("mcq");
    const promptParam = searchParams.get("prompt");
    let shouldClearUrl = false;

    if (promptParam && handledPromptParamRef.current !== promptParam) {
      handledPromptParamRef.current = promptParam;
      setInput(promptParam);
      setTimeout(() => textareaRef.current?.focus(), 0);
      shouldClearUrl = true;
    }

    if (mcqParam && handledMcqParamRef.current !== mcqParam && !isStreaming) {
      handledMcqParamRef.current = mcqParam;
      void doSendMessage(`/mcq ${mcqParam}`);
      shouldClearUrl = true;
    }

    if (shouldClearUrl) {
      router.replace("/business-analytics", { scroll: false });
    }
  }, [token, searchParams, isStreaming, doSendMessage, router]);

  const handleUpload = async () => {
    if (!token || !uploadedFile) return;

    const sessionId = sessionIdRef.current || crypto.randomUUID();

    setUploadStatus({ text: "Indexing document...", color: "#6b7280" });

    const formData = new FormData();
    formData.append("file", uploadedFile);

    try {
      const res = await fetch(
        `${API}/ba/documents/upload?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Upload failed");
      }

      const data = await res.json();
      const resolvedSessionId = data.session_id || sessionId;
      sessionIdRef.current = resolvedSessionId;
      setActiveSessionId(resolvedSessionId);
      localStorage.setItem("datalingo_active_session", resolvedSessionId);

      const optimistic: UploadedFileMeta = {
        filename: data.filename,
        chunk_count: data.chunk_count,
        uploaded_at: new Date().toISOString(),
      };

      setUploadedFiles((prev) => [...prev, optimistic]);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === resolvedSessionId
            ? {
                ...s,
                session_memory: {
                  ...(s.session_memory || {}),
                  uploaded_collection: data.collection_id,
                  uploaded_files: [...(s.session_memory?.uploaded_files || []), optimistic],
                },
              }
            : s
        )
      );

      await fetchSessions();
      await fetchSessionUploads(resolvedSessionId);

      setUploadStatus({
        text: `📄 ${data.filename} — ${data.chunk_count} chunks indexed, ready`,
        color: "#059669",
      });
      setUploadedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed — try again";
      setUploadStatus({ text: message, color: "#dc2626" });
      // Keep uploadedFile for retry.
    }
  };

  const startNewChat = () => {
    sessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setUploadedFiles([]);
    localStorage.removeItem("datalingo_active_session");
  };

  const deleteSession = async (sessionId: string) => {
    if (!token) return;
    try {
      await chatApi.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        startNewChat();
      }
    } catch {
      // no-op
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % Math.max(1, slashCommands.length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + Math.max(1, slashCommands.length)) % Math.max(1, slashCommands.length));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const command = slashCommands[slashIndex];
        if (command) {
          setInput(`${command.insertText} `);
        }
        setShowSlashMenu(false);
        return;
      }
      if (e.key === "Escape") {
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const displayName = hydrated ? (user?.name?.split(" ")[0] || user?.username || "Student") : "...";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #1a1a1a; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh", background: "#1a1a1a", color: "#ececec" }}>
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onNewChat={startNewChat}
          onSessionClick={loadSession}
          onDeleteSession={deleteSession}
          onCollapse={(collapsed) => setSidebarWidth(collapsed ? 60 : 252)}
          chatPath="/business-analytics"
          graphPath="/business-analytics/graph"
        />

        <main style={{ marginLeft: sidebarWidth, flex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <div style={{ maxWidth: 860, width: "100%", margin: "0 auto", padding: "24px 28px 0" }}>
            <h1 style={{ margin: 0, fontFamily: "Newsreader, Georgia, serif", fontSize: 32, fontStyle: "italic", fontWeight: 400 }}>Business Analytics Tutor</h1>
            <p style={{ margin: "6px 0 0", color: "#6b6b7e", fontFamily: "Manrope, sans-serif", fontSize: 12 }}>
              Welcome back, {displayName}. Ask course questions or query uploaded notes with /doc.
            </p>

            {activeSessionUploadCount > 0 && (
              <div style={{ marginTop: 12, position: "relative", display: "inline-block" }}>
                <button
                  onClick={() => setShowUploadsPopover((v) => !v)}
                  title={activeSessionUploadCount > 1 ? multiUploadTooltip : undefined}
                  style={{ background: "rgba(110,40,245,0.12)", border: "1px solid rgba(110,40,245,0.3)", borderRadius: 20, padding: "4px 12px", fontFamily: "Manrope, sans-serif", fontSize: 12, color: "#a78bfa", cursor: "pointer" }}
                >
                  {activeSessionUploadCount === 1
                    ? `📄 ${uploadedFiles[0].filename} — ${uploadedFiles[0].chunk_count} chunks indexed`
                    : `📄 ${activeSessionUploadCount} documents active`}
                </button>

                {showUploadsPopover && (
                  <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 20, width: 340, maxHeight: 260, overflowY: "auto", background: "#1f1f1f", border: "1px solid rgba(73,68,86,0.3)", borderRadius: 12, padding: 10, boxShadow: "0 10px 28px rgba(0,0,0,0.45)" }}>
                    {uploadedFiles.map((f, i) => (
                      <div key={`${f.filename}-${i}`} style={{ borderBottom: i < uploadedFiles.length - 1 ? "1px solid rgba(73,68,86,0.15)" : "none", padding: "8px 6px" }}>
                        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 13, color: "#ececec", fontWeight: 600 }}>{f.filename}</div>
                        <div style={{ fontFamily: "Manrope, sans-serif", fontSize: 11, color: "#6b6b7e" }}>
                          {f.chunk_count} chunks • uploaded {fmtWhen(f.uploaded_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 220px", maxWidth: 860, width: "100%", margin: "0 auto" }}>
            {messages.length === 0 ? (
              <div style={{ marginTop: 80, color: "#6b6b7e", fontFamily: "Manrope, sans-serif", fontSize: 14 }}>
                Start chatting. Use /doc &lt;question&gt; to query only your uploaded notes.
              </div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ position: "fixed", left: sidebarWidth, right: 0, bottom: 0, transition: "left 0.25s", padding: "0 28px 24px", background: "linear-gradient(to top, #1a1a1a 55%, transparent)" }}>
            <div style={{ maxWidth: 860, margin: "0 auto" }}>
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ border: "1px solid rgba(73,68,86,0.25)", background: "#1f1f1f", color: "#cbc3d9", borderRadius: 10, padding: "7px 10px", fontSize: 12, cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
                >
                  📎 Choose file
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!uploadedFile}
                  style={{ border: "1px solid rgba(73,68,86,0.25)", background: uploadedFile ? "#6e28f5" : "#252525", color: uploadedFile ? "#fff" : "#666", borderRadius: 10, padding: "7px 10px", fontSize: 12, cursor: uploadedFile ? "pointer" : "not-allowed", fontFamily: "Manrope, sans-serif" }}
                >
                  Upload
                </button>
                <span style={{ color: "#6b6b7e", fontSize: 12, fontFamily: "Manrope, sans-serif" }}>
                  {uploadedFile ? uploadedFile.name : "No file selected"}
                </span>
              </div>

              {uploadStatus && (
                <div style={{ marginBottom: 10, color: uploadStatus.color, fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600 }}>
                  {uploadStatus.text}
                </div>
              )}

              {showSlashMenu && (
                <div style={{ marginBottom: 10, background: "#1f1f1f", border: "1px solid rgba(73,68,86,0.25)", borderRadius: 12, overflow: "hidden", width: 420 }}>
                  {slashCommands.map((cmd, i) => (
                    <button
                      key={`${cmd.cmd}-${cmd.label}-${i}`}
                      onMouseEnter={() => setSlashIndex(i)}
                      onClick={() => {
                        setInput(`${cmd.insertText} `);
                        setShowSlashMenu(false);
                        setTimeout(() => textareaRef.current?.focus(), 10);
                      }}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, border: "none", textAlign: "left", cursor: "pointer", padding: "10px 12px", background: slashIndex === i ? "rgba(110,40,245,0.12)" : "transparent", color: "#ececec", fontFamily: "Manrope, sans-serif" }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#a78bfa" }}>{cmd.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{cmd.label}</div>
                        <div style={{ fontSize: 11, color: "#6b6b7e" }}>{cmd.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, background: "#222", border: "1px solid rgba(110,40,245,0.2)", borderRadius: 16, padding: "10px 10px 10px 14px" }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInput(val);
                    if (val.startsWith("/") && !val.includes(" ")) {
                      setShowSlashMenu(true);
                      setSlashIndex(0);
                    } else {
                      setShowSlashMenu(false);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything… (type / for commands)"
                  rows={1}
                  disabled={isStreaming}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#ececec", fontFamily: "Manrope, sans-serif", fontSize: 14, resize: "none", lineHeight: 1.6, minHeight: 28, maxHeight: 180 }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isStreaming}
                  style={{ width: 38, height: 38, border: "none", borderRadius: 11, background: input.trim() && !isStreaming ? "#6e28f5" : "#2a2a2a", color: input.trim() && !isStreaming ? "white" : "#555", cursor: input.trim() && !isStreaming ? "pointer" : "not-allowed" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_upward</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

export default function BusinessAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <BusinessAnalyticsContent />
    </Suspense>
  );
}
