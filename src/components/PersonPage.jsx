import { useState, useEffect, useRef } from "react";
import { capture, identify } from "../lib/posthog.js";
import { gradientForName, initialsForName } from "../lib/avatar.js";
import QuickAskDraftPanel from "./QuickAskDraftPanel.jsx";
import ThreadDraftPanel from "./ThreadDraftPanel.jsx";

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

const GIVE_TYPES = [
  { key: "talent_recommendations", label: "Talent recommendations" },
  { key: "reference_checks", label: "Reference checks" },
  { key: "informational_interviews", label: "Brief informational interviews about my role or career" },
  { key: "experience_advice", label: "Advice based on my experience" },
  { key: "gut_checks", label: "Gut-checks / sounding board conversations" },
  { key: "candid_feedback", label: "Candid feedback" },
  { key: "introductions", label: "Introductions" },
  { key: "resume_reviews", label: "Resume reviews" },
  { key: "referrals", label: "Referrals" },
];

const ASK_DEGREE_OPTIONS = [
  { value: "network", label: "Anyone in my network" },
  { value: "1st", label: "Only people I vouched for" },
];



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

// ── Recommendation path visualization ─────────────────────────────────

function PathAvatar({ name, photoUrl, size = 24 }) {
  const [err, setErr] = useState(false);
  const isPlaceholder = photoUrl && photoUrl.includes("static.licdn.com");
  if (photoUrl && !err && !isPlaceholder) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setErr(true)}
        style={{
          width: size, height: size, borderRadius: size * 0.3,
          objectFit: "cover", flexShrink: 0,
        }}
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

function RecommendationPath({
  path, personFirstName, userOverlap,
  noteText, noteEditing, noteSaving,
  onNoteChange, onNoteEdit, onNoteSave, onNoteCancel,
}) {
  if (!path || path.length < 2) return null;

  return (
    <div style={{
      background: "#FAFAF9", border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "10px 14px", marginBottom: 16,
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: C.sub,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14,
      }}>
        You & {personFirstName}
      </div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.sub,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
      }}>
        Recommendation Pathway
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {path.map((node, i) => {
          const isFirst = i === 0;
          const isLast = i === path.length - 1;
          const prev = i > 0 ? path[i - 1] : null;

          return (
            <div key={node.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {prev && (() => {
                const forward = prev.recommends_next;
                const reverse = prev.recommended_by_next;
                // Arrow direction: forward vouch = →, reverse vouch = ←, fallback = →
                const pointsLeft = !forward && reverse;
                return (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points={pointsLeft ? "15 6 9 12 15 18" : "9 6 15 12 9 18"} />
                  </svg>
                );
              })()}
              {(!isFirst && !isLast) ? (
                <a href={`/person/${node.id}`} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  textDecoration: "none", cursor: "pointer",
                }}>
                  <PathAvatar name={node.name} photoUrl={node.photo_url} size={24} />
                  <span style={{
                    fontSize: 12, fontWeight: 400,
                    color: C.accent, fontFamily: FONT,
                  }}>
                    {node.name.split(" ")[0]}
                  </span>
                </a>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <PathAvatar name={node.name} photoUrl={node.photo_url} size={24} />
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: C.ink, fontFamily: FONT,
                  }}>
                    {isFirst ? "You" : node.name.split(" ")[0]}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {userOverlap?.length > 0 && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: C.sub,
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
          }}>
            Career Overlap
          </div>
          {userOverlap.map((overlap, i) => (
            <div key={i} style={{
              fontSize: 12, color: C.ink, fontFamily: FONT, lineHeight: 1.6,
            }}>
              {overlap.organization} · {formatOverlapDate(overlap.overlap_start)} – {formatOverlapDate(overlap.overlap_end)}
            </div>
          ))}
        </div>
      )}
      {/* Private Note */}
      <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: C.sub,
          textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>Private Note <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(only viewable by you)</span></span>
          {!noteEditing && noteText && (
            <button
              onClick={onNoteEdit}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, color: C.accent, fontWeight: 600, padding: 0,
                fontFamily: FONT, textTransform: "none", letterSpacing: 0,
              }}
            >
              Edit
            </button>
          )}
        </div>
        {noteEditing ? (
          <div>
            <textarea
              value={noteText}
              onChange={e => onNoteChange(e.target.value)}
              placeholder={`Add a private note about ${personFirstName}...`}
              rows={3}
              autoFocus
              style={{
                width: "100%", padding: "8px 10px",
                fontSize: 13, fontFamily: FONT, color: C.ink,
                background: "#fff", border: `1.5px solid ${C.border}`,
                borderRadius: 6, resize: "vertical", lineHeight: 1.5,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
              <button
                onClick={onNoteCancel}
                style={{
                  padding: "4px 10px", fontSize: 11, fontWeight: 600,
                  background: "none", border: `1px solid ${C.border}`,
                  borderRadius: 5, cursor: "pointer", color: C.sub, fontFamily: FONT,
                }}
              >
                Cancel
              </button>
              <button
                onClick={onNoteSave}
                disabled={noteSaving}
                style={{
                  padding: "4px 10px", fontSize: 11, fontWeight: 600,
                  background: C.accent, border: "none",
                  borderRadius: 5, cursor: "pointer", color: "#fff", fontFamily: FONT,
                  opacity: noteSaving ? 0.6 : 1,
                }}
              >
                {noteSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : noteText ? (
          <div style={{
            fontSize: 12, color: C.ink, fontFamily: FONT, lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}>
            {noteText}
          </div>
        ) : (
          <button
            onClick={onNoteEdit}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: C.sub, fontFamily: FONT, padding: 0,
              fontStyle: "italic",
            }}
          >
            + Add a private note about {personFirstName}
          </button>
        )}
      </div>
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

// ── Preferences Form ──────────────────────────────────────────────────

function PreferencesForm({ person, onSave, onCancel }) {
  // Server returns the effective ask degree (never null — defaults resolved server-side)
  const [askDegree, setAskDegree] = useState(person.ask_receive_degree || "network");
  const [askAllowOverlap, setAskAllowOverlap] = useState(person.ask_allow_career_overlap !== false);
  const [gives, setGives] = useState(new Set(person.gives || []));
  const [freeText, setFreeText] = useState(person.gives_free_text || "");
  // Per-section save indicators: "saving" | "saved" | "error" | null
  const [askSaveStatus, setAskSaveStatus] = useState(null);
  const [givesSaveStatus, setGivesSaveStatus] = useState(null);

  async function autoSave(overrides = {}, section = "asks") {
    const payload = {
      type: "preferences",
      ask_receive_degree: overrides.askDegree ?? askDegree,
      ask_allow_career_overlap: overrides.askAllowOverlap ?? askAllowOverlap,
      gives: overrides.gives ? [...overrides.gives] : [...gives],
      gives_free_text: (overrides.freeText ?? freeText).trim() || null,
    };
    const setStatus = section === "asks" ? setAskSaveStatus : setGivesSaveStatus;
    setStatus("saving");
    try {
      const res = await fetch(`/api/person/${person.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      capture("preferences_saved", {
        ask_receive_degree: payload.ask_receive_degree,
        gives_count: payload.gives.length,
        has_free_text: !!payload.gives_free_text,
      });
      setStatus("saved");
      setTimeout(() => setStatus(null), 2000);
    } catch {
      setStatus("error");
    }
  }

  function handleAskDegreeChange(value) {
    setAskDegree(value);
    autoSave({ askDegree: value }, "asks");
  }

  function handleToggleGive(key) {
    setGives(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      autoSave({ gives: next }, "gives");
      return next;
    });
  }

  function handleFreeTextBlur() {
    // Only save on blur if text actually changed from server value
    if (freeText.trim() !== (person.gives_free_text || "").trim()) {
      autoSave({ freeText }, "gives");
    }
  }

  const radioStyle = (isSelected) => ({
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 12px", borderRadius: 8, cursor: "pointer",
    background: isSelected ? C.accentLight : "transparent",
    border: `1.5px solid ${isSelected ? C.accent : "transparent"}`,
    transition: "all 0.15s",
  });

  const checkboxOuterStyle = (isChecked) => ({
    display: "flex", alignItems: "flex-start", gap: 8,
    padding: "6px 10px", borderRadius: 6, cursor: "pointer",
    background: isChecked ? C.accentLight : "transparent",
    transition: "all 0.15s",
  });

  const checkboxStyle = (isChecked) => ({
    width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
    border: `1.5px solid ${isChecked ? C.accent : C.border}`,
    background: isChecked ? C.accent : "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 0.15s",
  });

  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
      border: `1.5px solid ${C.accent}`, marginBottom: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: C.accent,
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          Gives & Asks Preferences
        </div>
      </div>

      <div style={{
        fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.6,
        marginBottom: 16, padding: "10px 12px",
        background: "#FAFAF9", borderRadius: 8, border: `1px solid ${C.border}`,
      }}>
        Gives and Asks enable you to easily support and build relationships with
        your network. Member-to-Member messages convey the recommendation pathway
        through which you are connected and are made directly, avoiding the need
        for intermediary relationships to act as gatekeepers or relays. Messages
        are routed through VouchFour — your email address will never be shared.
        You decide who is able to contact you.
      </div>

      {/* Ask Degree Preference */}
      <div style={{ marginBottom: 18 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 8,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: C.ink,
            fontFamily: FONT,
          }}>
            Who are you open to receiving Asks from?
          </div>
          {askSaveStatus && (
            <span style={{
              fontSize: 11, fontWeight: 600, fontFamily: FONT,
              color: askSaveStatus === "error" ? "#DC2626" : askSaveStatus === "saved" ? C.success : C.sub,
              transition: "opacity 0.3s",
            }}>
              {askSaveStatus === "saving" ? "Saving..." : askSaveStatus === "saved" ? "Saved ✓" : "Save failed"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {ASK_DEGREE_OPTIONS.map(opt => (
            <div
              key={opt.value}
              onClick={() => handleAskDegreeChange(opt.value)}
              style={radioStyle(askDegree === opt.value)}
            >
              <div style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                border: `2px solid ${askDegree === opt.value ? C.accent : C.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}>
                {askDegree === opt.value && (
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: C.accent,
                  }} />
                )}
              </div>
              <span style={{
                fontSize: 13, color: C.ink, fontFamily: FONT,
              }}>
                {opt.label}
              </span>
            </div>
          ))}
        </div>
        {/* Career overlap toggle */}
        <div
          onClick={() => {
            const next = !askAllowOverlap;
            setAskAllowOverlap(next);
            autoSave({ askAllowOverlap: next }, "asks");
          }}
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "8px 12px", borderRadius: 8, cursor: "pointer",
            marginTop: 6,
            background: askAllowOverlap ? C.accentLight : "transparent",
            border: `1.5px solid ${askAllowOverlap ? C.accent : "transparent"}`,
            transition: "all 0.15s",
          }}
        >
          <div style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
            border: `1.5px solid ${askAllowOverlap ? C.accent : C.border}`,
            background: askAllowOverlap ? C.accent : "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}>
            {askAllowOverlap && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <span style={{ fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.4 }}>
            Also allow former colleagues (people I've worked with at the same company)
          </span>
        </div>
      </div>

      {/* Gives Multiselect */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 8,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: C.ink,
            fontFamily: FONT,
          }}>
            What are you open to Giving to your network?
          </div>
          {givesSaveStatus && (
            <span style={{
              fontSize: 11, fontWeight: 600, fontFamily: FONT,
              color: givesSaveStatus === "error" ? "#DC2626" : givesSaveStatus === "saved" ? C.success : C.sub,
              transition: "opacity 0.3s",
            }}>
              {givesSaveStatus === "saving" ? "Saving..." : givesSaveStatus === "saved" ? "Saved ✓" : "Save failed"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {GIVE_TYPES.map(g => (
            <div
              key={g.key}
              onClick={() => handleToggleGive(g.key)}
              style={checkboxOuterStyle(gives.has(g.key))}
            >
              <div style={checkboxStyle(gives.has(g.key))}>
                {gives.has(g.key) && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span style={{
                fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.4,
              }}>
                {g.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Free text */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: C.ink,
          fontFamily: FONT, marginBottom: 6,
        }}>
          Anything else you're happy to help with?
        </div>
        <textarea
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          onBlur={handleFreeTextBlur}
          placeholder="e.g. Happy to chat about building developer tools, transitioning into product management..."
          rows={2}
          style={{
            width: "100%", padding: "8px 12px",
            fontSize: 14, fontFamily: FONT, color: C.ink,
            background: "#fff", border: `1.5px solid ${C.border}`,
            borderRadius: 8, resize: "vertical", lineHeight: 1.5,
            boxSizing: "border-box", WebkitAppearance: "none",
          }}
        />
      </div>

      <button
        onClick={onCancel}
        style={{
          padding: "8px 18px", background: "#F5F5F4", color: C.sub,
          border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13,
          fontWeight: 600, fontFamily: FONT, cursor: "pointer",
        }}
      >
        Done
      </button>
    </div>
  );
}

// ── Career History Edit Form ──────────────────────────────────────────

function CareerHistoryEditForm({ person, employmentHistory, onSave, onCancel }) {
  const [roles, setRoles] = useState(() => {
    if (employmentHistory && employmentHistory.length > 0) {
      return employmentHistory.map(job => ({
        title: job.title || "",
        organization: job.organization || "",
        start_date: job.start_date ? job.start_date.substring(0, 7) : "", // YYYY-MM
        end_date: job.end_date ? job.end_date.substring(0, 7) : "",
        is_current: job.is_current || false,
        location: job.location || "",
        description: job.description || "",
      }));
    }
    return [];
  });
  const [linkedinText, setLinkedinText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [parseSuccess, setParseSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [showRegenPrompt, setShowRegenPrompt] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [savedRoles, setSavedRoles] = useState(null); // stash roles after save for regen flow

  const slug = person.linkedin_url?.match(/\/in\/([^/]+)/)?.[1];
  const experienceUrl = slug ? `https://www.linkedin.com/in/${slug}/details/experience/` : null;

  async function handleParse() {
    if (!linkedinText.trim()) return;
    setParsing(true);
    setParseError(null);
    setParseSuccess(false);
    try {
      const res = await fetch("/api/parse-linkedin-experience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: linkedinText.trim() }),
      });
      const data = await res.json();
      if (data.roles && data.roles.length > 0) {
        // Convert dates from YYYY-MM-DD to YYYY-MM for month inputs
        setRoles(data.roles.map(r => ({
          title: r.title || "",
          organization: r.organization || "",
          start_date: r.start_date ? r.start_date.substring(0, 7) : "",
          end_date: r.end_date ? r.end_date.substring(0, 7) : "",
          is_current: r.is_current || false,
          location: r.location || "",
          description: r.description || "",
        })));
        capture("linkedin_text_parsed", { role_count: data.roles.length });
        setParseSuccess(true);
      } else {
        setParseError(data.error || "No roles found in the pasted text.");
      }
    } catch {
      setParseError("Failed to parse. Please try again.");
    } finally {
      setParsing(false);
    }
  }

  function updateRole(index, field, value) {
    setRoles(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function removeRole(index) {
    setRoles(prev => prev.filter((_, i) => i !== index));
  }

  const newRoleRef = useRef(null);

  function addRole() {
    setRoles(prev => [...prev, {
      title: "", organization: "", start_date: "", end_date: "",
      is_current: false, location: "", description: "",
    }]);
    // Scroll to new role after React renders it
    setTimeout(() => {
      newRoleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  async function handleSave() {
    const valid = roles.filter(r => r.organization?.trim());
    if (valid.length === 0) {
      setSaveError("Add at least one role with a company name.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Convert YYYY-MM to YYYY-MM-01 for DB storage
      const payload = valid.map(r => ({
        ...r,
        start_date: r.start_date ? `${r.start_date}-01` : null,
        end_date: r.is_current ? null : (r.end_date ? `${r.end_date}-01` : null),
      }));
      const res = await fetch(`/api/person/${person.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "employment_history", roles: payload }),
      });
      if (!res.ok) throw new Error("Save failed");
      capture("career_history_saved", { role_count: valid.length });
      setSavedRoles(valid);
      setShowRegenPrompt(true);
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch("/api/regenerate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      capture("career_history_summary_regenerated");
      onSave(savedRoles, data.ai_summary || null);
    } catch {
      // If regen fails, still save the roles
      onSave(savedRoles, null);
    }
  }

  function handleSkipRegen() {
    onSave(savedRoles, null);
  }

  const inputStyle = {
    width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: FONT,
    color: C.ink, background: "#fff", border: `1.5px solid ${C.border}`,
    borderRadius: 8, boxSizing: "border-box", WebkitAppearance: "none",
  };

  const labelStyle = {
    fontSize: 11, fontWeight: 600, color: C.sub, fontFamily: FONT,
    marginBottom: 3, display: "block",
  };

  // After save — show regeneration prompt
  if (showRegenPrompt) {
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
          Career History Saved
        </div>
        <div style={{
          fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.6,
          marginBottom: 16,
        }}>
          Your career history has been updated. Would you like to regenerate your AI summary to reflect the changes?
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            style={{
              padding: "8px 16px", background: C.accent, color: "#fff",
              border: "none", borderRadius: 8, fontSize: 13,
              fontWeight: 600, fontFamily: FONT, cursor: regenerating ? "default" : "pointer",
              opacity: regenerating ? 0.7 : 1,
            }}
          >
            {regenerating ? "Regenerating..." : "Regenerate Summary"}
          </button>
          <button
            onClick={handleSkipRegen}
            disabled={regenerating}
            style={{
              padding: "8px 16px", background: "#F5F5F4", color: C.sub,
              border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13,
              fontWeight: 600, fontFamily: FONT, cursor: "pointer",
            }}
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

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
        Edit Career History
      </div>

      {/* LinkedIn paste section */}
      <div style={{
        padding: "12px 14px", marginBottom: 16,
        background: "#FAFAF9", borderRadius: 10, border: `1px solid ${C.border}`,
      }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: FONT,
          marginBottom: 8,
        }}>
          Easy as 1, 2, 3 Way to Update
        </div>
        <ol style={{
          fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.7,
          margin: "0 0 12px 0", paddingLeft: 20,
        }}>
          <li style={{ marginBottom: 4 }}>
            Open your{" "}
            {experienceUrl ? (
              <a
                href={experienceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: C.accent, fontWeight: 600, textDecoration: "none" }}
              >
                LinkedIn Profile
              </a>
            ) : (
              <span style={{ color: C.accent, fontWeight: 600 }}>LinkedIn Profile</span>
            )}
          </li>
          <li style={{ marginBottom: 4 }}>
            Select all of the text and images in the main section of the page and copy-paste it into the box below.
          </li>
          <li>Let Claude do its magic.</li>
        </ol>
        <textarea
          value={linkedinText}
          onChange={e => setLinkedinText(e.target.value)}
          placeholder="Paste your LinkedIn experience section here..."
          rows={5}
          style={{
            ...inputStyle,
            resize: "vertical", lineHeight: 1.5, marginBottom: 8,
          }}
        />
        <button
          onClick={handleParse}
          disabled={parsing || !linkedinText.trim()}
          style={{
            padding: "8px 16px", background: C.accent, color: "#fff",
            border: "none", borderRadius: 8, fontSize: 13,
            fontWeight: 600, fontFamily: FONT,
            cursor: (parsing || !linkedinText.trim()) ? "default" : "pointer",
            opacity: (parsing || !linkedinText.trim()) ? 0.6 : 1,
          }}
        >
          {parsing ? "Parsing..." : "Parse with Claude ✨"}
        </button>
        {parseError && (
          <div style={{
            fontSize: 12, color: "#DC2626", fontFamily: FONT,
            marginTop: 8,
          }}>
            {parseError}
          </div>
        )}
        {parseSuccess && (
          <div style={{
            fontSize: 12, color: C.success, fontFamily: FONT, fontWeight: 600,
            marginTop: 8,
          }}>
            Claude updated your career history below. Please review and then click the Save button at the bottom of the form.
          </div>
        )}
      </div>

      {/* Roles form */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT,
          }}>
            Roles
          </div>
          <button
            onClick={addRole}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "4px 10px", background: "none", color: C.accent,
              border: `1.5px solid ${C.accent}`, borderRadius: 6,
              fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: "pointer",
            }}
          >
            ＋ Add Role
          </button>
        </div>

        {roles.length === 0 && (
          <div style={{
            fontSize: 13, color: C.sub, fontFamily: FONT,
            padding: "20px 0", textAlign: "center",
          }}>
            No roles yet. Paste your LinkedIn experience above or add roles manually.
          </div>
        )}

        {roles.map((role, i) => (
          <div key={i} ref={i === roles.length - 1 ? newRoleRef : undefined} style={{
            padding: "14px 0",
            borderTop: i > 0 ? `1px solid #F3F4F6` : "none",
          }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Title</label>
                <input
                  value={role.title}
                  onChange={e => updateRole(i, "title", e.target.value)}
                  placeholder="e.g. Senior Product Manager"
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Company *</label>
                <input
                  value={role.organization}
                  onChange={e => updateRole(i, "organization", e.target.value)}
                  placeholder="e.g. Acme Corp"
                  style={{
                    ...inputStyle,
                    borderColor: !role.organization.trim() ? "#FCA5A5" : C.border,
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Start</label>
                <input
                  type="month"
                  value={role.start_date}
                  onChange={e => updateRole(i, "start_date", e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>End</label>
                <input
                  type="month"
                  value={role.is_current ? "" : role.end_date}
                  onChange={e => updateRole(i, "end_date", e.target.value)}
                  disabled={role.is_current}
                  style={{
                    ...inputStyle,
                    opacity: role.is_current ? 0.5 : 1,
                  }}
                />
              </div>
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 8,
            }}>
              <div
                onClick={() => updateRole(i, "is_current", !role.is_current)}
                style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  border: `1.5px solid ${role.is_current ? C.accent : C.border}`,
                  background: role.is_current ? C.accent : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {role.is_current && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span
                onClick={() => updateRole(i, "is_current", !role.is_current)}
                style={{
                  fontSize: 12, color: C.ink, fontFamily: FONT, cursor: "pointer",
                }}
              >
                I currently work here
              </span>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Location</label>
              <input
                value={role.location}
                onChange={e => updateRole(i, "location", e.target.value)}
                placeholder="e.g. San Francisco, CA"
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 4 }}>
              <label style={labelStyle}>Description</label>
              <textarea
                value={role.description}
                onChange={e => updateRole(i, "description", e.target.value)}
                placeholder="Key responsibilities, achievements..."
                rows={2}
                style={{
                  ...inputStyle,
                  resize: "vertical", lineHeight: 1.5,
                }}
              />
            </div>
            <button
              onClick={() => removeRole(i)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 600, color: "#DC2626", fontFamily: FONT,
                padding: "4px 0",
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {saveError && (
        <div style={{
          fontSize: 12, color: "#DC2626", fontFamily: FONT, marginBottom: 10,
        }}>
          {saveError}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleSave}
          disabled={saving || roles.filter(r => r.organization?.trim()).length === 0}
          style={{
            padding: "8px 18px", background: C.accent, color: "#fff",
            border: "none", borderRadius: 8, fontSize: 13,
            fontWeight: 600, fontFamily: FONT,
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
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

// ── Career Overlap Widgets ─────────────────────────────────────────────

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Handle both "2010-06-01" and "2010-06-01T04:00:00.000Z"
  return new Date(dateStr.length === 10 ? dateStr + "T00:00:00" : dateStr);
}

function formatOverlapDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return "?";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatRolePeriod(role) {
  const startD = parseDate(role.start_date);
  const start = startD ? startD.getFullYear() : "?";
  const end = role.is_current ? "Present" : (parseDate(role.end_date)?.getFullYear() || "?");
  return `${start}–${end}`;
}

function GivesCard({ gives, givesFreeText, personFirstName, canAsk, askOpen, onAskClick, isSelf, onEditPrefs, conversation }) {
  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
      border: `1px solid ${C.border}`, marginBottom: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: C.sub,
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          Gives & Asks
        </div>
        {isSelf && (
          <button
            onClick={onEditPrefs}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 600, color: C.sub, fontFamily: FONT,
              padding: "2px 6px", borderRadius: 4,
            }}
          >
            <PencilIcon size={11} /> Preferences
          </button>
        )}
      </div>
      {canAsk && !askOpen && (
        <button
          onClick={onAskClick}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", marginBottom: 12,
            background: "#FFFFFF", border: `1.5px solid ${C.border}`,
            borderRadius: 7, fontSize: 12, fontWeight: 600,
            color: C.accent, fontFamily: FONT, cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          Ask {personFirstName}
        </button>
      )}
      {((gives && gives.length > 0) || givesFreeText) ? (
        <ul style={{
          margin: 0, paddingLeft: 18,
          fontSize: 13, color: C.ink, fontFamily: FONT,
          lineHeight: 1.8, listStyleType: "disc",
        }}>
          {(gives || []).map(key => {
            const gt = GIVE_TYPES.find(g => g.key === key);
            return <li key={key}>{gt ? gt.label : key}</li>;
          })}
          {givesFreeText && <li>{givesFreeText}</li>}
        </ul>
      ) : isSelf ? (
        <div
          onClick={onEditPrefs}
          style={{
            background: "#F9FAFB", borderRadius: 10, padding: "14px 16px",
            border: `1.5px dashed ${C.border}`, cursor: "pointer",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 4 }}>
            What can you offer your network?
          </div>
          <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.5 }}>
            Let people know what you're open to — intros, advice, mentorship, and more. Tap to set your Gives.
          </div>
        </div>
      ) : null}

      {/* Conversation — most recent 1:1 thread with this person */}
      {conversation && !isSelf && (
        <a
          href={`/thread/${conversation.access_token}`}
          style={{
            display: "block", marginTop: 12, padding: "12px 14px",
            background: "#F8F7F6", borderRadius: 10,
            border: `1px solid ${C.border}`,
            textDecoration: "none", color: "inherit",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, fontFamily: FONT }}>
              View conversation
            </span>
            <span style={{ fontSize: 11, color: C.sub, fontFamily: FONT, marginLeft: "auto" }}>
              {conversation.message_count} message{conversation.message_count !== 1 ? "s" : ""}
            </span>
          </div>
          {conversation.last_message_body && (
            <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: C.ink }}>
                {conversation.last_message_author?.split(" ")[0]}:
              </span>{" "}
              {conversation.last_message_body}
            </div>
          )}
        </a>
      )}
    </div>
  );
}

function NetworkOverlapWidget({ networkOverlap, personFirstName }) {
  // Filter to 1st & 2nd degree only, then drop empty groups
  const filtered = (networkOverlap || [])
    .map(group => ({ ...group, people: group.people.filter(p => p.degree <= 2) }))
    .filter(group => group.people.length > 0);
  if (!filtered.length) return null;
  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
      border: `1px solid ${C.border}`, marginBottom: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: C.sub,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12,
      }}>
        Your Network at {personFirstName}'s Companies
      </div>
      {filtered.map((group, i) => (
        <div key={i} style={{
          ...(i > 0 ? { borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 12 } : {}),
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 8 }}>
            {group.organization}
          </div>
          {group.people.map(person => (
            <div key={person.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 6, cursor: "pointer",
            }} onClick={() => { window.location.href = `/person/${person.id}`; }}>
              <PhotoAvatar name={person.name} photoUrl={person.photo_url} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
                  {person.name}
                </span>
                {person.title_at_org && (
                  <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 1 }}>
                    {person.title_at_org}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Main PersonPage ────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

export default function PersonPage() {
  const personId = Number(window.location.pathname.split("/person/")[1]) || 0;
  const isMobile = useIsMobile();

  const [authState, setAuthState] = useState("checking");
  const [authSlug, setAuthSlug] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editingPreferences, setEditingPreferences] = useState(false);
  const [editingCareerHistory, setEditingCareerHistory] = useState(false);
  const prefsRef = useRef(null);

  useEffect(() => {
    if (editingPreferences && prefsRef.current) {
      prefsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [editingPreferences]);

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
  const [hasVouched, setHasVouched] = useState(true); // default true to hide nudge until loaded
  const [askJustCompleted, setAskJustCompleted] = useState(false);
  const [myThreads, setMyThreads] = useState(null); // fetched for self-view only
  const [showThreads, setShowThreads] = useState(false);
  const [showAllThreads, setShowAllThreads] = useState(false);
  // New thread creation from profile
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState([]);
  const [threadTopic, setThreadTopic] = useState("");
  const [threadDraftLoading, setThreadDraftLoading] = useState(false);
  const [threadDraft, setThreadDraft] = useState(null); // { threadId, creatorToken, topic, draftBody, participants }
  const [overlapData, setOverlapData] = useState(null);
  const hasCareerOverlap = overlapData?.user_overlap?.length > 0;
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);

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
            if (d.user.has_vouched !== undefined) setHasVouched(d.user.has_vouched);
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
            if (d.user.has_vouched !== undefined) setHasVouched(d.user.has_vouched);
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

  // Fetch user's threads for self-view
  useEffect(() => {
    if (!data?.is_self) return;
    fetch("/api/my-threads", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(d => { if (d) setMyThreads(d.threads); })
      .catch(() => {});
  }, [data?.is_self]);

  // Fetch career overlap data (not for self-view)
  useEffect(() => {
    if (!data || data.is_self) return;
    fetch(`/api/person/${personId}/career-overlap`, { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(d => { if (d) setOverlapData(d); })
      .catch(() => {});
  }, [data?.is_self, personId]);

  // Fetch private note for this person
  useEffect(() => {
    if (!data || data.is_self) return;
    fetch(`/api/person/${personId}/note`, { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        if (d) {
          setNoteText(d.note_text || "");
          setNoteSaved(d.note_text || "");
        }
      })
      .catch(() => {});
  }, [data?.is_self, personId]);

  async function saveNote() {
    const trimmed = noteText.trim();
    console.log("[saveNote]", { trimmed, noteSaved, same: trimmed === noteSaved, personId });
    if (trimmed === noteSaved) { setNoteEditing(false); return; }
    setNoteSaving(true);
    try {
      const res = await fetch(`/api/person/${personId}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ note_text: trimmed }),
      });
      if (res.ok) {
        const d = await res.json();
        setNoteSaved(d.note_text || "");
        setNoteText(d.note_text || "");
      }
    } catch {}
    setNoteSaving(false);
    setNoteEditing(false);
  }

  // Auto-set "knows them" when career overlap exists
  useEffect(() => {
    if (!overlapData?.user_overlap?.length) return;
    if (knowsThem !== null) return; // don't override if user already answered
    const orgs = overlapData.user_overlap.map(o => o.organization).join(", ");
    setKnowsThem(true);
    setKnowsThemHow(`Worked together at ${orgs}`);
  }, [overlapData]);

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
    if (!hasVouched) setAskJustCompleted(true);
  }

  // ── New Thread handlers ──────────────────────────────────────────
  function handleNewThreadCancel() {
    setNewThreadOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedParticipants([]);
    setThreadTopic("");
    setThreadDraft(null);
    setThreadDraftLoading(false);
  }

  function handleNewThreadDone() {
    handleNewThreadCancel();
    // Refresh thread list
    fetch("/api/my-threads", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(d => { if (d) setMyThreads(d.threads); })
      .catch(() => {});
  }

  // Debounced search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/network-search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include" })
        .then(res => res.ok ? res.json() : { results: [] })
        .then(d => {
          // Filter out already-selected people
          const selectedIds = new Set(selectedParticipants.map(p => p.person_id));
          setSearchResults((d.results || []).filter(r => !selectedIds.has(r.person_id)));
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  function handleSelectParticipant(person) {
    setSelectedParticipants(prev => [...prev, person]);
    setSearchQuery("");
    setSearchResults([]);
  }

  function handleRemoveParticipant(personId) {
    setSelectedParticipants(prev => prev.filter(p => p.person_id !== personId));
  }

  async function handleDraftThread() {
    if (selectedParticipants.length < 2 || !threadTopic.trim()) return;
    setThreadDraftLoading(true);
    try {
      const res = await fetch("/api/threads/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: threadTopic.trim(),
          question: threadTopic.trim(),
          recipient_ids: selectedParticipants.map(p => p.person_id),
          recipient_context: {},
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to draft thread");
      setThreadDraft({
        threadId: d.thread_id,
        creatorToken: d.creator_token,
        topic: d.topic,
        draftBody: d.draft_body,
        participants: d.participants,
      });
      capture("thread_drafted_from_profile", { participant_count: selectedParticipants.length });
    } catch (err) {
      alert(err.message);
    } finally {
      setThreadDraftLoading(false);
    }
  }

  const person = data?.person;
  const subtitle = [person?.current_title, person?.current_company].filter(Boolean).join(" at ");
  const canAsk = data?.can_ask;
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
        zIndex: 100, width: "100%",
        background: "#FFFFFF", padding: "12px 20px",
      }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
      </div>

      {/* Main content */}
      <div style={{
        width: "100%",
        background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
        padding: "0 16px 80px", margin: "52px 0 0",
        minHeight: "calc(100vh - 52px)",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%", padding: "0 8px" }}>

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
                    <h1 style={{ fontSize: 20, fontWeight: 800, color: C.ink, margin: 0, fontFamily: FONT }}>
                      {person.name}
                    </h1>
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

                {/* Action buttons (self-view only) */}
                {data.is_self && !editingProfile && !editingPreferences && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                  </div>
                )}
              </div>

              {/* ── Layout: two-column (desktop) / flat (mobile) ── */}
              {isMobile ? (
                /* ── MOBILE: flat list, custom card order ── */
                <div>

                  {/* You & Name */}
                  {!data.is_self && (
                    <RecommendationPath
                      path={data.vouch_path}
                      personFirstName={personFirstName}
                      userOverlap={overlapData?.user_overlap}
                      noteText={noteText}
                      noteEditing={noteEditing}
                      noteSaving={noteSaving}
                      onNoteChange={setNoteText}
                      onNoteEdit={() => setNoteEditing(true)}
                      onNoteSave={saveNote}
                      onNoteCancel={() => { setNoteText(noteSaved); setNoteEditing(false); }}
                    />
                  )}

                  {/* Threads card */}
                  {data.is_self && myThreads && (
                    <div style={{
                      background: "#FFFFFF", borderRadius: 14,
                      padding: "16px 18px", marginBottom: 16,
                      border: `1px solid ${C.border}`,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}>
                      {/* Header with + button */}
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginBottom: 12,
                      }}>
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: C.sub, fontFamily: FONT,
                          textTransform: "uppercase", letterSpacing: 0.5,
                        }}>
                          Group Threads
                        </div>
                        {!newThreadOpen && !threadDraft && (
                          <button
                            onClick={() => setNewThreadOpen(true)}
                            title="New thread"
                            style={{
                              width: 26, height: 26, borderRadius: 7,
                              background: "#F5F3FF", border: "1px solid #C4B5FD",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: "pointer", transition: "all 0.15s",
                              padding: 0,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#EDE9FE"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#F5F3FF"; }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                          </button>
                        )}
                      </div>

                      {/* New thread creation panel */}
                      {newThreadOpen && !threadDraft && (
                        <div style={{
                          background: "#FAFAF9", borderRadius: 12,
                          border: `1.5px solid ${C.accent}`, padding: "14px 16px",
                          marginBottom: myThreads.length > 0 ? 12 : 0,
                        }}>
                          <div style={{
                            fontSize: 11, fontWeight: 700, color: C.accent,
                            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
                          }}>
                            New Thread
                          </div>

                          {selectedParticipants.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                              {selectedParticipants.map(p => (
                                <div key={p.person_id} style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  padding: "4px 8px 4px 4px",
                                  background: "#EEF2FF", border: "1px solid #A5B4FC",
                                  borderRadius: 20, fontSize: 12, fontWeight: 500,
                                  color: C.ink, fontFamily: FONT,
                                }}>
                                  <PhotoAvatar name={p.display_name} photoUrl={p.photo_url} size={20} />
                                  <span>{p.display_name.split(" ")[0]}</span>
                                  <button
                                    onClick={() => handleRemoveParticipant(p.person_id)}
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      padding: "0 2px", color: C.sub, fontSize: 14, lineHeight: 1,
                                      display: "flex", alignItems: "center",
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ position: "relative", marginBottom: 10 }}>
                            <input
                              value={searchQuery}
                              onChange={e => setSearchQuery(e.target.value)}
                              placeholder="Search your network to add people..."
                              autoFocus
                              style={{
                                width: "100%", padding: "8px 10px",
                                fontSize: 14, fontFamily: FONT, color: C.ink,
                                background: "#fff", border: `1.5px solid ${C.border}`,
                                borderRadius: 8, boxSizing: "border-box",
                                WebkitAppearance: "none",
                                transition: "border-color 0.15s",
                              }}
                              onFocus={e => { e.target.style.borderColor = C.accent; }}
                              onBlur={e => { setTimeout(() => { e.target.style.borderColor = C.border; }, 150); }}
                            />
                            {searchQuery.length >= 2 && (searchResults.length > 0 || searchLoading) && (
                              <div style={{
                                position: "absolute", top: "100%", left: 0, right: 0,
                                background: "#fff", border: `1px solid ${C.border}`,
                                borderRadius: 8, marginTop: 4, zIndex: 10,
                                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                                maxHeight: 200, overflowY: "auto",
                              }}>
                                {searchLoading && searchResults.length === 0 ? (
                                  <div style={{ padding: "10px 12px", fontSize: 13, color: C.sub, fontFamily: FONT }}>
                                    Searching...
                                  </div>
                                ) : searchResults.map(r => (
                                  <button
                                    key={r.person_id}
                                    onMouseDown={(e) => { e.preventDefault(); handleSelectParticipant(r); }}
                                    style={{
                                      display: "flex", alignItems: "center", gap: 8,
                                      width: "100%", padding: "8px 12px",
                                      background: "none", border: "none", cursor: "pointer",
                                      fontFamily: FONT, textAlign: "left",
                                      transition: "background 0.1s",
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "#F5F3FF"; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                                  >
                                    <PhotoAvatar name={r.display_name} photoUrl={r.photo_url} size={28} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                                        {r.display_name}
                                      </div>
                                      {(r.current_title || r.current_company) && (
                                        <div style={{ fontSize: 11, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {[r.current_title, r.current_company].filter(Boolean).join(" at ")}
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                            {searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && (
                              <div style={{
                                position: "absolute", top: "100%", left: 0, right: 0,
                                background: "#fff", border: `1px solid ${C.border}`,
                                borderRadius: 8, marginTop: 4, zIndex: 10,
                                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                                padding: "10px 12px", fontSize: 13, color: C.sub, fontFamily: FONT,
                              }}>
                                No results — only people open to chat are shown
                              </div>
                            )}
                          </div>

                          {selectedParticipants.length >= 2 && (
                            <div style={{ marginBottom: 10 }}>
                              <input
                                value={threadTopic}
                                onChange={e => setThreadTopic(e.target.value)}
                                placeholder="What's this thread about?"
                                style={{
                                  width: "100%", padding: "8px 10px",
                                  fontSize: 14, fontFamily: FONT, color: C.ink,
                                  background: "#fff", border: `1.5px solid ${C.border}`,
                                  borderRadius: 8, boxSizing: "border-box",
                                  WebkitAppearance: "none",
                                  transition: "border-color 0.15s",
                                }}
                                onFocus={e => { e.target.style.borderColor = C.accent; }}
                                onBlur={e => { e.target.style.borderColor = C.border; }}
                              />
                            </div>
                          )}

                          {selectedParticipants.length < 2 && (
                            <p style={{ fontSize: 12, color: C.sub, fontFamily: FONT, margin: 0, lineHeight: 1.5 }}>
                              Add at least 2 people to start a group thread.
                            </p>
                          )}

                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                            <button
                              onClick={handleNewThreadCancel}
                              style={{
                                padding: "7px 14px", background: "#F5F5F4",
                                color: C.sub, border: `1px solid ${C.border}`,
                                borderRadius: 8, fontSize: 13, fontWeight: 600,
                                fontFamily: FONT, cursor: "pointer",
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleDraftThread}
                              disabled={selectedParticipants.length < 2 || !threadTopic.trim() || threadDraftLoading}
                              style={{
                                padding: "7px 14px",
                                background: (selectedParticipants.length < 2 || !threadTopic.trim() || threadDraftLoading) ? "#C7D2FE" : C.accent,
                                color: "#fff", border: "none", borderRadius: 8,
                                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                                cursor: (selectedParticipants.length < 2 || !threadTopic.trim() || threadDraftLoading) ? "not-allowed" : "pointer",
                                transition: "background 0.15s",
                              }}
                            >
                              {threadDraftLoading ? "Drafting..." : "Draft outreach"}
                            </button>
                          </div>
                        </div>
                      )}

                      {threadDraft && (
                        <div style={{ marginBottom: myThreads.length > 0 ? 12 : 0 }}>
                          <ThreadDraftPanel
                            threadId={threadDraft.threadId}
                            creatorToken={threadDraft.creatorToken}
                            topic={threadDraft.topic}
                            draftBody={threadDraft.draftBody}
                            participants={threadDraft.participants}
                            onDone={handleNewThreadDone}
                            onCancel={handleNewThreadCancel}
                          />
                        </div>
                      )}

                      {myThreads.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {(showAllThreads ? myThreads : myThreads.slice(0, 3)).map(t => (
                            <a
                              key={t.thread_id}
                              href={`/thread/${t.access_token}`}
                              style={{
                                display: "block", textDecoration: "none",
                                padding: "10px 14px",
                                background: "#FAFAF9", borderRadius: 10,
                                border: `1px solid ${C.border}`,
                                transition: "border-color 0.15s, box-shadow 0.15s",
                                cursor: "pointer",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.boxShadow = "0 2px 8px rgba(79,70,229,0.1)"; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                                <span style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
                                  {t.topic}
                                </span>
                                <span style={{ fontSize: 11, color: C.sub, fontFamily: FONT, marginLeft: "auto", flexShrink: 0 }}>
                                  {t.participant_count} people
                                </span>
                              </div>
                              {t.last_message_preview && (
                                <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.4 }}>
                                  <strong style={{ color: C.ink, fontWeight: 500 }}>{t.last_message_author?.split(" ")[0]}:</strong>{" "}
                                  {t.last_message_preview}
                                </div>
                              )}
                            </a>
                          ))}
                          {!showAllThreads && myThreads.length > 3 && (
                            <button
                              onClick={() => setShowAllThreads(true)}
                              style={{
                                background: "none", border: "none", cursor: "pointer",
                                fontSize: 13, color: C.accent, fontFamily: FONT,
                                padding: "4px 0", textAlign: "center",
                              }}
                            >
                              See {myThreads.length - 3} more →
                            </button>
                          )}
                        </div>
                      )}

                      {myThreads.length === 0 && !newThreadOpen && !threadDraft && (
                        <div style={{
                          textAlign: "center", padding: "12px 0",
                          fontSize: 13, color: C.sub, fontFamily: FONT,
                        }}>
                          No threads yet — tap + to start one
                        </div>
                      )}
                    </div>
                  )}

                  {/* Gives card */}
                  {(data.is_self || canAsk || (person.gives && person.gives.length > 0) || person.gives_free_text || data.conversation) && (
                    <GivesCard gives={person.gives} givesFreeText={person.gives_free_text} personFirstName={personFirstName} canAsk={canAsk} askOpen={askOpen} onAskClick={() => setAskOpen(true)} isSelf={data.is_self} onEditPrefs={() => { setEditingPreferences(true); capture("preferences_opened"); }} conversation={data.conversation} />
                  )}

                  {/* Left column content */}

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
                      {!replyContext && data?.degree >= 2 && !hasCareerOverlap && (() => {
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

                  {/* Post-Quick-Ask vouch nudge */}
                  {askJustCompleted && !hasVouched && (
                    <div style={{
                      background: "linear-gradient(135deg, #FEF3C7 0%, #ECFDF5 100%)",
                      border: `1.5px solid #FDE68A`, borderRadius: 12,
                      padding: "16px 18px", marginBottom: 16,
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 4 }}>
                        {(() => {
                          const invName = sessionStorage.getItem("vouchfour_inviterName");
                          const first = invName?.split(" ")[0];
                          return first
                            ? `Remember how it felt when ${first} recommended you? You can do that for someone.`
                            : "Someone believed in you enough to recommend you. You can do that for someone too.";
                        })()}
                      </div>
                      <a
                        href={(() => {
                          const t = sessionStorage.getItem("vouchfour_vouchToken");
                          return t ? `/vouch?token=${t}` : "/start-vouch";
                        })()}
                        style={{
                          display: "inline-block", padding: "10px 20px", marginTop: 6,
                          background: C.accent, color: "#fff", borderRadius: 8,
                          fontSize: 13, fontWeight: 600, textDecoration: "none", fontFamily: FONT,
                        }}
                      >
                        Vouch for your top 4 →
                      </a>
                      <button
                        onClick={() => setAskJustCompleted(false)}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 12, color: C.sub, fontFamily: FONT, marginLeft: 12,
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {/* Profile edit form */}
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

                  {/* Preferences form */}
                  {editingPreferences && (
                    <div ref={prefsRef}>
                      <PreferencesForm
                        person={person}
                        hasVouched={hasVouched}
                        onSave={() => {}}
                        onCancel={() => {
                          fetch(`/api/person/${personId}`, { credentials: "include" })
                            .then(res => res.ok ? res.json() : null)
                            .then(d => { if (d) setData(d); });
                          setEditingPreferences(false);
                        }}
                      />
                    </div>
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
                          fontSize: 12, fontWeight: 700, color: C.sub,
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
                  {editingCareerHistory ? (
                    <CareerHistoryEditForm
                      person={person}
                      employmentHistory={data.employment_history}
                      onSave={(newRoles, newSummary) => {
                        const mapped = newRoles.map(r => ({
                          title: r.title,
                          organization: r.organization,
                          start_date: r.start_date ? `${r.start_date}-01` : null,
                          end_date: r.is_current ? null : (r.end_date ? `${r.end_date}-01` : null),
                          is_current: r.is_current,
                          location: r.location,
                          description: r.description,
                        }));
                        setData(prev => ({
                          ...prev,
                          employment_history: mapped,
                          ...(newSummary ? { ai_summary: newSummary } : {}),
                        }));
                        setEditingCareerHistory(false);
                      }}
                      onCancel={() => setEditingCareerHistory(false)}
                    />
                  ) : (data.employment_history?.length > 0 || data.is_self) && (
                    <div style={{
                      background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
                      border: `1px solid ${C.border}`, marginBottom: 16,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginBottom: 12,
                      }}>
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: C.sub,
                          textTransform: "uppercase", letterSpacing: 0.5,
                        }}>
                          Career History
                        </div>
                        {data.is_self ? (
                          <button
                            onClick={() => { setEditingCareerHistory(true); capture("career_history_edit_opened"); }}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              background: "none", border: "none", cursor: "pointer",
                              fontSize: 12, fontWeight: 600, color: C.sub, fontFamily: FONT,
                              padding: "2px 6px", borderRadius: 4,
                            }}
                          >
                            <PencilIcon size={11} /> Edit
                          </button>
                        ) : person.linkedin_url ? (
                          <a
                            href={person.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 12, fontWeight: 600, color: C.sub,
                              fontFamily: FONT, textDecoration: "none",
                            }}
                          >
                            LinkedIn <ExternalLinkIcon size={11} color={C.sub} />
                          </a>
                        ) : null}
                      </div>
                      {data.employment_history?.length > 0 ? (
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
                                  {(dateStr || job.location) && (
                                    <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: FONT, marginTop: 2 }}>
                                      {[dateStr, job.location].filter(Boolean).join(" · ")}
                                    </div>
                                  )}
                                  {job.description && (
                                    <div style={{
                                      fontSize: 12, color: C.sub, fontFamily: FONT,
                                      marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-line",
                                    }}>
                                      {job.description}
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
                      ) : (
                        <div style={{
                          fontSize: 13, color: C.sub, fontFamily: FONT,
                          padding: "10px 0", textAlign: "center",
                        }}>
                          No career history yet. Click Edit to add your roles.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Network Overlap card */}
                  {overlapData?.network_overlap?.length > 0 && (
                    <NetworkOverlapWidget
                      networkOverlap={overlapData.network_overlap}
                      personFirstName={person.name?.split(" ")[0]}
                    />
                  )}

                </div>
              ) : (
                /* ── DESKTOP: two-column flex layout ── */
                <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                  {/* LEFT COLUMN */}
                  <div style={{ flex: 2, minWidth: 0 }}>

                    {/* You & Name */}
                    {!data.is_self && (
                      <RecommendationPath
                        path={data.vouch_path}
                        personFirstName={personFirstName}
                        userOverlap={overlapData?.user_overlap}
                        noteText={noteText}
                        noteEditing={noteEditing}
                        noteSaving={noteSaving}
                        onNoteChange={setNoteText}
                        onNoteEdit={() => setNoteEditing(true)}
                        onNoteSave={saveNote}
                        onNoteCancel={() => { setNoteText(noteSaved); setNoteEditing(false); }}
                      />
                    )}

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
                        {!replyContext && data?.degree >= 2 && !hasCareerOverlap && (() => {
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

                    {/* Post-Quick-Ask vouch nudge */}
                    {askJustCompleted && !hasVouched && (
                      <div style={{
                        background: "linear-gradient(135deg, #FEF3C7 0%, #ECFDF5 100%)",
                        border: `1.5px solid #FDE68A`, borderRadius: 12,
                        padding: "16px 18px", marginBottom: 16,
                      }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 4 }}>
                          {(() => {
                            const invName = sessionStorage.getItem("vouchfour_inviterName");
                            const first = invName?.split(" ")[0];
                            return first
                              ? `Remember how it felt when ${first} recommended you? You can do that for someone.`
                              : "Someone believed in you enough to recommend you. You can do that for someone too.";
                          })()}
                        </div>
                        <a
                          href={(() => {
                            const t = sessionStorage.getItem("vouchfour_vouchToken");
                            return t ? `/vouch?token=${t}` : "/start-vouch";
                          })()}
                          style={{
                            display: "inline-block", padding: "10px 20px", marginTop: 6,
                            background: C.accent, color: "#fff", borderRadius: 8,
                            fontSize: 13, fontWeight: 600, textDecoration: "none", fontFamily: FONT,
                          }}
                        >
                          Vouch for your top 4 →
                        </a>
                        <button
                          onClick={() => setAskJustCompleted(false)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 12, color: C.sub, fontFamily: FONT, marginLeft: 12,
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    )}

                    {/* Profile edit form */}
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

                    {/* Preferences form */}
                    {editingPreferences && (
                      <div ref={prefsRef}>
                        <PreferencesForm
                          person={person}
                          hasVouched={hasVouched}
                          onSave={() => {}}
                          onCancel={() => {
                            fetch(`/api/person/${personId}`, { credentials: "include" })
                              .then(res => res.ok ? res.json() : null)
                              .then(d => { if (d) setData(d); });
                            setEditingPreferences(false);
                          }}
                        />
                      </div>
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
                            fontSize: 12, fontWeight: 700, color: C.sub,
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
                    {editingCareerHistory ? (
                      <CareerHistoryEditForm
                        person={person}
                        employmentHistory={data.employment_history}
                        onSave={(newRoles, newSummary) => {
                          const mapped = newRoles.map(r => ({
                            title: r.title,
                            organization: r.organization,
                            start_date: r.start_date ? `${r.start_date}-01` : null,
                            end_date: r.is_current ? null : (r.end_date ? `${r.end_date}-01` : null),
                            is_current: r.is_current,
                            location: r.location,
                            description: r.description,
                          }));
                          setData(prev => ({
                            ...prev,
                            employment_history: mapped,
                            ...(newSummary ? { ai_summary: newSummary } : {}),
                          }));
                          setEditingCareerHistory(false);
                        }}
                        onCancel={() => setEditingCareerHistory(false)}
                      />
                    ) : (data.employment_history?.length > 0 || data.is_self) && (
                      <div style={{
                        background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
                        border: `1px solid ${C.border}`, marginBottom: 16,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}>
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          marginBottom: 12,
                        }}>
                          <div style={{
                            fontSize: 12, fontWeight: 700, color: C.sub,
                            textTransform: "uppercase", letterSpacing: 0.5,
                          }}>
                            Career History
                          </div>
                          {data.is_self ? (
                            <button
                              onClick={() => { setEditingCareerHistory(true); capture("career_history_edit_opened"); }}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                background: "none", border: "none", cursor: "pointer",
                                fontSize: 12, fontWeight: 600, color: C.sub, fontFamily: FONT,
                                padding: "2px 6px", borderRadius: 4,
                              }}
                            >
                              <PencilIcon size={11} /> Edit
                            </button>
                          ) : person.linkedin_url ? (
                            <a
                              href={person.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                fontSize: 12, fontWeight: 600, color: C.sub,
                                fontFamily: FONT, textDecoration: "none",
                              }}
                            >
                              LinkedIn <ExternalLinkIcon size={11} color={C.sub} />
                            </a>
                          ) : null}
                        </div>
                        {data.employment_history?.length > 0 ? (
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
                                    {(dateStr || job.location) && (
                                      <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: FONT, marginTop: 2 }}>
                                        {[dateStr, job.location].filter(Boolean).join(" · ")}
                                      </div>
                                    )}
                                    {job.description && (
                                      <div style={{
                                        fontSize: 12, color: C.sub, fontFamily: FONT,
                                        marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-line",
                                      }}>
                                        {job.description}
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
                        ) : (
                          <div style={{
                            fontSize: 13, color: C.sub, fontFamily: FONT,
                            padding: "10px 0", textAlign: "center",
                          }}>
                            No career history yet. Click Edit to add your roles.
                          </div>
                        )}
                      </div>
                    )}

                  </div>

                  {/* RIGHT COLUMN */}
                  <div style={{ flex: 1, minWidth: 0 }}>

                    {/* Threads card */}
                    {data.is_self && myThreads && (
                      <div style={{
                        background: "#FFFFFF", borderRadius: 14,
                        padding: "16px 18px", marginBottom: 16,
                        border: `1px solid ${C.border}`,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}>
                        {/* Header with + button */}
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          marginBottom: 12,
                        }}>
                          <div style={{
                            fontSize: 12, fontWeight: 700, color: C.sub, fontFamily: FONT,
                            textTransform: "uppercase", letterSpacing: 0.5,
                          }}>
                            Group Threads
                          </div>
                          {!newThreadOpen && !threadDraft && (
                            <button
                              onClick={() => setNewThreadOpen(true)}
                              title="New thread"
                              style={{
                                width: 26, height: 26, borderRadius: 7,
                                background: "#F5F3FF", border: "1px solid #C4B5FD",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                cursor: "pointer", transition: "all 0.15s",
                                padding: 0,
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = "#EDE9FE"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "#F5F3FF"; }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* New thread creation panel */}
                        {newThreadOpen && !threadDraft && (
                          <div style={{
                            background: "#FAFAF9", borderRadius: 12,
                            border: `1.5px solid ${C.accent}`, padding: "14px 16px",
                            marginBottom: myThreads.length > 0 ? 12 : 0,
                          }}>
                            <div style={{
                              fontSize: 11, fontWeight: 700, color: C.accent,
                              textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
                            }}>
                              New Thread
                            </div>

                            {selectedParticipants.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                {selectedParticipants.map(p => (
                                  <div key={p.person_id} style={{
                                    display: "inline-flex", alignItems: "center", gap: 5,
                                    padding: "4px 8px 4px 4px",
                                    background: "#EEF2FF", border: "1px solid #A5B4FC",
                                    borderRadius: 20, fontSize: 12, fontWeight: 500,
                                    color: C.ink, fontFamily: FONT,
                                  }}>
                                    <PhotoAvatar name={p.display_name} photoUrl={p.photo_url} size={20} />
                                    <span>{p.display_name.split(" ")[0]}</span>
                                    <button
                                      onClick={() => handleRemoveParticipant(p.person_id)}
                                      style={{
                                        background: "none", border: "none", cursor: "pointer",
                                        padding: "0 2px", color: C.sub, fontSize: 14, lineHeight: 1,
                                        display: "flex", alignItems: "center",
                                      }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div style={{ position: "relative", marginBottom: 10 }}>
                              <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search your network to add people..."
                                autoFocus
                                style={{
                                  width: "100%", padding: "8px 10px",
                                  fontSize: 14, fontFamily: FONT, color: C.ink,
                                  background: "#fff", border: `1.5px solid ${C.border}`,
                                  borderRadius: 8, boxSizing: "border-box",
                                  WebkitAppearance: "none",
                                  transition: "border-color 0.15s",
                                }}
                                onFocus={e => { e.target.style.borderColor = C.accent; }}
                                onBlur={e => { setTimeout(() => { e.target.style.borderColor = C.border; }, 150); }}
                              />
                              {searchQuery.length >= 2 && (searchResults.length > 0 || searchLoading) && (
                                <div style={{
                                  position: "absolute", top: "100%", left: 0, right: 0,
                                  background: "#fff", border: `1px solid ${C.border}`,
                                  borderRadius: 8, marginTop: 4, zIndex: 10,
                                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                                  maxHeight: 200, overflowY: "auto",
                                }}>
                                  {searchLoading && searchResults.length === 0 ? (
                                    <div style={{ padding: "10px 12px", fontSize: 13, color: C.sub, fontFamily: FONT }}>
                                      Searching...
                                    </div>
                                  ) : searchResults.map(r => (
                                    <button
                                      key={r.person_id}
                                      onMouseDown={(e) => { e.preventDefault(); handleSelectParticipant(r); }}
                                      style={{
                                        display: "flex", alignItems: "center", gap: 8,
                                        width: "100%", padding: "8px 12px",
                                        background: "none", border: "none", cursor: "pointer",
                                        fontFamily: FONT, textAlign: "left",
                                        transition: "background 0.1s",
                                      }}
                                      onMouseEnter={e => { e.currentTarget.style.background = "#F5F3FF"; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                                    >
                                      <PhotoAvatar name={r.display_name} photoUrl={r.photo_url} size={28} />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                                          {r.display_name}
                                        </div>
                                        {(r.current_title || r.current_company) && (
                                          <div style={{ fontSize: 11, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {[r.current_title, r.current_company].filter(Boolean).join(" at ")}
                                          </div>
                                        )}
                                      </div>
                                      </button>
                                  ))}
                                </div>
                              )}
                              {searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && (
                                <div style={{
                                  position: "absolute", top: "100%", left: 0, right: 0,
                                  background: "#fff", border: `1px solid ${C.border}`,
                                  borderRadius: 8, marginTop: 4, zIndex: 10,
                                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                                  padding: "10px 12px", fontSize: 13, color: C.sub, fontFamily: FONT,
                                }}>
                                  No results — only people open to chat are shown
                                </div>
                              )}
                            </div>

                            {selectedParticipants.length >= 2 && (
                              <div style={{ marginBottom: 10 }}>
                                <input
                                  value={threadTopic}
                                  onChange={e => setThreadTopic(e.target.value)}
                                  placeholder="What's this thread about?"
                                  style={{
                                    width: "100%", padding: "8px 10px",
                                    fontSize: 14, fontFamily: FONT, color: C.ink,
                                    background: "#fff", border: `1.5px solid ${C.border}`,
                                    borderRadius: 8, boxSizing: "border-box",
                                    WebkitAppearance: "none",
                                    transition: "border-color 0.15s",
                                  }}
                                  onFocus={e => { e.target.style.borderColor = C.accent; }}
                                  onBlur={e => { e.target.style.borderColor = C.border; }}
                                />
                              </div>
                            )}

                            {selectedParticipants.length < 2 && (
                              <p style={{ fontSize: 12, color: C.sub, fontFamily: FONT, margin: 0, lineHeight: 1.5 }}>
                                Add at least 2 people to start a group thread.
                              </p>
                            )}

                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                              <button
                                onClick={handleNewThreadCancel}
                                style={{
                                  padding: "7px 14px", background: "#F5F5F4",
                                  color: C.sub, border: `1px solid ${C.border}`,
                                  borderRadius: 8, fontSize: 13, fontWeight: 600,
                                  fontFamily: FONT, cursor: "pointer",
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleDraftThread}
                                disabled={selectedParticipants.length < 2 || !threadTopic.trim() || threadDraftLoading}
                                style={{
                                  padding: "7px 14px",
                                  background: (selectedParticipants.length < 2 || !threadTopic.trim() || threadDraftLoading) ? "#C7D2FE" : C.accent,
                                  color: "#fff", border: "none", borderRadius: 8,
                                  fontSize: 13, fontWeight: 600, fontFamily: FONT,
                                  cursor: (selectedParticipants.length < 2 || !threadTopic.trim() || threadDraftLoading) ? "not-allowed" : "pointer",
                                  transition: "background 0.15s",
                                }}
                              >
                                {threadDraftLoading ? "Drafting..." : "Draft outreach"}
                              </button>
                            </div>
                          </div>
                        )}

                        {threadDraft && (
                          <div style={{ marginBottom: myThreads.length > 0 ? 12 : 0 }}>
                            <ThreadDraftPanel
                              threadId={threadDraft.threadId}
                              creatorToken={threadDraft.creatorToken}
                              topic={threadDraft.topic}
                              draftBody={threadDraft.draftBody}
                              participants={threadDraft.participants}
                              onDone={handleNewThreadDone}
                              onCancel={handleNewThreadCancel}
                            />
                          </div>
                        )}

                        {myThreads.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {(showAllThreads ? myThreads : myThreads.slice(0, 3)).map(t => (
                              <a
                                key={t.thread_id}
                                href={`/thread/${t.access_token}`}
                                style={{
                                  display: "block", textDecoration: "none",
                                  padding: "10px 14px",
                                  background: "#FAFAF9", borderRadius: 10,
                                  border: `1px solid ${C.border}`,
                                  transition: "border-color 0.15s, box-shadow 0.15s",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.boxShadow = "0 2px 8px rgba(79,70,229,0.1)"; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                  </svg>
                                  <span style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
                                    {t.topic}
                                  </span>
                                  <span style={{ fontSize: 11, color: C.sub, fontFamily: FONT, marginLeft: "auto", flexShrink: 0 }}>
                                    {t.participant_count} people
                                  </span>
                                </div>
                                {t.last_message_preview && (
                                  <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.4 }}>
                                    <strong style={{ color: C.ink, fontWeight: 500 }}>{t.last_message_author?.split(" ")[0]}:</strong>{" "}
                                    {t.last_message_preview}
                                  </div>
                                )}
                              </a>
                            ))}
                            {!showAllThreads && myThreads.length > 3 && (
                              <button
                                onClick={() => setShowAllThreads(true)}
                                style={{
                                  background: "none", border: "none", cursor: "pointer",
                                  fontSize: 13, color: C.accent, fontFamily: FONT,
                                  padding: "4px 0", textAlign: "center",
                                }}
                              >
                                See {myThreads.length - 3} more →
                              </button>
                            )}
                          </div>
                        )}

                        {myThreads.length === 0 && !newThreadOpen && !threadDraft && (
                          <div style={{
                            textAlign: "center", padding: "12px 0",
                            fontSize: 13, color: C.sub, fontFamily: FONT,
                          }}>
                            No threads yet — tap + to start one
                          </div>
                        )}
                      </div>
                    )}

                    {/* Gives card */}
                    {(data.is_self || canAsk || (person.gives && person.gives.length > 0) || person.gives_free_text || data.conversation) && (
                      <GivesCard gives={person.gives} givesFreeText={person.gives_free_text} personFirstName={personFirstName} canAsk={canAsk} askOpen={askOpen} onAskClick={() => setAskOpen(true)} isSelf={data.is_self} onEditPrefs={() => { setEditingPreferences(true); capture("preferences_opened"); }} conversation={data.conversation} />
                    )}

                    {/* Network Overlap card */}
                    {overlapData?.network_overlap?.length > 0 && (
                      <div style={{ position: "sticky", top: 76 }}>
                        <NetworkOverlapWidget
                          networkOverlap={overlapData.network_overlap}
                          personFirstName={person.name?.split(" ")[0]}
                        />
                      </div>
                    )}

                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
