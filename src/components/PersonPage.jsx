import { useState, useEffect } from "react";
import { capture, identify } from "../lib/posthog.js";
import { gradientForName, initialsForName } from "../lib/avatar.js";
import QuickAskDraftPanel from "./QuickAskDraftPanel.jsx";

const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentLight: "#EFF6FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chipBorder: "#BFDBFE",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const DEGREE_LABELS = { 0: "You", 1: "1st", 2: "2nd", 3: "3rd" };
const DEGREE_COLORS = {
  0: { bg: "#FFF7ED", border: "#FDBA74", badge: "linear-gradient(135deg, #F97316, #EA580C)" },
  1: { bg: "#EEF2FF", border: "#A5B4FC", badge: "linear-gradient(135deg, #6366F1, #4F46E5)" },
  2: { bg: "#ECFDF5", border: "#86EFAC", badge: "linear-gradient(135deg, #34D399, #16A34A)" },
  3: { bg: "#F5F3FF", border: "#C4B5FD", badge: "linear-gradient(135deg, #A78BFA, #7C3AED)" },
};

// ── Tiny components ────────────────────────────────────────────────────

function isPlaceholderPhoto(url) {
  return url && url.includes("static.licdn.com");
}

function PhotoAvatar({ name, photoUrl, size = 64 }) {
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
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.26,
      background: gradientForName(name), color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.32, fontWeight: 700, fontFamily: FONT,
      flexShrink: 0, textShadow: "0 1px 2px rgba(0,0,0,0.15)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
    }}>
      {initialsForName(name)}
    </div>
  );
}

function DegreeBadge({ degree }) {
  const colors = DEGREE_COLORS[degree] || DEGREE_COLORS[3];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: "#fff",
      background: colors.badge, borderRadius: 5,
      padding: "2px 8px", letterSpacing: 0.3,
    }}>
      {DEGREE_LABELS[degree] || `${degree}°`}
    </span>
  );
}

function ExternalLinkIcon({ size = 14, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
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
          we've sent you a login link.
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 48 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
        Sign in to view this profile
      </div>
      <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5, marginBottom: 20 }}>
        Enter your email or LinkedIn URL to receive a login link.
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

// ── Pencil icon ───────────────────────────────────────────────────────

function PencilIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

// ── Profile Edit Form ─────────────────────────────────────────────────

function ProfileEditForm({ person, onSave, onCancel }) {
  const [name, setName] = useState(person.name || "");
  const [linkedin, setLinkedin] = useState(person.linkedin_url || "");
  const [email, setEmail] = useState(person.email || "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleSave() {
    if (!name.trim()) { setFormError("Name is required"); return; }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/person/${person.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: "profile",
          display_name: name.trim(),
          linkedin_url: linkedin.trim(),
          email: email.trim(),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      onSave({ name: name.trim(), linkedin_url: linkedin.trim(), email: email.trim() });
    } catch {
      setFormError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px",
    fontSize: 16, fontFamily: FONT, color: C.ink,
    background: "#fff", border: `1.5px solid ${C.border}`,
    borderRadius: 8, boxSizing: "border-box",
    WebkitAppearance: "none",
  };

  const labelStyle = {
    display: "block", fontSize: 11, fontWeight: 600,
    color: C.sub, marginBottom: 4, fontFamily: FONT,
  };

  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
      border: `1.5px solid ${C.accent}`, marginBottom: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: C.accent,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12,
      }}>
        Edit Profile
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>LinkedIn URL</label>
        <input value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/..." style={inputStyle} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" style={inputStyle} />
      </div>

      {formError && <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 10, fontFamily: FONT }}>{formError}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "8px 18px", background: C.accent, color: "#fff",
            border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
            fontFamily: FONT, cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 18px", background: "#F5F5F4", color: C.sub,
            border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13,
            fontWeight: 600, fontFamily: FONT, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Summary Edit Form ─────────────────────────────────────────────────

function SummaryEditForm({ summary, personId, onSave, onCancel }) {
  const [text, setText] = useState(summary || "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleSave() {
    if (!text.trim()) { setFormError("Summary cannot be empty"); return; }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/person/${personId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "summary", ai_summary: text.trim() }),
      });
      if (!res.ok) throw new Error("Save failed");
      onSave(text.trim());
    } catch {
      setFormError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
      border: `1.5px solid ${C.accent}`, marginBottom: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: C.accent,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
      }}>
        Edit Professional Summary
      </div>
      <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginBottom: 10, lineHeight: 1.5 }}>
        This summary is shown on your profile and used by Network Brain.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={6}
        style={{
          width: "100%", padding: "10px 12px",
          fontSize: 16, fontFamily: FONT, color: C.ink,
          background: "#fff", border: `1.5px solid ${C.border}`,
          borderRadius: 8, resize: "vertical", lineHeight: 1.6,
          boxSizing: "border-box",
        }}
      />

      {formError && <div style={{ fontSize: 12, color: "#DC2626", marginTop: 8, fontFamily: FONT }}>{formError}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "8px 18px", background: C.accent, color: "#fff",
            border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
            fontFamily: FONT, cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 18px", background: "#F5F5F4", color: C.sub,
            border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13,
            fontWeight: 600, fontFamily: FONT, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main PersonPage ────────────────────────────────────────────────────

export default function PersonPage() {
  const personId = Number(window.location.pathname.split("/person/")[1]) || 0;

  const [authState, setAuthState] = useState("checking");
  const [authSlug, setAuthSlug] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);

  // Quick Ask state
  const [askOpen, setAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [knowsThem, setKnowsThem] = useState(null); // null = unanswered, true/false
  const [knowsThemHow, setKnowsThemHow] = useState("");
  const [intermediaryContext, setIntermediaryContext] = useState("");
  const [draftingLoading, setDraftingLoading] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [askId, setAskId] = useState(null);
  const [askError, setAskError] = useState(null);
  const [replyContext, setReplyContext] = useState(null); // { sender_name, message_body, subject }

  // Auth flow
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("token");

    if (loginToken) {
      fetch(`/api/auth/validate?token=${loginToken}`, { credentials: "include" })
        .then(res => res.json())
        .then(d => {
          if (d.user) {
            setAuthState("authenticated");
            if (d.user.linkedin) setAuthSlug(d.user.linkedin.split("/in/")[1]?.replace(/\/$/, ""));
            // Preserve reply_to param through login, strip only the token
            const kept = new URLSearchParams(window.location.search);
            kept.delete("token");
            const qs = kept.toString();
            window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
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
        .then(d => {
          setAuthState("authenticated");
          if (d.user?.id) {
            if (d.user.linkedin) setAuthSlug(d.user.linkedin.split("/in/")[1]?.replace(/\/$/, ""));
            identify(d.user.id, { name: d.user.name });
          }
        })
        .catch(() => setAuthState("unauthenticated"));
    }
  }, []);

  // Fetch person data once authenticated
  useEffect(() => {
    if (authState !== "authenticated" || !personId) return;
    setLoading(true);

    fetch(`/api/person/${personId}`, { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then(d => {
        setData(d);
        capture("person_page_viewed", { person_id: personId, degree: d.degree });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [authState, personId]);

  // Auto-open reply mode if ?reply_to= param present
  // Fetches the original message context, then creates a blank reply draft
  // so the user lands directly on the draft review panel (skips AI drafting)
  useEffect(() => {
    if (authState !== "authenticated") return;
    const params = new URLSearchParams(window.location.search);
    const replyTo = params.get("reply_to");
    if (!replyTo) return;

    // Clean the URL
    window.history.replaceState({}, "", window.location.pathname);

    (async () => {
      try {
        // 1. Fetch original message context
        const ctxRes = await fetch(`/api/quick-ask/reply-context/${replyTo}`, { credentials: "include" });
        if (!ctxRes.ok) return;
        const ctx = await ctxRes.json();
        setReplyContext(ctx);

        // 2. Create blank reply draft (skip AI)
        const draftRes = await fetch("/api/quick-ask/reply-draft", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply_to_id: Number(replyTo) }),
        });
        if (!draftRes.ok) return;
        const draftData = await draftRes.json();

        // 3. Jump straight to draft review panel
        setDrafts(draftData.drafts);
        setAskId(draftData.ask_id);
        setAskOpen(true);
        setKnowsThem(true);
      } catch (err) {
        console.error("[reply mode error]", err);
      }
    })();
  }, [authState]);

  // ── Quick Ask handlers ──────────────────────────────────────────────
  function handleAskCancel() {
    setAskOpen(false);
    setAskQuestion("");
    setKnowsThem(null);
    setKnowsThemHow("");
    setIntermediaryContext("");
    setReplyContext(null);
    setDrafts(null);
    setAskId(null);
    setAskError(null);
    setDraftingLoading(false);
  }

  async function handleDraftAsk() {
    if (!askQuestion.trim() || !personId) return;
    // For 2nd/3rd degree, require the "do you know them" answer
    const needsContext = data?.degree >= 2;
    if (needsContext && knowsThem === null) return;

    setDraftingLoading(true);
    setAskError(null);

    // Build recipient context (only for 2nd+ degree; 1st degree handled by backend)
    const recipient_context = {};
    if (needsContext) {
      recipient_context[personId] = {
        knows_them: knowsThem || false,
        relationship: knowsThem ? knowsThemHow : "",
        intermediary_context: intermediaryContext,
      };
    }

    try {
      const res = await fetch("/api/quick-ask/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: askQuestion.trim(),
          recipient_ids: [personId],
          recipient_context,
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to draft message");

      setDrafts(d.drafts);
      setAskId(d.ask_id);
      capture("quick_ask_drafted", { recipient_count: d.drafts.length, source: "person_page" });
    } catch (err) {
      setAskError(err.message);
    } finally {
      setDraftingLoading(false);
    }
  }

  function handleAskDone() {
    setAskOpen(false);
    setAskQuestion("");
    setKnowsThem(null);
    setKnowsThemHow("");
    setIntermediaryContext("");
    setReplyContext(null);
    setDrafts(null);
    setAskId(null);
    setAskError(null);
  }

  const person = data?.person;
  const subtitle = [person?.current_title, person?.current_company].filter(Boolean).join(" at ");
  const canAsk = data && !data.is_self && data.degree >= 1 && data.degree <= 3;
  const personFirstName = person?.name?.split(" ")[0] || "them";

  return (
    <div style={{
      minHeight: "100vh", background: "#000000", fontFamily: FONT,
      display: "flex", flexDirection: "column", alignItems: "center",
      overflowX: "hidden",
    }}>
      {/* Fixed logo bar */}
      <div style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
        zIndex: 100, width: "100%", maxWidth: 900,
        background: "#FFFFFF", padding: "12px 20px",
      }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
      </div>

      {/* Main content */}
      <div style={{
        width: "100%", maxWidth: 900,
        background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
        padding: "0 16px 80px", margin: "52px 0 0",
        minHeight: "calc(100vh - 52px)",
      }}>
        <div style={{ maxWidth: 480, margin: "0 auto", width: "100%" }}>

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

          {authState === "unauthenticated" && <LoginPrompt />}

          {error && (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 8 }}>Something went wrong</div>
              <div style={{ fontSize: 14, color: C.sub }}>{error}</div>
            </div>
          )}

          {/* Loading shimmer */}
          {authState === "authenticated" && loading && !error && (
            <div style={{ paddingTop: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 17,
                  background: "linear-gradient(90deg, #e8e4e0 25%, #ddd8d4 50%, #e8e4e0 75%)",
                  backgroundSize: "200% 100%", animation: "shimmer 1.2s infinite",
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 20, borderRadius: 6, background: "linear-gradient(90deg, #e8e4e0 25%, #ddd8d4 50%, #e8e4e0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.2s 0.1s infinite", width: "60%", marginBottom: 8 }} />
                  <div style={{ height: 14, borderRadius: 6, background: "linear-gradient(90deg, #e8e4e0 25%, #ddd8d4 50%, #e8e4e0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.2s 0.2s infinite", width: "80%" }} />
                </div>
              </div>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  height: 60, borderRadius: 12, marginBottom: 10,
                  background: "linear-gradient(90deg, #e8e4e0 25%, #ddd8d4 50%, #e8e4e0 75%)",
                  backgroundSize: "200% 100%", animation: `shimmer 1.2s ${i * 0.15}s infinite`,
                }} />
              ))}
              <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
            </div>
          )}

          {/* Person detail */}
          {authState === "authenticated" && !loading && !error && data && (
            <>
              {/* Back navigation */}
              <a
                href={authSlug ? `/talent/${authSlug}` : "/"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 13, color: C.ink, fontWeight: 600,
                  textDecoration: "none", fontFamily: FONT,
                  paddingTop: 20, paddingBottom: 4,
                }}
              >
                <BackIcon /> Talent Network
              </a>

              {/* Hero section */}
              <div style={{ paddingTop: 12, marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                  <PhotoAvatar name={person.name} photoUrl={person.photo_url} size={64} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h1 style={{ fontSize: 20, fontWeight: 800, color: C.ink, margin: 0, fontFamily: FONT }}>
                        {person.name}
                      </h1>
                      {data.degree != null && <DegreeBadge degree={data.degree} />}
                    </div>
                    {subtitle && (
                      <div style={{ fontSize: 14, color: C.sub, fontFamily: FONT, marginTop: 4 }}>
                        {subtitle}
                      </div>
                    )}
                    {person.location && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                        <LocationIcon />
                        <span style={{ fontSize: 12, color: C.sub, fontFamily: FONT }}>{person.location}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {person.linkedin_url && (
                    <a
                      href={person.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "8px 14px",
                        background: "#FFFFFF", border: `1.5px solid ${C.border}`,
                        borderRadius: 8, fontSize: 13, fontWeight: 600,
                        color: C.ink, fontFamily: FONT,
                        textDecoration: "none", cursor: "pointer",
                      }}
                    >
                      View on LinkedIn <ExternalLinkIcon size={12} color={C.ink} />
                    </a>
                  )}
                  {data.is_self && !editingProfile && (
                    <button
                      onClick={() => setEditingProfile(true)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "8px 14px",
                        background: "#FFFFFF", border: `1.5px solid ${C.border}`,
                        borderRadius: 8, fontSize: 13, fontWeight: 600,
                        color: C.sub, fontFamily: FONT, cursor: "pointer",
                      }}
                    >
                      <PencilIcon size={12} /> Edit Profile
                    </button>
                  )}
                  {canAsk && !askOpen && (
                    <button
                      onClick={() => setAskOpen(true)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "8px 14px",
                        background: "#FFFFFF", border: `1.5px solid ${C.border}`,
                        borderRadius: 8, fontSize: 13, fontWeight: 600,
                        color: C.accent, fontFamily: FONT, cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                      Ask {personFirstName}
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Ask inline form */}
              {askOpen && !drafts && (
                <div style={{
                  background: "#FAFAF9", borderRadius: 14,
                  border: `1.5px solid ${C.accent}`, padding: "14px 16px",
                  marginBottom: 16,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: C.accent,
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
                  }}>
                    Ask {personFirstName}
                  </div>
                  <textarea
                    value={askQuestion}
                    onChange={e => setAskQuestion(e.target.value)}
                    placeholder={`What would you like to ask ${personFirstName}?`}
                    rows={3}
                    autoFocus
                    disabled={draftingLoading}
                    style={{
                      width: "100%", padding: "10px 12px",
                      fontSize: 16, fontFamily: FONT, color: C.ink,
                      background: "#fff", border: `1.5px solid ${C.border}`,
                      borderRadius: 8, resize: "vertical", lineHeight: 1.5,
                      boxSizing: "border-box", WebkitAppearance: "none",
                      transition: "border-color 0.15s",
                    }}
                    onFocus={e => { e.target.style.borderColor = C.accent; }}
                    onBlur={e => { e.target.style.borderColor = C.border; }}
                  />
                  {/* Relationship context for 2nd/3rd degree (hidden in reply mode) */}
                  {!replyContext && data?.degree >= 2 && (() => {
                    const intermediaryFirst = data.intermediary_name?.split(" ")[0];
                    return (
                      <div style={{ marginTop: 10 }}>
                        {data.intermediary_name && (
                          <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginBottom: 8 }}>
                            Connected to {personFirstName} via <strong style={{ color: C.ink }}>{data.intermediary_name}</strong>
                          </div>
                        )}
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 6 }}>
                          Do you already know {personFirstName}?
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          {[
                            { label: "No", val: false },
                            { label: "Yes", val: true },
                          ].map(opt => (
                            <button
                              key={opt.label}
                              onClick={() => { setKnowsThem(opt.val); if (!opt.val) setKnowsThemHow(""); }}
                              disabled={draftingLoading}
                              style={{
                                padding: "5px 14px",
                                background: knowsThem === opt.val ? (opt.val ? C.accent : "#6B7280") : "#fff",
                                color: knowsThem === opt.val ? "#fff" : C.sub,
                                border: `1.5px solid ${knowsThem === opt.val ? (opt.val ? C.accent : "#6B7280") : C.border}`,
                                borderRadius: 6, fontSize: 12, fontWeight: 600,
                                fontFamily: FONT, cursor: "pointer",
                                transition: "all 0.15s",
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {knowsThem && (
                          <input
                            type="text"
                            value={knowsThemHow}
                            onChange={e => setKnowsThemHow(e.target.value)}
                            placeholder={`How do you know ${personFirstName}? (e.g., worked together at Acme)`}
                            disabled={draftingLoading}
                            style={{
                              width: "100%", padding: "8px 10px",
                              fontSize: 16, fontFamily: FONT, color: C.ink,
                              background: "#fff", border: `1.5px solid ${C.border}`,
                              borderRadius: 6, boxSizing: "border-box",
                              WebkitAppearance: "none",
                              transition: "border-color 0.15s",
                            }}
                            onFocus={e => { e.target.style.borderColor = C.accent; }}
                            onBlur={e => { e.target.style.borderColor = C.border; }}
                          />
                        )}
                        {knowsThem === false && intermediaryFirst && (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 6, marginTop: 10 }}>
                              How do you know {intermediaryFirst}?
                            </div>
                            <input
                              type="text"
                              value={intermediaryContext}
                              onChange={e => setIntermediaryContext(e.target.value)}
                              placeholder={`e.g., ${intermediaryFirst} and I worked together at Google`}
                              disabled={draftingLoading}
                              style={{
                                width: "100%", padding: "8px 10px",
                                fontSize: 16, fontFamily: FONT, color: C.ink,
                                background: "#fff", border: `1.5px solid ${C.border}`,
                                borderRadius: 6, boxSizing: "border-box",
                                WebkitAppearance: "none",
                                transition: "border-color 0.15s",
                              }}
                              onFocus={e => { e.target.style.borderColor = C.accent; }}
                              onBlur={e => { e.target.style.borderColor = C.border; }}
                            />
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {askError && (
                    <div style={{
                      marginTop: 8, padding: "8px 12px",
                      background: "#FEF2F2", borderRadius: 8,
                      fontSize: 13, color: "#DC2626", fontFamily: FONT,
                    }}>
                      {askError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={handleAskCancel}
                      disabled={draftingLoading}
                      style={{
                        padding: "8px 14px", background: "#F5F5F4",
                        color: C.sub, border: `1px solid ${C.border}`,
                        borderRadius: 8, fontSize: 13, fontWeight: 600,
                        fontFamily: FONT, cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    {draftingLoading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px" }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: C.accent, animation: "pulse 1.2s infinite",
                        }} />
                        <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>
                          Drafting message...
                        </span>
                        <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }`}</style>
                      </div>
                    ) : (
                      <button
                        onClick={handleDraftAsk}
                        disabled={!askQuestion.trim() || (data?.degree >= 2 && knowsThem === null)}
                        style={{
                          padding: "8px 16px",
                          background: (askQuestion.trim() && !(data?.degree >= 2 && knowsThem === null)) ? C.accent : "#C7D2FE",
                          color: "#fff", border: "none", borderRadius: 8,
                          fontSize: 13, fontWeight: 600, fontFamily: FONT,
                          cursor: (askQuestion.trim() && !(data?.degree >= 2 && knowsThem === null)) ? "pointer" : "not-allowed",
                          transition: "background 0.15s",
                        }}
                      >
                        Draft email for review
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Quick Ask draft panel */}
              {askOpen && drafts && (
                <div style={{ marginBottom: 16 }}>
                  <QuickAskDraftPanel
                    drafts={drafts}
                    setDrafts={setDrafts}
                    askId={askId}
                    onDone={handleAskDone}
                    onCancel={handleAskCancel}
                    replyContext={replyContext}
                  />
                </div>
              )}

              {/* Profile edit form (inline, replaces hero area visually) */}
              {editingProfile && (
                <ProfileEditForm
                  person={person}
                  onSave={(updated) => {
                    setData(prev => ({
                      ...prev,
                      person: {
                        ...prev.person,
                        name: updated.name,
                        linkedin_url: updated.linkedin_url,
                        email: updated.email,
                      },
                    }));
                    setEditingProfile(false);
                  }}
                  onCancel={() => setEditingProfile(false)}
                />
              )}

              {/* AI Summary */}
              {editingSummary ? (
                <SummaryEditForm
                  summary={data.ai_summary}
                  personId={person.id}
                  onSave={(newSummary) => {
                    setData(prev => ({ ...prev, ai_summary: newSummary }));
                    setEditingSummary(false);
                  }}
                  onCancel={() => setEditingSummary(false)}
                />
              ) : data.ai_summary ? (
                <div style={{
                  background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
                  border: `1px solid ${C.border}`, marginBottom: 16,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 8,
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: C.sub,
                      textTransform: "uppercase", letterSpacing: 0.5,
                    }}>
                      Professional Summary
                    </div>
                    {data.is_self && (
                      <button
                        onClick={() => setEditingSummary(true)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 12, fontWeight: 600, color: C.sub, fontFamily: FONT,
                          padding: "2px 6px", borderRadius: 4,
                        }}
                      >
                        <PencilIcon size={11} /> Edit
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.7, color: C.ink, margin: 0, fontFamily: FONT }}>
                    {data.ai_summary}
                  </p>
                </div>
              ) : null}

              {/* Career History */}
              {data.employment_history && data.employment_history.length > 0 && (
                <div style={{
                  background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
                  border: `1px solid ${C.border}`, marginBottom: 16,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: C.sub,
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12,
                  }}>
                    Career History
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {data.employment_history.map((job, i) => {
                      const startYear = job.start_date ? new Date(job.start_date).getFullYear() : null;
                      const endYear = job.is_current ? "Present" : (job.end_date ? new Date(job.end_date).getFullYear() : null);
                      const dateStr = startYear ? `${startYear} – ${endYear || "?"}` : "";

                      return (
                        <div key={i} style={{
                          display: "flex", gap: 12, padding: "10px 0",
                          borderTop: i > 0 ? `1px solid #F3F4F6` : "none",
                        }}>
                          <div style={{ paddingTop: 2 }}>
                            <BriefcaseIcon />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
                              {job.title || "Role"}
                            </div>
                            <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT }}>
                              {job.organization}
                            </div>
                            {dateStr && (
                              <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: FONT, marginTop: 2 }}>
                                {dateStr}
                              </div>
                            )}
                          </div>
                          {job.is_current && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, color: C.success,
                              background: C.successLight, padding: "2px 6px",
                              borderRadius: 4, alignSelf: "flex-start", marginTop: 2,
                            }}>
                              Current
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Web Mentions */}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
