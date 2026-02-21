import { useState, useEffect } from "react";

const C = {
  ink: "#1C1917",
  sub: "#78716C",
  accent: "#2563EB",
  accentLight: "#EFF6FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chipBorder: "#BFDBFE",
};

const FONT = "'Helvetica Neue', Arial, sans-serif";

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepRow({ number, title, description }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        background: C.accentLight, border: `1.5px solid ${C.chipBorder}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: C.accent, fontFamily: FONT,
        flexShrink: 0, marginTop: 1,
      }}>
        {number}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, marginTop: 2, fontFamily: FONT }}>
          {description}
        </div>
      </div>
    </div>
  );
}

// ─── Logged-in user card ─────────────────────────────────────────────────────

function UserCard({ user, slug }) {
  const firstName = user.name.split(" ")[0];
  const initials = user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div style={{
      background: "#fff", borderRadius: 14, border: `1.5px solid ${C.border}`,
      padding: "20px 22px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 42, height: 42, borderRadius: "50%",
          background: C.accent, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, fontWeight: 700, fontFamily: FONT, flexShrink: 0,
        }}>
          {initials}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
            Welcome back, {firstName}
          </div>
          <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 1 }}>
            {user.email}
          </div>
        </div>
      </div>

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

      <a
        href={`/network?edit=${slug}`}
        style={{
          display: "block", textAlign: "center",
          marginTop: 8,
          padding: "10px 20px",
          background: "transparent", color: C.accent,
          border: `1.5px solid ${C.chipBorder}`,
          borderRadius: 12,
          fontSize: 13, fontWeight: 600,
          fontFamily: FONT, cursor: "pointer",
          textDecoration: "none",
        }}
      >
        Edit Your Recommenders
      </a>
    </div>
  );
}

// ─── Main HomePage ───────────────────────────────────────────────────────────

export default function HomePage() {
  const [user, setUser] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  // Check for existing session on mount
  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error("No session");
      })
      .then(data => setUser(data.user))
      .catch(() => {})
      .finally(() => setSessionChecked(true));
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
      minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT,
      display: "flex", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 900, minHeight: "100vh",
        background: "#F8F4E8", padding: "28px 16px 120px",
      }}>
        {/* Header — pinned 20px from left edge of cream */}
        <div style={{ padding: "0 20px", marginBottom: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5 }}>
              Vouch<span style={{ color: C.accent }}>Four</span>
            </span>
            {sessionChecked && !user && (
              <button
                onClick={() => setLoginOpen(o => !o)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, color: C.accent, fontFamily: FONT,
                  padding: "4px 0",
                }}
              >
                {loginOpen ? "Close" : "Log in"}
              </button>
            )}
          </div>
          <div style={{ fontSize: 15, color: C.sub, lineHeight: 1.6 }}>
            Discover top talent through the people you trust most.
          </div>

          {/* Login expander */}
          {sessionChecked && !user && loginOpen && (
            <div style={{
              marginTop: 14, padding: "16px 18px",
              background: "#fff", borderRadius: 12,
              border: `1.5px solid ${C.border}`,
            }}>
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
                    autoFocus
                    autoComplete="off"
                    style={{
                      flex: 1, padding: "10px 12px",
                      fontSize: 14, border: `1.5px solid ${C.border}`,
                      borderRadius: 8, fontFamily: FONT,
                      color: C.ink, background: "#fff",
                      WebkitAppearance: "none",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!identifier.trim() || sending}
                    style={{
                      padding: "10px 18px",
                      background: identifier.trim() && !sending ? C.accent : "#D1D5DB",
                      color: "#fff", border: "none", borderRadius: 8,
                      fontSize: 13, fontWeight: 600, fontFamily: FONT,
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
          )}
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto" }}>

          {/* Logged-in state */}
          {sessionChecked && user && (
            <div style={{ marginBottom: 32 }}>
              <UserCard user={user} slug={slug} />
            </div>
          )}

          {/* How it works */}
          <div style={{
            background: "#fff", borderRadius: 14, border: `1.5px solid ${C.border}`,
            padding: "20px 22px", marginBottom: 24,
          }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: C.ink,
              textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 16,
              fontFamily: FONT,
            }}>
              How it works
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <StepRow
                number="1"
                title="Choose your recommenders"
                description="Choose up to 10 people you trust most for talent recommendations."
              />
              <StepRow
                number="2"
                title="They vouch for their best"
                description="Each recommender is asked to share up to 4 people they'd vouch for — the top performers they've ever worked with."
              />
              <StepRow
                number="3"
                title="Your talent network appears"
                description="We surface the people most recommended across your trusted network, ranked by connection strength."
              />
            </div>
          </div>

          {/* CTA */}
          {(!sessionChecked || !user) && (
            <div style={{ marginBottom: 24, textAlign: "center" }}>
              <a
                href="/network"
                style={{
                  display: "inline-block",
                  padding: "16px 40px",
                  background: C.accent, color: "#fff",
                  border: "none", borderRadius: 14,
                  fontSize: 17, fontWeight: 700,
                  fontFamily: FONT, cursor: "pointer",
                  textDecoration: "none",
                  boxShadow: "0 4px 16px rgba(37,99,235,0.25)",
                }}
              >
                Build your custom talent network
              </a>
            </div>
          )}

          {/* Why it's different */}
          <div style={{
            background: "#fff", borderRadius: 14, border: `1.5px solid ${C.border}`,
            padding: "20px 22px", marginBottom: 24,
          }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: C.ink,
              textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14,
              fontFamily: FONT,
            }}>
              Why VouchFour?
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 2 }}>
                  Real constraints, real signal
                </div>
                <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, fontFamily: FONT }}>
                  Each person can only vouch for 4 people — so every recommendation means something.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 2 }}>
                  Anonymous recommendations
                </div>
                <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, fontFamily: FONT }}>
                  Recommenders share freely because their individual picks stay private. You see who was recommended, but not by whom.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 2 }}>
                  Your network, not the whole internet
                </div>
                <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, fontFamily: FONT }}>
                  Recommendations come from people you ask — people you actually know and trust.
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <p style={{
            marginTop: 32, fontSize: 11, color: "#78716C",
            lineHeight: 1.5, textAlign: "center", padding: "0 12px",
          }}>
            Built by{" "}
            <a
              href="https://www.linkedin.com/in/joshscott/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#78716C", textDecoration: "underline" }}
            >Josh Scott</a>{" "}
            with significant help from Claude.
          </p>

        </div>
      </div>
    </div>
  );
}
