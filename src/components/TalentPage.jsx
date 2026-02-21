import { useState, useEffect } from "react";

const C = {
  ink: "#1C1917",
  sub: "#78716C",
  accent: "#2563EB",
  accentLight: "#EFF6FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  warn: "#D97706",
  chipBorder: "#BFDBFE",
};

const FONT = "'Helvetica Neue', Arial, sans-serif";

const DEGREE_LABELS = { 1: "1st", 2: "2nd", 3: "3rd" };
const DEGREE_COLORS = {
  1: { bg: "#F0FDF4", border: "#86EFAC", badge: "#16A34A" },
  2: { bg: "#EFF6FF", border: "#93C5FD", badge: "#2563EB" },
  3: { bg: "#FFF7ED", border: "#FDBA74", badge: "#EA580C" },
};

function Avatar({ name, size = 38 }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: C.accent, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, fontFamily: FONT,
      flexShrink: 0,
    }}>{initials}</div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function TalentCard({ talent }) {
  const colors = DEGREE_COLORS[talent.degree] || DEGREE_COLORS[3];
  const count = Number(talent.recommendation_count);
  const recText = count === 1
    ? "Recommended by 1 person in your network"
    : `Recommended by ${count} people in your network`;

  return (
    <a
      href={talent.linkedin_url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px", background: colors.bg,
        borderRadius: 12, border: `1.5px solid ${colors.border}`,
        textDecoration: "none", cursor: "pointer",
        transition: "box-shadow 0.15s",
      }}
    >
      <Avatar name={talent.display_name} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: C.ink, fontFamily: FONT }}>{talent.display_name}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#fff",
            background: colors.badge, borderRadius: 4,
            padding: "1px 5px", letterSpacing: 0.3,
          }}>
            {DEGREE_LABELS[talent.degree]}
          </span>
        </div>
        <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 2 }}>
          {recText}
        </div>
      </div>
      <ExternalLinkIcon />
    </a>
  );
}

function NetworkStatusCard({ networkStatus, slug }) {
  const { total, completed, connectors } = networkStatus;
  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, border: `1.5px solid ${C.border}`,
      padding: "16px 18px", marginTop: 24,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
          {completed} of {total} recommender{total !== 1 ? "s" : ""} ha{completed !== 1 ? "ve" : "s"} responded
        </div>
        <a
          href={`/network?edit=${slug}`}
          style={{
            fontSize: 12, color: C.accent, fontWeight: 600,
            textDecoration: "none", fontFamily: FONT,
          }}
        >
          Edit
        </a>
      </div>
      {connectors.map((c, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 0",
          borderTop: i > 0 ? `1px solid ${C.border}` : "none",
        }}>
          <Avatar name={c.name} size={30} />
          <div style={{ flex: 1, fontSize: 14, color: C.ink, fontFamily: FONT }}>{c.name}</div>
          {c.status === "completed" ? (
            <div style={{
              fontSize: 11, color: C.success, fontWeight: 600,
              background: C.successLight, padding: "3px 8px", borderRadius: 6,
            }}>
              Responded
            </div>
          ) : (
            <div style={{
              fontSize: 11, color: C.warn, fontWeight: 600,
              background: "#FFFBEB", padding: "3px 8px", borderRadius: 6,
            }}>
              Pending
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

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
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div style={{ textAlign: "center", paddingTop: 60 }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>
          Check your email
        </div>
        <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6 }}>
          If we found an account matching <strong style={{ color: C.ink }}>{identifier}</strong>,
          we've sent you a login link. It may take a moment to arrive.
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 48 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
        Access your talent network
      </div>
      <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5, marginBottom: 20 }}>
        Enter your email address or LinkedIn URL to receive a login link.
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
            background: identifier.trim() && !sending ? C.accent : "#D1D5DB",
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
        <div style={{ marginTop: 10, fontSize: 13, color: "#DC2626", fontFamily: FONT }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default function TalentPage() {
  const slug = window.location.pathname.split("/talent/")[1] || "";

  const [authState, setAuthState] = useState("checking"); // checking | unauthenticated | authenticated
  const [user, setUser] = useState(null);
  const [talent, setTalent] = useState([]);
  const [networkStatus, setNetworkStatus] = useState(null);
  const [myVouches, setMyVouches] = useState([]);
  const [vouchToken, setVouchToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Auth flow on mount
  useEffect(() => {
    if (!slug) {
      setError("No user specified");
      setAuthState("unauthenticated");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("token");

    if (loginToken) {
      // Validate magic link token
      fetch(`/api/auth/validate?token=${loginToken}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (data.user) {
            setUser(data.user);
            setAuthState("authenticated");
            // Clean URL (remove token param)
            window.history.replaceState({}, "", window.location.pathname);
          } else {
            setAuthState("unauthenticated");
          }
        })
        .catch(() => setAuthState("unauthenticated"));
    } else {
      // Check existing session
      fetch("/api/auth/session", { credentials: "include" })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error("No session");
        })
        .then(data => {
          setUser(data.user);
          setAuthState("authenticated");
        })
        .catch(() => setAuthState("unauthenticated"));
    }
  }, [slug]);

  // Fetch talent data once authenticated
  useEffect(() => {
    if (authState !== "authenticated" || !slug) return;

    setLoading(true);
    fetch(`/api/talent/${slug}`, { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then(data => {
        setTalent(data.talent || []);
        setNetworkStatus(data.networkStatus || null);
        setMyVouches(data.myVouches || []);
        setVouchToken(data.vouchToken || null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [authState, slug]);

  const firstName = user?.name?.split(" ")[0] || "";

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 900, minHeight: "100vh", background: "#F8F4E8", padding: "28px 16px 120px" }}>
        {/* Header */}
        <div style={{ padding: "0 20px", marginBottom: 24 }}>
          <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </a>
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto" }}>

          {/* Checking auth */}
          {authState === "checking" && (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 15, color: C.sub }}>Loading...</div>
            </div>
          )}

          {/* Unauthenticated — show login prompt */}
          {authState === "unauthenticated" && !error && (
            <LoginPrompt />
          )}

          {/* Authenticated — loading talent data */}
          {authState === "authenticated" && loading && (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 15, color: C.sub }}>Loading your talent network...</div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 8 }}>Something went wrong</div>
              <div style={{ fontSize: 14, color: C.sub }}>{error}</div>
            </div>
          )}

          {/* Authenticated — talent network */}
          {authState === "authenticated" && !loading && !error && (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 20, lineHeight: 1.3 }}>
                Hi {firstName}, here's your custom talent network based on responses as of now from your trusted recommenders
              </div>

              {/* Empty state */}
              {talent.length === 0 && (
                <div style={{
                  background: C.accentLight, borderRadius: 12, padding: "16px 18px",
                  border: `1px solid ${C.chipBorder}`,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>
                    No recommendations yet
                  </div>
                  <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, margin: 0 }}>
                    Your talent network is still being built. Recommendations will appear here
                    as people in your network vouch for talent.
                  </p>
                </div>
              )}

              {/* Talent list */}
              {talent.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {talent.map((t) => (
                    <TalentCard key={t.id} talent={t} />
                  ))}
                </div>
              )}

              {/* Network status — below talent list */}
              {networkStatus && networkStatus.connectors.length > 0 && (
                <NetworkStatusCard networkStatus={networkStatus} slug={slug} />
              )}

              {/* Your vouches */}
              {myVouches.length > 0 && (
                <div style={{
                  background: C.accentLight, borderRadius: 14, border: `1.5px solid ${C.chipBorder}`,
                  padding: "16px 18px", marginTop: 24,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.accent, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Your vouches
                    </div>
                    {vouchToken && (
                      <a
                        href={`/vouch?token=${vouchToken}`}
                        style={{
                          fontSize: 12, color: C.accent, fontWeight: 600,
                          textDecoration: "none", fontFamily: FONT,
                          background: "#fff", padding: "4px 12px", borderRadius: 6,
                          border: `1px solid ${C.chipBorder}`,
                        }}
                      >
                        Update
                      </a>
                    )}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                    {myVouches.map((v, i) => (
                      <div key={i} style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        padding: "6px 12px 6px 6px",
                        background: "#fff", borderRadius: 20,
                        border: `1px solid ${C.chipBorder}`,
                      }}>
                        <Avatar name={v.name} size={24} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: C.ink, fontFamily: FONT }}>{v.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Footer */}
          <p style={{
            marginTop: 40, fontSize: 11, color: "#78716C",
            lineHeight: 1.5, textAlign: "center", padding: "0 12px",
          }}>
            This tool was built by{" "}
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
