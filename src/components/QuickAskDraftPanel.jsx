import { useState } from "react";
import { gradientForName, initialsForName } from "../lib/avatar.js";

const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentLight: "#EFF6FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  error: "#DC2626",
  errorLight: "#FEF2F2",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const DEGREE_COLORS = {
  1: { bg: "#EEF2FF", border: "#A5B4FC", badge: "linear-gradient(135deg, #6366F1, #4F46E5)" },
  2: { bg: "#ECFDF5", border: "#86EFAC", badge: "linear-gradient(135deg, #34D399, #16A34A)" },
  3: { bg: "#F5F3FF", border: "#C4B5FD", badge: "linear-gradient(135deg, #A78BFA, #7C3AED)" },
};

// ── Small avatar for vouch path ──────────────────────────────────────────
function MiniAvatar({ name, photoUrl, size = 22 }) {
  const [err, setErr] = useState(false);
  const isPlaceholder = photoUrl && photoUrl.includes("static.licdn.com");
  if (photoUrl && !err && !isPlaceholder) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, borderRadius: size * 0.3, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.3,
      background: gradientForName(name), color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, fontFamily: FONT, flexShrink: 0,
    }}>
      {initialsForName(name)}
    </div>
  );
}

// ── Vouch path visualization ─────────────────────────────────────────────
function VouchPath({ path }) {
  if (!path || path.length < 2) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
      {path.map((p, i) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {i > 0 && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          )}
          <MiniAvatar name={p.name} size={22} />
          <span style={{ fontSize: 12, color: C.ink, fontFamily: FONT, fontWeight: i === 0 || i === path.length - 1 ? 600 : 400 }}>
            {p.name.split(" ")[0]}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Single draft card ────────────────────────────────────────────────────
function DraftCard({ draft, sendingState, onEdit, onSend }) {
  const colors = DEGREE_COLORS[draft.degree] || DEGREE_COLORS[3];
  const stateRaw = sendingState || "draft";
  // sendingState can be a string ("draft"|"sending"|"sent") or { status, reason }
  const state = typeof stateRaw === "object" ? stateRaw.status : stateRaw;
  const failReason = typeof stateRaw === "object" ? stateRaw.reason : null;
  const isSent = state === "sent";
  const isSending = state === "sending";
  const isFailed = state === "failed";

  return (
    <div style={{
      background: isSent ? C.successLight : "#FFFFFF",
      borderRadius: 14,
      border: `1.5px solid ${isSent ? "#86EFAC" : isFailed ? C.error : C.border}`,
      padding: "14px 16px",
      transition: "border-color 0.2s, background 0.2s",
    }}>
      {/* Recipient header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <MiniAvatar name={draft.recipient_name} photoUrl={draft.recipient_photo_url} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: C.ink, fontFamily: FONT }}>{draft.recipient_name}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, color: "#fff",
              background: colors.badge, borderRadius: 4,
              padding: "1px 5px", letterSpacing: 0.3,
            }}>
              {draft.degree === 1 ? "1st" : draft.degree === 2 ? "2nd" : "3rd"}
            </span>
          </div>
          {draft.recipient_title && (
            <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 1 }}>
              {draft.recipient_title}
            </div>
          )}
        </div>
        {isSent && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.success, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Sent
          </div>
        )}
      </div>

      {/* Vouch path */}
      <VouchPath path={draft.vouch_path} />

      {/* No email warning */}
      {draft.no_email && (
        <div style={{
          padding: "8px 12px", background: C.errorLight, borderRadius: 8,
          fontSize: 12, color: C.error, fontFamily: FONT, marginBottom: 10,
        }}>
          No email address on file — message cannot be sent
        </div>
      )}

      {/* Subject */}
      {!isSent && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.sub, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5 }}>Subject</label>
          <input
            value={draft.draft_subject}
            onChange={e => onEdit(draft.id, "draft_subject", e.target.value)}
            disabled={isSending || isSent}
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
      )}

      {/* Body */}
      {!isSent ? (
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.sub, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5 }}>Message</label>
          <textarea
            value={draft.draft_body}
            onChange={e => onEdit(draft.id, "draft_body", e.target.value)}
            disabled={isSending || isSent}
            rows={4}
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
      ) : (
        <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic", marginTop: 4 }}>
          Message delivered to {draft.recipient_name.split(" ")[0]}
        </div>
      )}

      {/* Send button (per draft) */}
      {!isSent && !isSending && !draft.no_email && (
        <button
          onClick={() => onSend(draft.id)}
          style={{
            marginTop: 10, padding: "8px 16px",
            background: C.accent, color: "#fff",
            border: "none", borderRadius: 8,
            fontSize: 13, fontWeight: 600, fontFamily: FONT,
            cursor: "pointer", transition: "opacity 0.15s",
          }}
        >
          Send to {draft.recipient_name.split(" ")[0]}
        </button>
      )}

      {isSending && (
        <div style={{ marginTop: 10, fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>
          Sending...
        </div>
      )}

      {isFailed && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.error, fontFamily: FONT }}>
          Failed to send{failReason ? `: ${failReason}` : " — try again"}
        </div>
      )}
    </div>
  );
}

// ── Main export: QuickAskDraftPanel ──────────────────────────────────────
export default function QuickAskDraftPanel({ drafts, setDrafts, askId, onDone, onCancel, replyContext }) {
  const [sendingState, setSendingState] = useState({}); // { [draftId]: 'sending'|'sent'|'failed' }
  const [sendAllLoading, setSendAllLoading] = useState(false);

  const handleEdit = (draftId, field, value) => {
    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, [field]: value } : d));
    // Fire-and-forget save to server
    fetch(`/api/quick-ask/draft/${draftId}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    }).catch(() => {});
  };

  const handleSend = async (draftId) => {
    setSendingState(prev => ({ ...prev, [draftId]: "sending" }));
    try {
      const res = await fetch("/api/quick-ask/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask_id: askId, recipient_row_ids: [draftId] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendingState(prev => ({ ...prev, [draftId]: { status: "failed", reason: data.error || "Send failed" } }));
        return;
      }
      const result = data.results?.[0];
      if (result?.status === "sent") {
        setSendingState(prev => ({ ...prev, [draftId]: "sent" }));
      } else {
        setSendingState(prev => ({ ...prev, [draftId]: { status: "failed", reason: result?.reason || "Send failed" } }));
      }
    } catch {
      setSendingState(prev => ({ ...prev, [draftId]: { status: "failed", reason: "Network error" } }));
    }
  };

  const handleSendAll = async () => {
    setSendAllLoading(true);
    const unsent = drafts.filter(d => !d.no_email && sendingState[d.id] !== "sent");
    for (const d of unsent) {
      setSendingState(prev => ({ ...prev, [d.id]: "sending" }));
    }
    try {
      const res = await fetch("/api/quick-ask/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask_id: askId, recipient_row_ids: unsent.map(d => d.id) }),
      });
      const data = await res.json();
      for (const result of (data.results || [])) {
        setSendingState(prev => ({ ...prev, [result.id]: result.status === "sent" ? "sent" : { status: "failed", reason: result.reason || "Send failed" } }));
      }
    } catch {
      for (const d of unsent) {
        setSendingState(prev => ({ ...prev, [d.id]: { status: "failed", reason: "Network error" } }));
      }
    }
    setSendAllLoading(false);
  };

  const allSent = drafts.every(d => sendingState[d.id] === "sent" || d.no_email);
  const sendableCount = drafts.filter(d => !d.no_email && sendingState[d.id] !== "sent").length;

  return (
    <div style={{
      background: "#FAFAF9",
      borderRadius: 16,
      border: `1.5px solid ${C.accent}`,
      padding: "16px",
      marginTop: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: replyContext ? 10 : 14 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
          {allSent ? (replyContext ? "Reply sent!" : (drafts.length === 1 ? "Message sent!" : "Messages sent!")) : replyContext ? `Reply to ${replyContext.sender_first_name}` : (drafts.length === 1 ? "Review your message" : "Review your messages")}
        </span>
      </div>

      {/* Original message (reply mode) */}
      {replyContext && !allSent && (
        <div style={{
          marginBottom: 14, padding: "10px 14px",
          background: "#FFFFFF", border: `1.5px solid ${C.border}`,
          borderRadius: 10,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: "#6B7280",
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
          }}>
            Message from {replyContext.sender_first_name}
          </div>
          <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.5, fontFamily: FONT }}>
            {replyContext.message_body}
          </div>
        </div>
      )}

      {/* Draft cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {drafts.map(d => (
          <DraftCard
            key={d.id}
            draft={d}
            sendingState={sendingState[d.id]}
            onEdit={handleEdit}
            onSend={handleSend}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
        {!allSent && (
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
        )}

        {!allSent && sendableCount > 1 && (
          <button
            onClick={handleSendAll}
            disabled={sendAllLoading}
            style={{
              padding: "8px 18px",
              background: sendAllLoading ? "#C7D2FE" : C.accent,
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
              cursor: sendAllLoading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {sendAllLoading ? "Sending..." : `Send All (${sendableCount})`}
          </button>
        )}

        {allSent && (
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
        )}
      </div>
    </div>
  );
}
