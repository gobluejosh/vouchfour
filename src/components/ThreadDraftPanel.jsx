import { useState, useRef, useEffect } from "react";
import { gradientForName, initialsForName } from "../lib/avatar.js";

const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  error: "#DC2626",
  errorLight: "#FEF2F2",
};
const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

function MiniAvatar({ name, photoUrl, size = 28 }) {
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

export default function ThreadDraftPanel({ threadId, creatorToken, topic, draftSubject, draftBody, participants, onDone, onCancel }) {
  const [subject, setSubject] = useState(draftSubject || "");
  const [body, setBody] = useState(draftBody || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const saveTimer = useRef(null);

  // Fire-and-forget auto-save on edit
  function handleEdit(field, value) {
    if (field === "subject") setSubject(value);
    else setBody(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/threads/draft/${threadId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_subject: field === "subject" ? value : subject,
          draft_body: field === "body" ? value : body,
        }),
      }).catch(() => {});
    }, 800);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/threads/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setResults(data.results || []);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  // Poll for retry results when there are failures
  useEffect(() => {
    if (!sent || !results || !results.some(r => r.status === "failed")) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/threads/${threadId}/send-status`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const allSent = data.results.every(r => r.status === "sent");
        if (allSent) {
          // Update results to reflect successful retries
          setResults(prev => prev.map(r => ({ ...r, status: "sent", reason: undefined })));
        }
      } catch {}
    }, 10000); // check after 10 seconds
    return () => clearTimeout(timer);
  }, [sent, results]);

  const sentCount = results ? results.filter(r => r.status === "sent").length : 0;

  return (
    <div style={{
      background: "#FAFAF9",
      borderRadius: 16,
      border: `1.5px solid ${C.accent}`,
      padding: "16px",
      marginTop: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
          {sent ? "Thread started!" : "Review your group thread"}
        </span>
      </div>

      {/* Topic chip */}
      <div style={{
        display: "inline-block", padding: "4px 12px",
        background: "#F5F3FF", border: "1px solid #C4B5FD",
        borderRadius: 20, fontSize: 13, fontWeight: 600,
        color: "#7C3AED", fontFamily: FONT, marginBottom: 14,
      }}>
        {topic}
      </div>

      {/* Participant avatars */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.sub, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5, marginRight: 4 }}>
          To
        </span>
        {participants.map(p => (
          <div key={p.person_id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <MiniAvatar name={p.name} photoUrl={p.photo_url} size={24} />
            <span style={{ fontSize: 12, color: C.ink, fontFamily: FONT }}>{p.name.split(" ")[0]}</span>
          </div>
        ))}
      </div>

      {!sent ? (
        <>
          {/* Subject */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.sub, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5 }}>Subject</label>
            <input
              value={subject}
              onChange={e => handleEdit("subject", e.target.value)}
              disabled={sending}
              style={{
                width: "100%", padding: "8px 10px", marginTop: 4,
                fontSize: 16, border: `1.5px solid ${C.border}`,
                borderRadius: 8, fontFamily: FONT, color: C.ink,
                background: "#fff", WebkitAppearance: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={e => { e.target.style.borderColor = C.accent; }}
              onBlur={e => { e.target.style.borderColor = C.border; }}
            />
          </div>

          {/* Body */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.sub, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5 }}>Message</label>
            <textarea
              value={body}
              onChange={e => handleEdit("body", e.target.value)}
              disabled={sending}
              rows={5}
              style={{
                width: "100%", padding: "8px 10px", marginTop: 4,
                fontSize: 16, border: `1.5px solid ${C.border}`,
                borderRadius: 8, fontFamily: FONT, color: C.ink,
                background: "#fff", WebkitAppearance: "none",
                resize: "vertical", lineHeight: 1.5,
                transition: "border-color 0.15s",
              }}
              onFocus={e => { e.target.style.borderColor = C.accent; }}
              onBlur={e => { e.target.style.borderColor = C.border; }}
            />
          </div>

          {/* Note */}
          <p style={{ fontSize: 12, color: C.sub, fontFamily: FONT, margin: "8px 0 0", lineHeight: 1.5 }}>
            This message will be sent to all {participants.length} participants. Only your name is shown in the email.
          </p>

          {error && (
            <div style={{
              marginTop: 8, padding: "8px 12px",
              background: C.errorLight, borderRadius: 8,
              fontSize: 13, color: C.error, fontFamily: FONT,
            }}>
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
            <button
              onClick={onCancel}
              style={{
                padding: "8px 16px", background: "#F5F5F4",
                color: C.sub, border: `1px solid ${C.border}`,
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                fontFamily: FONT, cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !body.trim()}
              style={{
                padding: "8px 18px",
                background: sending || !body.trim() ? "#C7D2FE" : C.accent,
                color: "#fff", border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                cursor: sending || !body.trim() ? "not-allowed" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {sending ? "Sending..." : `Send to All (${participants.length})`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{
            padding: "12px 16px", background: C.successLight,
            border: `1.5px solid #86EFAC`, borderRadius: 10,
            fontSize: 14, color: C.success, fontFamily: FONT, fontWeight: 600,
            marginBottom: 14,
          }}>
            ✓ Thread started — {sentCount} of {participants.length} email{participants.length !== 1 ? "s" : ""} sent
          </div>
          {results && results.some(r => r.status === "failed") && (
            <div style={{
              padding: "8px 12px", background: C.errorLight, borderRadius: 8,
              fontSize: 12, color: C.error, fontFamily: FONT, marginBottom: 10,
            }}>
              {results.filter(r => r.status === "failed").map(r => r.reason || "Send failed").join(". ")} — retrying automatically
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <a
              href={`/thread/${creatorToken}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "8px 18px", background: "#F5F3FF",
                color: "#7C3AED", border: "1px solid #C4B5FD",
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                fontFamily: FONT, cursor: "pointer", textDecoration: "none",
              }}
            >
              View your thread →
            </a>
            <button
              onClick={onDone}
              style={{
                padding: "8px 18px", background: C.accent,
                color: "#fff", border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
