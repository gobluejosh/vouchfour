import { useState, useEffect } from "react";
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
            fontSize: 15, border: `1.5px solid ${C.border}`,
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

// ── Main PersonPage ────────────────────────────────────────────────────

export default function PersonPage() {
  const personId = Number(window.location.pathname.split("/person/")[1]) || 0;

  const [authState, setAuthState] = useState("checking");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        .then(d => {
          setAuthState("authenticated");
          if (d.user?.id) identify(d.user.id, { name: d.user.name });
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

  const person = data?.person;
  const subtitle = [person?.current_title, person?.current_company].filter(Boolean).join(" at ");

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
                href="#"
                onClick={e => { e.preventDefault(); window.history.back(); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 13, color: C.ink, fontWeight: 600,
                  textDecoration: "none", fontFamily: FONT,
                  paddingTop: 20, paddingBottom: 4,
                }}
              >
                <BackIcon /> Back
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

                {/* LinkedIn button */}
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
              </div>

              {/* AI Summary */}
              {data.ai_summary && (
                <div style={{
                  background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
                  border: `1px solid ${C.border}`, marginBottom: 16,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: C.sub,
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
                  }}>
                    Professional Summary
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.7, color: C.ink, margin: 0, fontFamily: FONT }}>
                    {data.ai_summary}
                  </p>
                </div>
              )}

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
