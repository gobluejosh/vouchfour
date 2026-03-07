import { useState, useEffect } from "react";

const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentLight: "#EFF6FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  warn: "#D97706",
  warnLight: "#FFFBEB",
  danger: "#DC2626",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

function adminFetch(url, secret, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": secret,
      ...(options.headers || {}),
    },
  });
}

// ─── Placeholder photo detection ─────────────────────────────────────────────

function isPlaceholderPhoto(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes("placeholder") ||
    lower.includes("default") ||
    lower.includes("no-photo") ||
    lower.includes("null") ||
    lower === ""
  );
}

function PhotoAvatar({ name, photoUrl, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = photoUrl && !isPlaceholderPhoto(photoUrl) && !failed;

  if (showPhoto) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }

  // Initials fallback
  const parts = (name || "?").split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0][0] || "?").toUpperCase();

  // Simple gradient from name hash
  const hash = (name || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, hsl(${hue}, 60%, 55%), hsl(${(hue + 40) % 360}, 50%, 45%))`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#fff",
        fontSize: size * 0.38,
        fontWeight: 700,
        fontFamily: FONT,
        letterSpacing: -0.5,
      }}
    >
      {initials}
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const config = {
    pending: { bg: "#FEF3C7", color: "#92400E", border: "#FDE68A", label: "Needs Review" },
    approved: { bg: C.successLight, color: C.success, border: "#BBF7D0", label: "Approved" },
    flagged: { bg: "#FEF2F2", color: C.danger, border: "#FECACA", label: "Flagged" },
  };
  const c = config[status] || config.pending;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: FONT,
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
      }}
    >
      {c.label}
    </span>
  );
}

// ─── Person Review Card ──────────────────────────────────────────────────────

function PersonCard({ person, secret, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(person.review_notes || "");
  const [saving, setSaving] = useState(false);
  const [linkedinText, setLinkedinText] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null); // null | { ok, roles_count, ai_summary } | { error }

  async function setStatus(status) {
    setSaving(true);
    try {
      await adminFetch("/api/admin/enrichment-review", secret, {
        method: "PUT",
        body: JSON.stringify({
          person_id: person.id,
          status,
          notes: status === "flagged" ? notes : person.review_notes,
        }),
      });
      onUpdate(person.id, status, status === "flagged" ? notes : person.review_notes);
    } catch (err) {
      console.error("Failed to update review:", err);
    } finally {
      setSaving(false);
    }
  }

  const enrichedDate = person.enriched_at
    ? new Date(person.enriched_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : "—";

  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: 12,
        border: `1.5px solid ${person.review_status === "flagged" ? "#FECACA" : person.review_status === "pending" ? "#FDE68A" : C.border}`,
        padding: "16px 18px",
        marginBottom: 10,
      }}
    >
      {/* Top row: avatar + name + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <PhotoAvatar name={person.display_name} photoUrl={person.photo_url} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
              {person.display_name}
            </span>
            <StatusBadge status={person.review_status} />
          </div>
          {(person.current_title || person.current_company) && (
            <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, marginTop: 2 }}>
              {[person.current_title, person.current_company].filter(Boolean).join(" at ")}
            </div>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: C.sub,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            padding: 4,
            flexShrink: 0,
          }}
        >
          ▾
        </button>
      </div>

      {/* Summary preview (always visible) */}
      {person.compact_summary && (
        <div
          style={{
            fontSize: 13,
            color: C.sub,
            fontFamily: FONT,
            lineHeight: 1.5,
            marginTop: 10,
            paddingLeft: 54,
          }}
        >
          {person.compact_summary}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 14, paddingLeft: 54 }}>
          {/* Full AI summary */}
          {person.ai_summary && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.accent, marginBottom: 4, fontFamily: FONT }}>
                Full Summary
              </div>
              <div style={{ fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.6 }}>
                {person.ai_summary}
              </div>
            </div>
          )}

          {/* Meta info */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: C.sub, fontFamily: FONT, marginBottom: 14 }}>
            <span>Enriched: {enrichedDate}</span>
            {person.linkedin_url && (
              <a
                href={person.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: C.accent, textDecoration: "none" }}
              >
                LinkedIn ↗
              </a>
            )}
            <a
              href={`/person/${person.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.accent, textDecoration: "none" }}
            >
              Profile page ↗
            </a>
          </div>

          {/* LinkedIn paste fix */}
          <div style={{
            marginBottom: 12, padding: "10px 12px",
            background: "#FAFAF9", borderRadius: 8, border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.accent, marginBottom: 6, fontFamily: FONT }}>
              Paste LinkedIn Experience
            </div>
            <textarea
              value={linkedinText}
              onChange={(e) => setLinkedinText(e.target.value)}
              placeholder="Paste LinkedIn experience section here to fix career history + regenerate summary..."
              rows={3}
              style={{
                width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: FONT,
                color: C.ink, background: "#fff", border: `1.5px solid ${C.border}`,
                borderRadius: 8, resize: "vertical", boxSizing: "border-box",
                marginBottom: 6,
              }}
            />
            <button
              onClick={async () => {
                if (!linkedinText.trim()) return;
                setFixing(true);
                setFixResult(null);
                try {
                  const res = await adminFetch("/api/admin/fix-career", secret, {
                    method: "POST",
                    body: JSON.stringify({ person_id: person.id, text: linkedinText.trim() }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    setFixResult(data);
                    onUpdate(person.id, "approved", "Fixed via LinkedIn paste");
                  } else {
                    setFixResult({ error: data.error || "Fix failed" });
                  }
                } catch {
                  setFixResult({ error: "Request failed" });
                } finally {
                  setFixing(false);
                }
              }}
              disabled={fixing || !linkedinText.trim()}
              style={{
                padding: "6px 14px", background: C.accent, color: "#fff",
                border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600,
                fontFamily: FONT, cursor: (fixing || !linkedinText.trim()) ? "default" : "pointer",
                opacity: (fixing || !linkedinText.trim()) ? 0.6 : 1,
              }}
            >
              {fixing ? "Fixing..." : "Parse & Fix ✨"}
            </button>
            {fixResult && (
              <div style={{
                marginTop: 6, fontSize: 12, fontFamily: FONT,
                color: fixResult.error ? C.danger : C.success,
              }}>
                {fixResult.error
                  ? fixResult.error
                  : `✓ Fixed: ${fixResult.roles_count} roles saved, summary regenerated. Status set to Approved.`}
              </div>
            )}
          </div>

          {/* Flagged notes */}
          {(person.review_status === "flagged" || expanded) && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (what's wrong, what needs fixing...)"
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: 13,
                  fontFamily: FONT,
                  color: C.ink,
                  background: "#FAFAF9",
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 8,
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {person.review_status !== "approved" && (
              <button
                onClick={() => setStatus("approved")}
                disabled={saving}
                style={{
                  padding: "7px 16px",
                  background: C.success,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: FONT,
                  cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                ✓ Approve
              </button>
            )}
            {person.review_status !== "flagged" && (
              <button
                onClick={() => setStatus("flagged")}
                disabled={saving}
                style={{
                  padding: "7px 16px",
                  background: C.danger,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: FONT,
                  cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                ⚑ Flag
              </button>
            )}
            {person.review_status !== "pending" && (
              <button
                onClick={() => setStatus("pending")}
                disabled={saving}
                style={{
                  padding: "7px 16px",
                  background: "#F5F5F4",
                  color: C.sub,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: FONT,
                  cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Existing notes display */}
          {person.review_notes && person.review_status === "flagged" && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                fontSize: 12,
                color: C.danger,
                fontFamily: FONT,
                lineHeight: 1.5,
              }}
            >
              <strong>Flag notes:</strong> {person.review_notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function EnrichmentReviewPage() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [people, setPeople] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, flagged: 0, total: 0 });
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(false);

  async function handleAuth(e) {
    e?.preventDefault();
    if (!secret.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await adminFetch("/api/admin/settings", secret.trim());
      if (!res.ok) throw new Error("Invalid password");
      setAuthed(true);
      loadQueue(secret.trim(), "pending");
    } catch {
      setAuthError("Invalid admin password");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadQueue(sec, status) {
    setLoading(true);
    try {
      const res = await adminFetch(
        `/api/admin/enrichment-queue?status=${status}`,
        sec || secret.trim()
      );
      const data = await res.json();
      setPeople(data.people || []);
      setCounts(data.counts || { pending: 0, approved: 0, flagged: 0, total: 0 });
    } catch (err) {
      console.error("Failed to load queue:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(newFilter) {
    setFilter(newFilter);
    loadQueue(secret.trim(), newFilter);
  }

  function handleUpdate(personId, newStatus, newNotes) {
    setPeople((prev) =>
      prev.map((p) =>
        p.id === personId
          ? { ...p, review_status: newStatus, review_notes: newNotes, reviewed_at: new Date().toISOString() }
          : p
      )
    );
    // Refresh counts
    setCounts((prev) => {
      const updated = { ...prev };
      // Find old status
      const old = people.find((p) => p.id === personId);
      if (old) {
        updated[old.review_status] = Math.max(0, (updated[old.review_status] || 0) - 1);
        updated[newStatus] = (updated[newStatus] || 0) + 1;
      }
      return updated;
    });
  }

  // ─── Password gate ──────────────────────────────────────────────────

  const headerBar = (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        width: "100%",
        background: "#FFFFFF",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <a
        href="/"
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: C.ink,
          letterSpacing: -0.5,
          textDecoration: "none",
        }}
      >
        Vouch<span style={{ color: C.accent }}>Four</span>
      </a>
      <span style={{ color: C.border, fontSize: 14 }}>|</span>
      <a
        href="/admin"
        style={{
          fontSize: 12,
          color: C.sub,
          fontFamily: FONT,
          textDecoration: "none",
        }}
      >
        Admin
      </a>
      <span style={{ fontSize: 12, color: C.sub, fontFamily: FONT }}>›</span>
      <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, fontFamily: FONT }}>
        Enrichment Review
      </span>
    </div>
  );

  if (!authed) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#000000",
          fontFamily: FONT,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          overflowX: "hidden",
        }}
      >
        {headerBar}
        <div
          style={{
            width: "100%",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
            padding: "0 16px 120px",
            margin: "52px 0 0",
          }}
        >
          <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 40 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
              Enrichment Review Queue
            </div>
            <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5, marginBottom: 20 }}>
              Enter the admin password to review enrichment data.
            </p>
            <form onSubmit={handleAuth} style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Admin password"
                autoComplete="off"
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  fontSize: 15,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 10,
                  fontFamily: FONT,
                  color: C.ink,
                  background: "#fff",
                  WebkitAppearance: "none",
                }}
              />
              <button
                type="submit"
                disabled={!secret.trim() || authLoading}
                style={{
                  padding: "12px 20px",
                  background: secret.trim() && !authLoading ? C.accent : "#C7D2FE",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: FONT,
                  cursor: secret.trim() && !authLoading ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {authLoading ? "..." : "Enter"}
              </button>
            </form>
            {authError && (
              <div style={{ marginTop: 10, fontSize: 13, color: C.danger, fontFamily: FONT }}>
                {authError}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Review dashboard ───────────────────────────────────────────────

  const filters = [
    { key: "pending", label: "Needs Review", count: counts.pending, color: C.warn },
    { key: "flagged", label: "Flagged", count: counts.flagged, color: C.danger },
    { key: "approved", label: "Approved", count: counts.approved, color: C.success },
    { key: "all", label: "All", count: counts.total, color: C.sub },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000000",
        fontFamily: FONT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflowX: "hidden",
      }}
    >
      {headerBar}
      <div
        style={{
          width: "100%",
          background:
            "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)",
          padding: "0 16px 120px",
          margin: "52px 0 0",
        }}
      >
        <div style={{ maxWidth: 580, margin: "0 auto" }}>
          {/* Title */}
          <div style={{ paddingTop: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
              Enrichment Review
            </div>
            <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, marginTop: 4 }}>
              Review AI-generated profiles for accuracy. Data is live immediately — this is just for QA.
            </div>
          </div>

          {/* Filter tabs + refresh */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 16,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => handleFilterChange(f.key)}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: FONT,
                  borderRadius: 20,
                  border: filter === f.key ? `2px solid ${f.color}` : `1.5px solid ${C.border}`,
                  background: filter === f.key ? "#FFFFFF" : "#FAFAF9",
                  color: filter === f.key ? f.color : C.sub,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {f.label}
                {f.count > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      padding: "1px 6px",
                      fontSize: 11,
                      fontWeight: 700,
                      background: filter === f.key ? f.color : "#E5E7EB",
                      color: filter === f.key ? "#fff" : C.sub,
                      borderRadius: 8,
                    }}
                  >
                    {f.count}
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={() => loadQueue(secret.trim(), filter)}
              disabled={loading}
              title="Refresh"
              style={{
                marginLeft: "auto",
                width: 32,
                height: 32,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#FAFAF9",
                border: `1.5px solid ${C.border}`,
                borderRadius: "50%",
                color: C.sub,
                fontSize: 15,
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.5 : 1,
                transition: "all 0.15s",
                flexShrink: 0,
              }}
            >
              ↻
            </button>
          </div>

          {/* People list */}
          {loading ? (
            <div style={{ textAlign: "center", paddingTop: 40 }}>
              <div style={{ fontSize: 14, color: C.sub, fontFamily: FONT }}>
                Loading...
              </div>
            </div>
          ) : people.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                paddingTop: 40,
                background: "#FFFFFF",
                borderRadius: 12,
                border: `1.5px solid ${C.border}`,
                padding: "40px 20px",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>
                {filter === "pending" ? "✨" : filter === "flagged" ? "🎯" : "📋"}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
                {filter === "pending"
                  ? "All caught up!"
                  : filter === "flagged"
                  ? "No flagged profiles"
                  : "Nothing here yet"}
              </div>
              <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, marginTop: 4 }}>
                {filter === "pending"
                  ? "No enrichments need review right now."
                  : `No ${filter} profiles to show.`}
              </div>
            </div>
          ) : (
            people.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                secret={secret.trim()}
                onUpdate={handleUpdate}
              />
            ))
          )}

          {/* Footer */}
          <p
            style={{
              marginTop: 40,
              fontSize: 11,
              color: "#78716C",
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            {people.length > 0 && `Showing ${people.length} profiles`}
          </p>
        </div>
      </div>
    </div>
  );
}
