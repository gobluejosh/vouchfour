import { useState, useEffect } from "react";

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

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
        .then(data => {
          setUser(data.user);
        })
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
        width: "100%",
        background: "#FFFFFF",
        padding: "12px 20px",
      }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5 }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </span>
      </div>

      <div style={{
        width: "100%",
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
              padding: "36px 20px 32px", overflow: "hidden",
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
                  <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      value={identifier}
                      onChange={e => setIdentifier(e.target.value)}
                      placeholder="Email or LinkedIn URL"
                      autoComplete="off"
                      style={{
                        width: "100%", padding: "12px 14px",
                        fontSize: 16, border: `1.5px solid ${C.border}`,
                        borderRadius: 10, fontFamily: FONT,
                        color: C.ink, background: "#fff",
                        WebkitAppearance: "none", boxSizing: "border-box",
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!identifier.trim() || sending}
                      style={{
                        width: "100%", padding: "12px 20px",
                        background: identifier.trim() && !sending ? C.accent : "#A5B4FC",
                        color: "#fff", border: "none", borderRadius: 10,
                        fontSize: 14, fontWeight: 600, fontFamily: FONT,
                        cursor: identifier.trim() && !sending ? "pointer" : "not-allowed",
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

          {/* Logged-in — redirect to talent network */}
          {sessionChecked && user && slug && (() => {
            window.location.href = `/talent/${slug}`;
            return null;
          })()}


        </div>
      </div>
    </div>
  );
}
