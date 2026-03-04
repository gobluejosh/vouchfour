import { useState, useEffect, useRef } from "react";
import { capture, identify } from "../lib/posthog.js";
import { gradientForName, initialsForName } from "../lib/avatar.js";

const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentLight: "#EFF6FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chipBorder: "#BFDBFE",
  chip: "#F0F4FF",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const DEGREE_LABELS = { 1: "1st", 2: "2nd", 3: "3rd" };
const DEGREE_COLORS = {
  1: { bg: "#EEF2FF", border: "#A5B4FC", badge: "linear-gradient(135deg, #6366F1, #4F46E5)" },
  2: { bg: "#ECFDF5", border: "#86EFAC", badge: "linear-gradient(135deg, #34D399, #16A34A)" },
  3: { bg: "#F5F3FF", border: "#C4B5FD", badge: "linear-gradient(135deg, #A78BFA, #7C3AED)" },
};
const DEGREE_AVATAR_GRADIENTS = {
  1: "linear-gradient(135deg, #6366F1, #4F46E5)",
  2: "linear-gradient(135deg, #34D399, #16A34A)",
  3: "linear-gradient(135deg, #A78BFA, #7C3AED)",
};

const STARTER_QUESTIONS = [
  "Who has startup founding experience?",
  "Who works in healthcare or health tech?",
  "Who are the strongest engineers?",
  "Who should I get to know better?",
];

// ── Tiny components ────────────────────────────────────────────────────

function Avatar({ name, size = 34, degree }) {
  const bg = (degree && DEGREE_AVATAR_GRADIENTS[degree]) || gradientForName(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.26,
      background: bg, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, fontFamily: FONT,
      flexShrink: 0, textShadow: "0 1px 2px rgba(0,0,0,0.15)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    }}>{initialsForName(name)}</div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

// ── Simple markdown renderer ───────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return null;

  // Split into lines
  const lines = text.split("\n");
  const elements = [];
  let currentList = [];
  let key = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={key++} style={{ margin: "8px 0", paddingLeft: 20, listStyleType: "disc" }}>
          {currentList.map((item, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: C.ink, marginBottom: 4 }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
      continue;
    }
    flushList();

    if (line.trim() === "") {
      elements.push(<div key={key++} style={{ height: 8 }} />);
    } else if (line.startsWith("**") && line.endsWith("**")) {
      // Bold heading line
      elements.push(
        <div key={key++} style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 12, marginBottom: 4 }}>
          {line.replace(/\*\*/g, "")}
        </div>
      );
    } else {
      elements.push(
        <p key={key++} style={{ fontSize: 14, lineHeight: 1.6, color: C.ink, margin: "4px 0" }}>
          {renderInline(line)}
        </p>
      );
    }
  }
  flushList();
  return elements;
}

function renderInline(text) {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// ── Photo avatar ──────────────────────────────────────────────────────

function isPlaceholderPhoto(url) {
  return url && url.includes("static.licdn.com");
}

function PhotoAvatar({ name, photoUrl, size = 36, degree }) {
  const [imgError, setImgError] = useState(false);
  if (photoUrl && !imgError && !isPlaceholderPhoto(photoUrl)) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setImgError(true)}
        style={{
          width: size, height: size, borderRadius: size * 0.26,
          objectFit: "cover", flexShrink: 0,
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      />
    );
  }
  return <Avatar name={name} size={size} degree={degree} />;
}

// ── Person card ────────────────────────────────────────────────────────

function PersonCard({ person }) {
  const colors = DEGREE_COLORS[person.degree] || DEGREE_COLORS[3];
  const subtitle = [person.current_title, person.current_company].filter(Boolean).join(" at ");

  return (
    <a
      href={`/person/${person.id}`}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px", background: colors.bg,
        borderRadius: 12, border: `1.5px solid ${colors.border}`,
        textDecoration: "none", cursor: "pointer",
        transition: "box-shadow 0.15s",
      }}
    >
      <PhotoAvatar name={person.name} photoUrl={person.photo_url} size={36} degree={person.degree} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: C.ink, fontFamily: FONT }}>{person.name}</span>
          <span style={{
            fontSize: 9, fontWeight: 700, color: "#fff",
            background: colors.badge, borderRadius: 4,
            padding: "1px 5px", letterSpacing: 0.3,
          }}>
            {DEGREE_LABELS[person.degree]}
          </span>
        </div>
        {subtitle && (
          <div style={{ fontSize: 12, color: C.ink, fontFamily: FONT, marginTop: 2, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subtitle}
          </div>
        )}
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </a>
  );
}

// ── People mentioned — avatar strip + expand ─────────────────────────

function PeopleMentioned({ people }) {
  const [expanded, setExpanded] = useState(false);
  if (!people || people.length === 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      {/* Always-visible avatar strip */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", gap: 0,
          background: "none", border: "none", cursor: "pointer",
          padding: "6px 0", fontFamily: FONT,
        }}
      >
        {/* Stacked avatars */}
        <div style={{ display: "flex", flexShrink: 0 }}>
          {people.slice(0, 5).map((p, i) => (
            <div
              key={p.id}
              style={{
                marginLeft: i === 0 ? 0 : -8,
                zIndex: people.length - i,
                borderRadius: "50%",
                border: "2px solid #fff",
                lineHeight: 0,
              }}
            >
              <PhotoAvatar name={p.name} photoUrl={p.photo_url} size={28} degree={p.degree} />
            </div>
          ))}
        </div>
        <span style={{
          fontSize: 12, color: C.sub, fontWeight: 500,
          marginLeft: 10, whiteSpace: "nowrap",
        }}>
          {people.length} {people.length === 1 ? "person" : "people"} mentioned
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: 4, flexShrink: 0, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded cards */}
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {people.map(p => <PersonCard key={p.id} person={p} />)}
        </div>
      )}
    </div>
  );
}

// ── Login prompt ───────────────────────────────────────────────────────

function LoginPrompt() {
  const [identifier, setIdentifier] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!identifier.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      if (!res.ok) throw new Error("Request failed");
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div style={{ textAlign: "center", paddingTop: 60 }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>Check your email</div>
        <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6 }}>
          If we found an account matching <strong style={{ color: C.ink }}>{identifier}</strong>,
          we've sent you a login link. It may take a moment to arrive.
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 48 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
        Access Network Brain
      </div>
      <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5, marginBottom: 20 }}>
        Enter your email address or LinkedIn URL to receive a login link.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
          placeholder="Email or LinkedIn URL"
          autoComplete="off"
          style={{
            flex: 1, padding: "12px 14px",
            fontSize: 16, border: `1.5px solid ${C.border}`,
            borderRadius: 10, fontFamily: FONT,
            color: C.ink, background: "#fff",
            WebkitAppearance: "none",
          }}
        />
        <button
          type="submit"
          disabled={!identifier.trim() || sending}
          style={{
            padding: "12px 20px",
            background: identifier.trim() && !sending ? C.accent : "#C7D2FE",
            color: "#fff", border: "none", borderRadius: 10,
            fontSize: 14, fontWeight: 600, fontFamily: FONT,
            cursor: identifier.trim() && !sending ? "pointer" : "not-allowed",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {sending ? "..." : "Log in"}
        </button>
      </form>
      {error && (
        <div style={{ marginTop: 10, fontSize: 13, color: "#DC2626", fontFamily: FONT }}>{error}</div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────

export default function NetworkBrainPage() {
  const [authState, setAuthState] = useState("checking");
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]); // [{ role: 'user'|'brain', text, people? }]
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const lastBrainRef = useRef(null);
  const inputRef = useRef(null);

  // Auth flow on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("token");

    if (loginToken) {
      fetch(`/api/auth/validate?token=${loginToken}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (data.user) {
            setUser(data.user);
            setAuthState("authenticated");
            window.history.replaceState({}, "", window.location.pathname);
          } else {
            setAuthState("unauthenticated");
          }
        })
        .catch(() => setAuthState("unauthenticated"));
    } else {
      fetch("/api/auth/session", { credentials: "include" })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error("No session");
        })
        .then(data => {
          setUser(data.user);
          setAuthState("authenticated");
          if (data.user?.id) identify(data.user.id, { name: data.user.name });
          capture("network_brain_viewed");
        })
        .catch(() => setAuthState("unauthenticated"));
    }
  }, []);

  // Auto-submit question from ?q= parameter (e.g. from homepage brain prompt)
  const autoAskedRef = useRef(false);
  useEffect(() => {
    if (authState !== "authenticated" || autoAskedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q?.trim()) {
      autoAskedRef.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      askQuestion(q.trim());
    }
  }, [authState]);

  // Scroll behavior: when loading starts, scroll to loading indicator;
  // when response arrives, scroll to top of latest brain response (offset for fixed header)
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (loading) {
      // Scrolls down to show the thinking indicator
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (prevLoadingRef.current && lastBrainRef.current) {
      // Just finished loading — scroll to the latest response with header offset
      const el = lastBrainRef.current;
      const y = el.getBoundingClientRect().top + window.scrollY - 96; // 80px header + 16px breathing room
      window.scrollTo({ top: y, behavior: "smooth" });
    }
    prevLoadingRef.current = loading;
  }, [messages, loading]);

  async function askQuestion(question) {
    if (!question.trim() || loading) return;

    const q = question.trim();
    setInput("");
    setError(null);
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setLoading(true);

    capture("network_brain_question", { question_length: q.length });

    try {
      const res = await fetch("/api/network-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Something went wrong");
      }

      const data = await res.json();
      setMessages(prev => [...prev, {
        role: "brain",
        text: data.answer || "I couldn't generate a response. Try rephrasing your question.",
        people: data.people || [],
      }]);

      capture("network_brain_answer", {
        answer_length: (data.answer || "").length,
        people_count: (data.people || []).length,
      });
    } catch (err) {
      setError(err.message);
      setMessages(prev => [...prev, {
        role: "brain",
        text: "Sorry, something went wrong. Please try again.",
        people: [],
      }]);
    } finally {
      setLoading(false);
      // Refocus input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    askQuestion(input);
  }

  const firstName = user?.name?.split(" ")[0] || "";

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh", background: "#000000", fontFamily: FONT,
      display: "flex", flexDirection: "column", alignItems: "center",
      overflowX: "hidden",
    }}>
      {/* Fixed header — logo + back/brain branding */}
      <div style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
        zIndex: 100, width: "100%", maxWidth: 900,
        background: "#FFFFFF", padding: "10px 20px 8px",
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <a
            href="#"
            onClick={e => { e.preventDefault(); window.history.back(); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", flexShrink: 0, fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </a>
          <span style={{ color: C.border, fontSize: 14 }}>|</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <BrainIcon />
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, letterSpacing: -0.3 }}>Network Brain</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{
        width: "100%", maxWidth: 900,
        background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
        padding: "0 16px 120px", margin: "80px 0 0",
        minHeight: "calc(100vh - 80px)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ maxWidth: 480, margin: "0 auto", width: "100%", flex: 1, display: "flex", flexDirection: "column" }}>

          {/* Checking auth */}
          {authState === "checking" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 40 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  height: 52, borderRadius: 12,
                  background: "linear-gradient(90deg, #e8e4e0 25%, #ddd8d4 50%, #e8e4e0 75%)",
                  backgroundSize: "200% 100%",
                  animation: `shimmer 1.2s ${i * 0.15}s infinite`,
                }} />
              ))}
              <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
            </div>
          )}

          {/* Unauthenticated */}
          {authState === "unauthenticated" && <LoginPrompt />}

          {/* Authenticated — Brain UI */}
          {authState === "authenticated" && (
            <>
              {/* Subtitle */}
              <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5, margin: 0, textAlign: "center", paddingTop: 16, paddingBottom: 8 }}>
                Ask anything about your professional network
              </p>

              {/* Conversation area */}
              <div style={{ flex: 1, paddingTop: 16, paddingBottom: 16 }}>

                {/* Starter chips (only when no messages) */}
                {messages.length === 0 && !loading && (
                  <div style={{ paddingTop: 20 }}>
                    <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
                      Try asking
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {STARTER_QUESTIONS.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => askQuestion(q)}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "12px 16px",
                            background: "#FFFFFF", border: `1.5px solid ${C.border}`,
                            borderRadius: 12, fontSize: 14, color: C.ink,
                            fontFamily: FONT, cursor: "pointer",
                            transition: "border-color 0.15s, box-shadow 0.15s",
                          }}
                          onMouseEnter={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 2px 8px rgba(79,70,229,0.1)"; }}
                          onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages */}
                {messages.map((msg, i) => {
                  const isLastBrain = msg.role === "brain" && i === messages.length - 1;
                  return (
                    <div key={i} ref={isLastBrain ? lastBrainRef : undefined} style={{ marginBottom: 16 }}>
                      {msg.role === "user" ? (
                        /* User question bubble */
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <div style={{
                            background: C.accent, color: "#fff",
                            padding: "10px 16px", borderRadius: "16px 16px 4px 16px",
                            fontSize: 14, lineHeight: 1.5, fontFamily: FONT,
                            maxWidth: "85%",
                          }}>
                            {msg.text}
                          </div>
                        </div>
                      ) : (
                        /* Brain answer */
                        <div>
                          <div style={{
                            background: "#FFFFFF", border: `1px solid ${C.border}`,
                            padding: "16px 18px", borderRadius: "4px 16px 16px 16px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                          }}>
                            {renderMarkdown(msg.text)}
                          </div>
                          <PeopleMentioned people={msg.people} />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Loading indicator */}
                {loading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0" }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: C.accent, animation: "pulse 1.2s infinite",
                    }} />
                    <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>
                      Thinking about your network — this usually takes about 10 seconds...
                    </span>
                    <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }`}</style>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>

              {/* Fixed input bar */}
              <div style={{
                position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
                width: "100%", maxWidth: 900,
                background: "linear-gradient(0deg, #DDD0F0 0%, #DDD0F0 80%, transparent 100%)",
                padding: "24px 16px 24px",
              }}>
                <form
                  onSubmit={handleSubmit}
                  style={{
                    display: "flex", gap: 8, maxWidth: 480, margin: "0 auto",
                  }}
                >
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={firstName ? `Ask about your network, ${firstName}...` : "Ask about your network..."}
                    disabled={loading}
                    autoFocus
                    style={{
                      flex: 1, padding: "14px 16px",
                      fontSize: 16, border: `1.5px solid ${C.border}`,
                      borderRadius: 14, fontFamily: FONT,
                      color: C.ink, background: "#FFFFFF",
                      WebkitAppearance: "none",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      outline: "none",
                    }}
                    onFocus={e => e.target.style.borderColor = C.accent}
                    onBlur={e => e.target.style.borderColor = C.border}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    style={{
                      width: 48, height: 48,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: input.trim() && !loading ? C.accent : "#C7D2FE",
                      color: "#fff", border: "none", borderRadius: 14,
                      cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                      flexShrink: 0, transition: "background 0.15s",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                    }}
                  >
                    <SendIcon />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
