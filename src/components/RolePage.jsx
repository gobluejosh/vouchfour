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

const LEVELS = ["C-Level", "VP-Level", "Dir-Level", "Mgr-Level", "IC-Level"];

function Avatar({ name, size = 34 }) {
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
          we've sent you a login link. It may take a moment to arrive.
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 48 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
        Sign in to continue
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

export default function RolePage() {
  const [authState, setAuthState] = useState("checking");
  const [user, setUser] = useState(null);
  const [slug, setSlug] = useState("");

  // Form state
  const [connectors, setConnectors] = useState([]);
  const [loadingConnectors, setLoadingConnectors] = useState(false);
  const [jobFunction, setJobFunction] = useState("");
  const [level, setLevel] = useState("");
  const [specialSkills, setSpecialSkills] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedConnectors, setSubmittedConnectors] = useState([]);

  // Auth flow
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("token");

    if (loginToken) {
      fetch(`/api/auth/validate?token=${loginToken}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (data.user) {
            setUser(data.user);
            setAuthState("authenticated");
            const match = data.user.linkedin?.match(/\/in\/([^/]+)/);
            if (match) setSlug(match[1]);
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
        .then(data => {
          setUser(data.user);
          setAuthState("authenticated");
          const match = data.user.linkedin?.match(/\/in\/([^/]+)/);
          if (match) setSlug(match[1]);
        })
        .catch(() => setAuthState("unauthenticated"));
    }
  }, []);

  // Fetch connectors once authenticated
  useEffect(() => {
    if (authState !== "authenticated" || !slug) return;
    setLoadingConnectors(true);
    fetch(`/api/talent/${slug}`, { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then(data => {
        setConnectors(data.networkStatus?.connectors || []);
      })
      .catch(() => {})
      .finally(() => setLoadingConnectors(false));
  }, [authState, slug]);

  function toggleRecommender(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/create-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          jobFunction: jobFunction.trim(),
          level,
          specialSkills: specialSkills.trim() || null,
          recommenderIds: [...selectedIds],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create role");

      setSubmittedConnectors(connectors.filter(c => selectedIds.has(c.id)));
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = jobFunction.trim() && level && selectedIds.size > 0 && !submitting;

  // ─── Waiting state (after submission) ──────────────────────────────

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 900, minHeight: "100vh", background: "#F8F4E8", padding: "28px 16px 120px" }}>
          <div style={{ padding: "0 20px", marginBottom: 32 }}>
            <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
              Vouch<span style={{ color: C.accent }}>Four</span>
            </a>
          </div>

          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.ink, marginBottom: 12, lineHeight: 1.3 }}>
              Emails sent!
            </div>
            <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, marginBottom: 28 }}>
              We're reaching out to the recommenders below asking for their top talent picks
              for your <strong style={{ color: C.ink }}>{jobFunction}</strong> ({level}) search.
              We'll email you when enough responses are in and your results are ready.
            </p>

            <div style={{
              background: "#FFFFFF", borderRadius: 14, border: `1.5px solid ${C.border}`,
              padding: "16px 18px", marginBottom: 28,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Selected recommenders
              </div>
              {submittedConnectors.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 0",
                  borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                }}>
                  <Avatar name={c.name} size={34} />
                  <div style={{ flex: 1, fontSize: 14, color: C.ink, fontFamily: FONT }}>{c.name}</div>
                  <div style={{
                    fontSize: 11, color: C.warn, fontWeight: 600,
                    background: "#FFFBEB", padding: "3px 8px", borderRadius: 6,
                  }}>
                    Pending
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              background: C.accentLight, borderRadius: 12, padding: "14px 16px",
              border: `1px solid ${C.chipBorder}`,
            }}>
              <div style={{ fontSize: 13, color: C.accent, fontWeight: 600, marginBottom: 4 }}>
                What happens next?
              </div>
              <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, margin: 0 }}>
                Each selected recommender will receive an email asking them to recommend talent
                for this role. We'll email you at <strong style={{ color: C.ink }}>{user?.email}</strong> when
                your results are ready.
              </p>
            </div>

            {slug && (
              <a
                href={`/talent/${slug}`}
                style={{
                  display: "block", textAlign: "center",
                  marginTop: 24, fontSize: 14, color: C.accent,
                  fontWeight: 600, fontFamily: FONT, textDecoration: "none",
                }}
              >
                Back to your talent network
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Main page ─────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 900, minHeight: "100vh", background: "#F8F4E8", padding: "28px 16px 120px" }}>
        <div style={{ padding: "0 20px", marginBottom: 24 }}>
          <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </a>
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto" }}>

          {/* Auth checking */}
          {authState === "checking" && (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 15, color: C.sub }}>Loading...</div>
            </div>
          )}

          {/* Unauthenticated */}
          {authState === "unauthenticated" && <LoginPrompt />}

          {/* Authenticated — loading connectors */}
          {authState === "authenticated" && loadingConnectors && (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 15, color: C.sub }}>Loading your network...</div>
            </div>
          )}

          {/* Authenticated — form */}
          {authState === "authenticated" && !loadingConnectors && (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 20, lineHeight: 1.3 }}>
                Get talent recommendations for a specific role
              </div>

              {/* Role form */}
              <div style={{
                background: "#FFFFFF", borderRadius: 14, border: `1.5px solid ${C.border}`,
                padding: "20px 18px", marginBottom: 20,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 14, fontFamily: FONT }}>
                  Tell us about the role
                </div>

                {/* Job Function */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{
                    display: "block", fontSize: 12, fontWeight: 600,
                    color: "#44403C", marginBottom: 4, fontFamily: FONT,
                  }}>
                    Job Function
                  </label>
                  <input
                    value={jobFunction}
                    onChange={e => setJobFunction(e.target.value)}
                    placeholder="e.g. Product Manager, Software Engineer"
                    autoComplete="off"
                    style={{
                      width: "100%", padding: "10px 12px",
                      fontSize: 14, border: `1.5px solid ${C.border}`,
                      borderRadius: 8, fontFamily: FONT,
                      color: C.ink, background: "#fff",
                      WebkitAppearance: "none", boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Level */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{
                    display: "block", fontSize: 12, fontWeight: 600,
                    color: "#44403C", marginBottom: 4, fontFamily: FONT,
                  }}>
                    Level
                  </label>
                  <select
                    value={level}
                    onChange={e => setLevel(e.target.value)}
                    style={{
                      width: "100%", padding: "10px 12px",
                      fontSize: 14, border: `1.5px solid ${C.border}`,
                      borderRadius: 8, fontFamily: FONT,
                      color: level ? C.ink : C.sub, background: "#fff",
                      WebkitAppearance: "none", boxSizing: "border-box",
                      cursor: "pointer",
                    }}
                  >
                    <option value="" disabled>Select level</option>
                    {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>

                {/* Special Skills */}
                <div>
                  <label style={{
                    display: "block", fontSize: 12, fontWeight: 600,
                    color: "#44403C", marginBottom: 4, fontFamily: FONT,
                  }}>
                    Special Skills <span style={{ fontWeight: 400, color: C.sub }}>(optional)</span>
                  </label>
                  <input
                    value={specialSkills}
                    onChange={e => setSpecialSkills(e.target.value.slice(0, 100))}
                    placeholder="e.g. AI/ML experience, B2B SaaS"
                    maxLength={100}
                    autoComplete="off"
                    style={{
                      width: "100%", padding: "10px 12px",
                      fontSize: 14, border: `1.5px solid ${C.border}`,
                      borderRadius: 8, fontFamily: FONT,
                      color: C.ink, background: "#fff",
                      WebkitAppearance: "none", boxSizing: "border-box",
                    }}
                  />
                  <div style={{ textAlign: "right", fontSize: 11, color: C.sub, marginTop: 2 }}>
                    {specialSkills.length}/100
                  </div>
                </div>
              </div>

              {/* Recommender selection */}
              <div style={{
                background: "#FFFFFF", borderRadius: 14, border: `1.5px solid ${C.border}`,
                padding: "20px 18px", marginBottom: 20,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4, fontFamily: FONT }}>
                  Who do you want recommendations from for this role?
                </div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 14, fontFamily: FONT }}>
                  Select the recommenders you'd like to ask
                </div>

                {connectors.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.sub, padding: "12px 0" }}>
                    No recommenders found. You need to <a href="/network" style={{ color: C.accent }}>build your network</a> first.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {connectors.map((c, i) => (
                      <label
                        key={c.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 0",
                          borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleRecommender(c.id)}
                          style={{ width: 18, height: 18, accentColor: C.accent, cursor: "pointer", flexShrink: 0 }}
                        />
                        <Avatar name={c.name} size={30} />
                        <div style={{ flex: 1, fontSize: 14, color: C.ink, fontFamily: FONT }}>{c.name}</div>
                        {c.status === "completed" ? (
                          <div style={{
                            fontSize: 10, color: C.success, fontWeight: 600,
                            background: C.successLight, padding: "2px 6px", borderRadius: 4,
                          }}>
                            Active
                          </div>
                        ) : (
                          <div style={{
                            fontSize: 10, color: C.warn, fontWeight: 600,
                            background: "#FFFBEB", padding: "2px 6px", borderRadius: 4,
                          }}>
                            Pending
                          </div>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit error */}
              {submitError && (
                <div style={{
                  padding: "12px 16px", marginBottom: 12,
                  background: "#FEF2F2", border: "1px solid #FECACA",
                  borderRadius: 10, fontSize: 13, color: "#DC2626",
                  fontFamily: FONT,
                }}>
                  {submitError}
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                  width: "100%", padding: "14px",
                  background: canSubmit ? C.accent : "#D1D5DB",
                  color: "#fff", border: "none", borderRadius: 12,
                  fontSize: 16, fontWeight: 700, fontFamily: FONT,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {submitting ? "Sending..." : "Send to recommenders"}
              </button>

              {slug && (
                <a
                  href={`/talent/${slug}`}
                  style={{
                    display: "block", textAlign: "center",
                    marginTop: 16, fontSize: 13, color: C.accent,
                    fontWeight: 600, fontFamily: FONT, textDecoration: "none",
                  }}
                >
                  Back to your talent network
                </a>
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
