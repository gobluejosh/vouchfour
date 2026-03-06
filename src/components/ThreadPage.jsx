import { useState, useEffect, useRef } from "react";
import { gradientForName, initialsForName } from "../lib/avatar.js";

const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  border: "#E7E5E0",
  success: "#16A34A",
};
const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

// ── Avatar ────────────────────────────────────────────────────────────

function PhotoAvatar({ name, photoUrl, size = 36 }) {
  const [err, setErr] = useState(false);
  const isPlaceholder = photoUrl && photoUrl.includes("static.licdn.com");
  if (photoUrl && !err && !isPlaceholder) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: gradientForName(name), color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, fontFamily: FONT, flexShrink: 0,
    }}>
      {initialsForName(name)}
    </div>
  );
}

// ── Time formatting ───────────────────────────────────────────────────

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Message bubble ────────────────────────────────────────────────────

function MessageBubble({ msg, isViewer }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      flexDirection: isViewer ? "row-reverse" : "row",
    }}>
      <PhotoAvatar name={msg.author_name} photoUrl={msg.author_photo_url} size={32} />
      <div style={{ maxWidth: "75%", minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "baseline", gap: 6,
          flexDirection: isViewer ? "row-reverse" : "row",
          marginBottom: 2,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
            {msg.author_name.split(" ")[0]}
          </span>
          <span style={{ fontSize: 10, color: C.sub, fontFamily: FONT }}>
            {timeAgo(msg.created_at)}
          </span>
          {msg.is_initial && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: C.accent,
              background: "#EEF2FF", borderRadius: 4,
              padding: "1px 5px", letterSpacing: 0.3,
            }}>
              STARTED
            </span>
          )}
        </div>
        <div style={{
          padding: "10px 14px",
          background: isViewer ? C.accent : "#FFFFFF",
          color: isViewer ? "#fff" : C.ink,
          borderRadius: isViewer ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
          border: isViewer ? "none" : `1px solid ${C.border}`,
          fontSize: 14, lineHeight: 1.6, fontFamily: FONT,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {msg.body}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

export default function ThreadPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [thread, setThread] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [viewerId, setViewerId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const token = window.location.pathname.split("/thread/")[1];

  // Load thread data
  useEffect(() => {
    if (!token) { setError("Invalid thread link"); setLoading(false); return; }

    fetch(`/api/thread/${token}`, { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? "Thread not found" : "Failed to load thread");
        return res.json();
      })
      .then(data => {
        setThread(data.thread);
        setParticipants(data.participants);
        setMessages(data.messages);
        setViewerId(data.viewer_person_id);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [token]);

  // Scroll to bottom on initial load and new messages
  useEffect(() => {
    if (!loading && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, loading]);

  async function handleReply() {
    if (!replyText.trim() || sending) return;
    const body = replyText.trim();
    setSending(true);

    // Optimistic append
    const viewer = participants.find(p => p.person_id === viewerId);
    const optimisticMsg = {
      id: Date.now(),
      author_id: viewerId,
      author_name: viewer?.display_name || "You",
      author_photo_url: viewer?.photo_url || null,
      body,
      is_initial: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setReplyText("");

    try {
      const res = await fetch(`/api/thread/${token}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send reply");
      }
      const data = await res.json();
      // Replace optimistic message with real one
      setMessages(prev => prev.map(m => m.id === optimisticMsg.id ? { ...optimisticMsg, id: data.message_id } : m));
    } catch (err) {
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setReplyText(body);
      alert(err.message);
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: "#000", fontFamily: FONT,
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        <div style={{
          width: "100%", maxWidth: 900,
          background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
          minHeight: "100vh", padding: "80px 16px",
        }}>
          <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 40 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                height: 60, borderRadius: 12, marginBottom: 12,
                background: "linear-gradient(90deg, #e8e4e0 25%, #ddd8d4 50%, #e8e4e0 75%)",
                backgroundSize: "200% 100%",
                animation: `shimmer 1.2s ${i * 0.15}s infinite`,
              }} />
            ))}
            <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: "100vh", background: "#000", fontFamily: FONT,
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        <div style={{
          width: "100%", maxWidth: 900,
          background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
          minHeight: "100vh", padding: "80px 16px",
        }}>
          <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 60, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
              {error}
            </div>
            <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5 }}>
              This link may have expired or is invalid. Check your email for the correct link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#000000", fontFamily: FONT,
      display: "flex", flexDirection: "column", alignItems: "center",
      overflowX: "hidden",
    }}>
      {/* Fixed header */}
      <div style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
        zIndex: 100, width: "100%", maxWidth: 900,
        background: "#FFFFFF", padding: "10px 20px 10px",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 4 }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span style={{
              fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {thread.topic}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{
        width: "100%", maxWidth: 900,
        background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
        padding: "80px 16px 140px",
        minHeight: "100vh",
      }}>
        <div style={{ maxWidth: 480, margin: "0 auto", width: "100%" }}>

          {/* Participants strip */}
          <div style={{
            padding: "16px 0 12px",
            borderBottom: `1px solid ${C.border}`,
            marginBottom: 16,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: C.sub,
              textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
            }}>
              Participants
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {participants.map(p => (
                <a
                  key={p.person_id}
                  href={`/person/${p.person_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                >
                  <PhotoAvatar name={p.display_name} photoUrl={p.photo_url} size={28} />
                  <div>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: C.ink, fontFamily: FONT,
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      {p.display_name.split(" ")[0]}
                      {p.role === "creator" && (
                        <span style={{
                          fontSize: 8, fontWeight: 700, color: C.accent,
                          background: "#EEF2FF", borderRadius: 3,
                          padding: "0px 4px", letterSpacing: 0.3,
                        }}>
                          HOST
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isViewer={msg.author_id === viewerId}
              />
            ))}
          </div>

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Fixed reply input */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 900,
        background: "linear-gradient(0deg, #DDD0F0 0%, #DDD0F0 80%, transparent 100%)",
        padding: "24px 16px 24px",
      }}>
        <div style={{
          display: "flex", gap: 8, maxWidth: 480, margin: "0 auto",
          alignItems: "flex-end",
        }}>
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={1}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleReply();
              }
            }}
            style={{
              flex: 1, padding: "12px 16px",
              fontSize: 16, border: `1.5px solid ${C.border}`,
              borderRadius: 14, fontFamily: FONT,
              color: C.ink, background: "#fff",
              WebkitAppearance: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              outline: "none", resize: "none",
              lineHeight: 1.5, minHeight: 48, maxHeight: 120,
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
            onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
            onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; }}
            onInput={e => {
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleReply}
            disabled={!replyText.trim() || sending}
            style={{
              width: 48, height: 48,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: replyText.trim() && !sending ? C.accent : "#C7D2FE",
              color: "#fff", border: "none", borderRadius: 14,
              cursor: replyText.trim() && !sending ? "pointer" : "not-allowed",
              flexShrink: 0, transition: "background 0.15s",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
