import { useState, useEffect } from "react";
import { gradientForName, initialsForName } from "../lib/avatar.js";

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentLight: "#EFF6FF",
  accentSub: "#93C5FD",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chipBorder: "#BFDBFE",
  chip: "#F0F4FF",
  cardDone: "#FAFAF9",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

// ─── Pre-vouch welcome (new user who hasn't vouched yet) ─────────────────────

function PreVouchWelcome({ user, slug }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);

  const inviterName = sessionStorage.getItem("vouchfour_inviterName");
  const vouchToken = sessionStorage.getItem("vouchfour_vouchToken");
  const jobFunctionRaw = sessionStorage.getItem("vouchfour_jobFunction");
  const jobFunction = jobFunctionRaw ? JSON.parse(jobFunctionRaw) : null;

  useEffect(() => {
    fetch("/api/my-network-preview", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setPreview(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const inviterFirstName = inviterName?.split(" ")[0] || preview?.sponsors?.[0]?.name?.split(" ")[0];
  const practLabel = jobFunction?.practitionerLabel || jobFunction?.name;
  const vouchUrl = vouchToken ? `/vouch?token=${vouchToken}&ready=1` : "/start-vouch";
  const networkSize = preview?.networkSize || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Steps 1+2: The compliment + network value (merged) */}
      <div style={{
        borderRadius: 14, padding: 2,
        background: "linear-gradient(135deg, #6366F1, #EC4899)",
        boxShadow: "0 12px 40px rgba(99,102,241,0.20), 0 4px 16px rgba(236,72,153,0.12)",
      }}>
        <div style={{ borderRadius: 12, padding: "20px 22px", background: "#fff" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, fontFamily: FONT, lineHeight: 1.4 }}>
            {inviterFirstName && jobFunction?.name
              ? <>{inviterFirstName} vouched for you as one of their 4 all-time best {jobFunction.name.toLowerCase()} colleagues.</>
              : inviterFirstName
                ? <>{inviterFirstName} vouched for you as one of their 4 all-time best colleagues.</>
                : <>Someone vouched for you as one of their 4 all-time best colleagues.</>}
          </div>

          {!loading && preview && networkSize > 0 && (
            <>
              <div style={{ fontSize: 14, color: C.ink, fontFamily: FONT, lineHeight: 1.6, marginTop: 10 }}>
                {inviterFirstName
                  ? <>Through {inviterFirstName}, your network already has{" "}
                      <a href={`/talent/${slug}`} style={{ color: C.accent, fontWeight: 700, textDecoration: "none" }}>
                        {networkSize} recommendations
                      </a> including:
                    </>
                  : <>Your network already has{" "}
                      <a href={`/talent/${slug}`} style={{ color: C.accent, fontWeight: 700, textDecoration: "none" }}>
                        {networkSize} recommendations
                      </a> including:
                    </>}
              </div>

              {/* People faces (top 5) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                {preview.highlighted.slice(0, 7).map(p => {
                  const isPlaceholder = p.photoUrl && p.photoUrl.includes("static.licdn.com");
                  return (
                    <a
                      key={p.id}
                      href={`/person/${p.id}`}
                      style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
                    >
                      {p.photoUrl && !isPlaceholder ? (
                        <img src={p.photoUrl} alt={p.name}
                          style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
                          onError={e => { e.target.style.display = "none"; }}
                        />
                      ) : (
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: gradientForName(p.name), color: "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700, fontFamily: FONT, flexShrink: 0,
                        }}>{initialsForName(p.name)}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
                          {p.name}
                        </div>
                        {(p.title || p.company) && (
                          <div style={{
                            fontSize: 12, color: C.sub, fontFamily: FONT,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {[p.title, p.company].filter(Boolean).join(" at ")}
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: "#fff", padding: "2px 6px",
                        borderRadius: 4,
                        background: p.degree === 1 ? "linear-gradient(135deg, #6366F1, #4F46E5)"
                          : p.degree === 2 ? "linear-gradient(135deg, #34D399, #16A34A)"
                          : "linear-gradient(135deg, #A78BFA, #7C3AED)",
                      }}>
                        {p.degree === 1 ? "1st" : p.degree === 2 ? "2nd" : "3rd"}
                      </span>
                    </a>
                  );
                })}
              </div>

              {/* Brain text + input */}
              <div style={{ fontSize: 14, color: C.ink, fontFamily: FONT, lineHeight: 1.6, marginTop: 14 }}>
                <a href="/brain" style={{ color: C.accent, fontWeight: 700, textDecoration: "none" }}>Network Brain</a>{" "}
                will help you make the most of your network.
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const q = e.target.elements.brainQ.value.trim();
                  window.location.href = q ? `/brain?q=${encodeURIComponent(q)}` : "/brain";
                }}
                style={{ display: "flex", gap: 6, marginTop: 8 }}
              >
                <input
                  name="brainQ"
                  placeholder="Who's a highly analytical marketer?"
                  autoComplete="off"
                  style={{
                    flex: 1, padding: "12px 14px",
                    fontSize: 16, fontFamily: FONT,
                    color: C.ink, background: "#fff",
                    border: `1.5px solid ${C.border}`, borderRadius: 10,
                    WebkitAppearance: "none",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
                  onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; }}
                />
                <button
                  type="submit"
                  style={{
                    padding: "10px 12px",
                    background: C.accent, border: "none", borderRadius: 10,
                    cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
                  </svg>
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Step 3: The ask */}
      <div style={{
        background: "rgba(255,255,255,0.85)", borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.4)", padding: "18px 20px",
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, fontFamily: FONT, lineHeight: 1.4, marginBottom: 14 }}>
          {inviterFirstName
            ? <>Now, {inviterFirstName} wants to know who <em>you</em> vouch for:</>
            : <>Who do <em>you</em> vouch for?</>}
        </div>
        <a
          href={vouchUrl}
          style={{
            display: "block", textAlign: "center",
            padding: "14px 28px",
            background: C.accent, color: "#fff",
            border: "none", borderRadius: 12,
            fontSize: 15, fontWeight: 700,
            fontFamily: FONT, cursor: "pointer",
            textDecoration: "none",
            boxShadow: "0 4px 16px rgba(37,99,235,0.20)",
          }}
        >
          {practLabel && inviterFirstName
            ? `Recommend ${practLabel} to ${inviterFirstName}`
            : practLabel
              ? `Recommend ${practLabel}`
              : "Recommend your top 4"}
        </a>
      </div>
    </div>
  );
}

// ─── Post-vouch user card ────────────────────────────────────────────────────

function UserCard({ user, slug }) {
  const firstName = user.name.split(" ")[0];

  return (
    <div style={{
      position: "relative",
      borderRadius: 18, padding: 2,
      background: "linear-gradient(135deg, #6366F1, #EC4899)",
      boxShadow: "0 12px 40px rgba(99,102,241,0.20), 0 4px 16px rgba(236,72,153,0.12)",
    }}>
    <div style={{
      borderRadius: 16, padding: "20px 22px",
      background: "#fff",
    }}>
      {/* Welcome + profile link */}
      <a
        href={user.id ? `/person/${user.id}` : "#"}
        style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, textDecoration: "none" }}
      >
        <div style={{
          width: 42, height: 42, borderRadius: 11,
          background: gradientForName(user.name), color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, fontWeight: 700, fontFamily: FONT, flexShrink: 0,
          textShadow: "0 1px 2px rgba(0,0,0,0.15)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          {initialsForName(user.name)}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
            Welcome back, {firstName}
          </div>
          <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 1 }}>
            {user.email}
          </div>
          {user.id && (
            <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, fontFamily: FONT, marginTop: 2 }}>
              View your profile →
            </div>
          )}
        </div>
      </a>

      {/* Primary CTA — Talent Network */}
      <a
        href={`/talent/${slug}`}
        style={{
          display: "block", textAlign: "center",
          padding: "14px 28px",
          background: C.accent, color: "#fff",
          border: "none", borderRadius: 12,
          fontSize: 15, fontWeight: 700,
          fontFamily: FONT, cursor: "pointer",
          textDecoration: "none",
          boxShadow: "0 4px 16px rgba(37,99,235,0.20)",
        }}
      >
        View Your Talent Network
      </a>

      {/* Brain mini-prompt */}
      <div style={{ marginTop: 14 }}>
        <a href="/brain" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, textDecoration: "none" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
            <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.accent, fontFamily: FONT }}>
            Network Brain
          </span>
        </a>
        <form
          onSubmit={e => {
            e.preventDefault();
            const q = e.target.elements.brainQ.value.trim();
            if (q) {
              window.location.href = `/brain?q=${encodeURIComponent(q)}`;
            } else {
              window.location.href = "/brain";
            }
          }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            name="brainQ"
            placeholder="Ask anything about your network..."
            autoComplete="off"
            autoFocus
            style={{
              flex: 1, padding: "12px 14px",
              fontSize: 16, fontFamily: FONT,
              color: C.ink, background: "#fff",
              border: `1.5px solid ${C.border}`,
              borderRadius: 10,
              WebkitAppearance: "none",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
            onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
            onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; }}
          />
          <button
            type="submit"
            style={{
              padding: "10px 12px",
              background: C.accent, border: "none", borderRadius: 10,
              cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
              <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
              <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
            </svg>
          </button>
        </form>
      </div>

      {/* Secondary vouch link */}
      <a
        href="/start-vouch"
        style={{
          display: "block", textAlign: "center",
          marginTop: 14, fontSize: 13, fontWeight: 600,
          color: C.accent, fontFamily: FONT,
          textDecoration: "none",
        }}
      >
        Keep building your network →
      </a>
    </div>
    </div>
  );
}

// ─── Main HomePage ───────────────────────────────────────────────────────────

export default function HomePage() {
  const [user, setUser] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  // Check for existing session (or validate login token) on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("token");

    if (loginToken) {
      fetch(`/api/auth/validate?token=${loginToken}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (data.user) {
            setUser(data.user);
            window.history.replaceState({}, "", window.location.pathname);
          }
        })
        .catch(() => {})
        .finally(() => setSessionChecked(true));
    } else {
      fetch("/api/auth/session", { credentials: "include" })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error("No session");
        })
        .then(data => setUser(data.user))
        .catch(() => {})
        .finally(() => setSessionChecked(true));
    }
  }, []);

  function getSlug() {
    if (!user?.linkedin) return "";
    const match = user.linkedin.match(/\/in\/([^/]+)/);
    return match ? match[1] : "";
  }

  async function handleLogin(e) {
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

  const slug = getSlug();

  return (
    <div style={{
      minHeight: "100vh", background: "#000000", fontFamily: FONT,
      display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden",
    }}>
      {/* Fixed logo bar */}
      <div style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100,
        width: "100%", maxWidth: 900,
        background: "#FFFFFF",
        padding: "12px 20px",
      }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5 }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </span>
      </div>

      <div style={{
        width: "100%", maxWidth: 900,
        background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 40px",
        borderRadius: 0, margin: "56px 0 0",
        minHeight: "calc(100vh - 56px)",
      }}>
        <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 24, minHeight: "calc(100vh - 96px)", display: "flex", flexDirection: "column" }}>

          {/* State 1: Logged-out — invite-only public page */}
          {sessionChecked && !user && (
            <div style={{
              borderRadius: 18, padding: 2,
              background: "linear-gradient(135deg, #6366F1, #818CF8)",
              boxShadow: "0 4px 24px rgba(79,70,229,0.12)",
              marginTop: 70,
            }}>
            <div style={{
              background: "#EEF2FF", borderRadius: 16,
              padding: "36px 28px 32px",
            }}>
              <p style={{
                fontSize: 20, fontWeight: 700, color: C.ink, lineHeight: 1.4, fontFamily: FONT,
                marginBottom: 6, marginTop: 0, textAlign: "center",
              }}>
                Professional network built on{" "}<br />curated recommendations.
              </p>
              <p style={{
                fontSize: 14, color: C.sub, fontFamily: FONT, marginBottom: 28,
                fontStyle: "italic", textAlign: "center", marginTop: 0,
              }}>
                Available by invitation only.
              </p>

              {/* Login form */}
              <div style={{
                padding: "18px 20px",
                background: "#fff", borderRadius: 12,
                border: "1px solid #DBEAFE",
              }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: FONT,
                  marginBottom: 10,
                }}>
                  Already invited?
                </div>
                {sent ? (
                  <div style={{
                    padding: "12px 14px", borderRadius: 10,
                    background: C.successLight, border: "1px solid #86EFAC",
                  }}>
                    <div style={{ fontSize: 14, color: C.success, fontWeight: 600, marginBottom: 4, fontFamily: FONT }}>
                      Check your email
                    </div>
                    <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, fontFamily: FONT }}>
                      If we found an account matching <strong style={{ color: C.ink }}>{identifier}</strong>,
                      we've sent you a login link.
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleLogin} style={{ display: "flex", gap: 8 }}>
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
                        background: identifier.trim() && !sending ? C.accent : "#A5B4FC",
                        color: "#fff", border: "none", borderRadius: 10,
                        fontSize: 14, fontWeight: 600, fontFamily: FONT,
                        cursor: identifier.trim() && !sending ? "pointer" : "not-allowed",
                        whiteSpace: "nowrap", flexShrink: 0,
                      }}
                    >
                      {sending ? "..." : "Log in"}
                    </button>
                  </form>
                )}
                {error && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#DC2626", fontFamily: FONT }}>
                    {error}
                  </div>
                )}
              </div>
            </div>
            </div>
          )}

          {/* State 2: Logged-in, pre-vouch — welcome experience */}
          {sessionChecked && user && !user.has_vouched && (
            <PreVouchWelcome user={user} slug={slug} />
          )}

          {/* State 3: Logged-in, has vouched — redirect to talent network */}
          {sessionChecked && user && user.has_vouched && slug && (() => {
            window.location.href = `/talent/${slug}`;
            return null;
          })()}

          {/* Footer */}
          <p style={{
            marginTop: "auto", fontSize: 11, color: "#7C6FA0",
            lineHeight: 1.5, textAlign: "center", padding: "0 12px",
          }}>
            Built by{" "}
            <a
              href="https://www.linkedin.com/in/joshscott/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#7C6FA0", textDecoration: "underline" }}
            >Josh Scott</a>{" "}
            with significant help from Claude.
          </p>

        </div>
      </div>
    </div>
  );
}
