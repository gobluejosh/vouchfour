import { useState, useEffect, useRef } from "react";
import { gradientForName, initialsForName } from "../lib/avatar.js";

// ─── LinkedIn Search via backend ────────────────────────────────────────────
async function fetchLinkedInProfiles(name) {
  const response = await fetch("/api/lookup-linkedin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json();
  return data.profiles || [];
}

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

// ─── Helpers ────────────────────────────────────────────────────────────────
function capitalizeName(name) {
  return name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function useDebounce(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ─── Step Indicator ──────────────────────────────────────────────────────────
const STEP_GRADIENTS = [
  "linear-gradient(135deg, #6366F1, #8B5CF6)", // indigo → violet
  "linear-gradient(135deg, #F59E0B, #EF4444)", // amber → red
  "linear-gradient(135deg, #10B981, #3B82F6)", // emerald → blue
];

function StepRow({ number, title, description }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        background: STEP_GRADIENTS[number - 1] || STEP_GRADIENTS[0],
        border: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONT,
        flexShrink: 0, marginTop: 1,
        textShadow: "0 1px 2px rgba(0,0,0,0.15)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
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

// ─── Suggestion Chips ───────────────────────────────────────────────────────
function SuggestionChips({ items, onSelect, loading, show }) {
  if (!show) return null;
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              height: 58, borderRadius: 12,
              background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)",
              backgroundSize: "200% 100%",
              animation: `shimmer 1.2s ${i * 0.15}s infinite`,
            }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: "10px 14px", fontSize: 13, color: C.sub, fontFamily: FONT }}>
          No LinkedIn profile suggestions. Please enter it above.
        </div>
      ) : (
        items.map((item, i) => (
          <button key={i} type="button" onClick={() => onSelect(item)} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.06)",
            background: "rgba(255,255,255,0.5)", cursor: "pointer",
            textAlign: "left", width: "100%",
            transition: "all 0.12s", fontFamily: FONT,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={C.accent} style={{ flexShrink: 0 }}>
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: C.ink }}>{item.label}</div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>{item.detail}</div>
            </div>
          </button>
        ))
      )}
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Identity Form ──────────────────────────────────────────────────────────
function IdentityForm({ onComplete }) {
  const [name, setName] = useState("");
  const [linkedinInput, setLinkedinInput] = useState("");
  const [emailInput, setEmailInput] = useState("");

  const [liSuggestions, setLiSuggestions] = useState([]);
  const [liLoading, setLiLoading] = useState(false);
  const [liSearched, setLiSearched] = useState(false);
  const [liConfirmed, setLiConfirmed] = useState(null);
  const [liFaded, setLiFaded] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineCompany, setRefineCompany] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);

  const [step, setStep] = useState("name"); // name | linkedin | email | done
  const nameInputRef = useRef();
  const liInputRef = useRef();
  const emailInputRef = useRef();

  const debouncedName = useDebounce(name, 800);
  const liSearchId = useRef(0);
  const prefetchCache = useRef({});
  const [prefetchStatus, setPrefetchStatus] = useState("idle");

  // Prefetch LinkedIn while user is still on the name step
  useEffect(() => {
    const trimmed = debouncedName.trim();
    if (trimmed.length < 3) { setPrefetchStatus("idle"); return; }
    if (liConfirmed) return;
    if (prefetchCache.current[trimmed]) return;

    const searchId = ++liSearchId.current;
    prefetchCache.current[trimmed] = "__loading__";
    setPrefetchStatus("loading");

    if (step === "linkedin") {
      setLiLoading(true);
      setLiSuggestions([]);
    }

    fetchLinkedInProfiles(trimmed).then(profiles => {
      if (liSearchId.current !== searchId) return;
      prefetchCache.current[trimmed] = profiles;
      setPrefetchStatus("ready");
      setLiSuggestions(profiles);
      setLiLoading(false);
      setLiSearched(true);
    }).catch(() => {
      if (liSearchId.current !== searchId) return;
      prefetchCache.current[trimmed] = [];
      setPrefetchStatus("idle");
      setLiSuggestions([]);
      setLiLoading(false);
      setLiSearched(true);
    });
  }, [debouncedName]);

  useEffect(() => {
    if (!liConfirmed) { setLiFaded(false); return; }
    const t = setTimeout(() => setLiFaded(true), 2000);
    return () => clearTimeout(t);
  }, [liConfirmed]);

  function handleNameNext() {
    if (!name.trim()) return;
    const trimmed = name.trim();
    const cached = prefetchCache.current[trimmed];

    if (cached && cached !== "__loading__") {
      setLiSuggestions(cached);
      setLiLoading(false);
      setLiSearched(true);
    } else if (cached === "__loading__") {
      setLiSuggestions([]);
      setLiLoading(true);
    } else {
      setLiSuggestions([]);
      setLiLoading(true);
      const searchId = ++liSearchId.current;
      fetchLinkedInProfiles(trimmed).then(profiles => {
        if (liSearchId.current !== searchId) return;
        prefetchCache.current[trimmed] = profiles;
        setLiSuggestions(profiles);
        setLiLoading(false);
      }).catch(() => {
        if (liSearchId.current !== searchId) return;
        setLiSuggestions([]);
        setLiLoading(false);
      });
    }

    setStep("linkedin");
    setTimeout(() => liInputRef.current?.focus(), 100);
  }

  function handleLinkedInSelect(item) {
    setLiConfirmed(item);
    setLinkedinInput(item.url);
    setLiSuggestions([]);
    setStep("email");
    setTimeout(() => emailInputRef.current?.focus(), 100);
  }

  function handleManualLinkedin() {
    if (!linkedinInput.trim()) return;
    setLiConfirmed({ label: name.trim(), detail: linkedinInput.trim(), url: linkedinInput.trim() });
    setLiSuggestions([]);
    setStep("email");
    setTimeout(() => emailInputRef.current?.focus(), 100);
  }

  function handleRefineSearch() {
    if (!refineCompany.trim()) return;
    const searchId = ++liSearchId.current;
    setRefineLoading(true);
    setLiLoading(true);
    setLiSuggestions([]);
    fetchLinkedInProfiles(`${name.trim()} ${refineCompany.trim()}`).then(profiles => {
      if (liSearchId.current !== searchId) return;
      setLiSuggestions(profiles);
      setLiLoading(false);
      setRefineLoading(false);
      setRefineOpen(false);
    }).catch(() => {
      if (liSearchId.current !== searchId) return;
      setLiSuggestions([]);
      setLiLoading(false);
      setRefineLoading(false);
    });
  }

  function handleDone() {
    if (!name.trim() || !linkedinInput.trim() || !emailInput.trim()) return;
    setStep("done");
    onComplete({ name: capitalizeName(name), linkedin: linkedinInput.trim(), email: emailInput.trim() });
  }

  const liShowSuggestions = step === "linkedin" && !liConfirmed && (liLoading || liSuggestions.length > 0 || liSearched);

  return (
    <div style={{
      position: "relative",
      borderRadius: 18, padding: 2,
      background: "linear-gradient(135deg, #6366F1, #EC4899)",
      boxShadow: "0 12px 40px rgba(99,102,241,0.20), 0 4px 16px rgba(236,72,153,0.12)",
    }}>
    <div style={{
      borderRadius: 16, padding: "20px 18px",
      background: "#fff",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Heading */}
        <div>
          <div style={{
            fontSize: 18, fontWeight: 700, color: "#1E1B4B",
            lineHeight: 1.3, fontFamily: FONT, marginBottom: 4,
          }}>
            Build your trusted talent network
          </div>
        </div>

        {/* NAME */}
        <div>
          <label style={labelStyle}>What's your name?</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={nameInputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleNameNext()}
              placeholder="e.g. Sarah Johnson"
              autoComplete="off"
              style={{
                ...inputStyle,
                flex: 1,
                background: step !== "name" ? C.cardDone : "#fff",
                color: step !== "name" ? C.sub : C.ink,
              }}
            />
            {step === "name" && (
              <button type="button" onClick={handleNameNext} disabled={!name.trim()} style={nextBtnStyle(!!name.trim())}>
                Next →
              </button>
            )}
            {step !== "name" && (
              <button type="button" onClick={() => { setStep("name"); setLiConfirmed(null); setLiSearched(false); setLiSuggestions([]); }} style={editBtnStyle}>
                Edit
              </button>
            )}
          </div>
          {step === "name" && prefetchStatus === "loading" && (
            <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 6, paddingLeft: 2 }}>
              <span style={{
                width: 10, height: 10, borderRadius: "50%",
                border: `1.5px solid ${C.accentSub}`,
                borderTop: `1.5px solid ${C.accent}`,
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, color: C.sub, fontFamily: FONT }}>Finding LinkedIn profiles…</span>
            </div>
          )}
          {step === "name" && prefetchStatus === "ready" && (
            <div style={{ marginTop: 7, paddingLeft: 2 }}>
              <span style={{ fontSize: 12, color: C.success, fontFamily: FONT }}>✓ Profiles ready — tap Next</span>
            </div>
          )}
        </div>

        {/* LINKEDIN */}
        {(step === "linkedin" || step === "email" || step === "done") && (
          <div>
            <label style={labelStyle}>LinkedIn profile</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={liInputRef}
                value={linkedinInput}
                onChange={e => { setLinkedinInput(e.target.value); setLiConfirmed(null); }}
                onKeyDown={e => e.key === "Enter" && linkedinInput.trim() && !liConfirmed && step === "linkedin" && handleManualLinkedin()}
                placeholder="Select below or paste a URL"
                autoComplete="off"
                style={{
                  ...inputStyle,
                  flex: 1,
                  background: liConfirmed && !liFaded ? C.successLight : "#fff",
                  borderColor: liConfirmed && !liFaded ? "#86EFAC" : C.border,
                  color: liConfirmed ? (liFaded ? C.sub : C.success) : C.ink,
                  fontSize: liConfirmed ? 13 : 15,
                  transition: "background 0.8s ease, border-color 0.8s ease, color 0.8s ease",
                }}
              />
              {step === "linkedin" && !liConfirmed && linkedinInput.trim() && (
                <button type="button" onClick={handleManualLinkedin} style={nextBtnStyle(true)}>
                  Next →
                </button>
              )}
            </div>
            {liConfirmed && (
              <div style={{
                marginTop: 5, fontSize: 12, fontFamily: FONT, fontWeight: 500,
                color: liFaded ? C.sub : C.success,
                transition: "color 0.8s ease",
              }}>
                ✓ {liConfirmed.detail}
              </div>
            )}
            <SuggestionChips
              show={liShowSuggestions}
              loading={liLoading}
              items={liSuggestions}
              onSelect={handleLinkedInSelect}
            />

            {/* Refine search */}
            {step === "linkedin" && !liConfirmed && !liLoading && liSuggestions.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {!refineOpen ? (
                  <button
                    type="button"
                    onClick={() => setRefineOpen(true)}
                    style={{
                      background: "none", border: "none", padding: "4px 0",
                      fontSize: 13, color: C.sub, fontFamily: FONT,
                      cursor: "pointer", textDecoration: "underline",
                      textDecorationStyle: "dotted", textUnderlineOffset: 3,
                    }}
                  >
                    Not seeing the right person?
                  </button>
                ) : (
                  <div style={{
                    padding: "12px 14px",
                    background: "rgba(255,255,255,0.4)",
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 12,
                    display: "flex", flexDirection: "column", gap: 10,
                  }}>
                    <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT }}>
                      Add your company or title to narrow results:
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        autoFocus
                        value={refineCompany}
                        onChange={e => setRefineCompany(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleRefineSearch()}
                        placeholder="e.g. Acme Corp, or CEO"
                        style={{ ...inputStyle, flex: 1, fontSize: 14, padding: "10px 12px" }}
                      />
                      <button
                        type="button"
                        onClick={handleRefineSearch}
                        disabled={!refineCompany.trim() || refineLoading}
                        style={{
                          ...nextBtnStyle(!!refineCompany.trim() && !refineLoading),
                          padding: "10px 16px", fontSize: 14,
                        }}
                      >
                        {refineLoading ? "…" : "Search"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setRefineOpen(false); setRefineCompany(""); }}
                      style={{
                        background: "none", border: "none", padding: 0,
                        fontSize: 12, color: C.sub, fontFamily: FONT,
                        cursor: "pointer", textAlign: "left",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* EMAIL */}
        {(step === "email" || step === "done") && (
          <div>
            <label style={labelStyle}>Email address</label>
            <input
              ref={emailInputRef}
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleDone()}
              placeholder="your@email.com"
              autoComplete="off"
              inputMode="email"
              style={inputStyle}
            />
            {step === "email" && (
              <button
                type="button"
                onClick={handleDone}
                disabled={!linkedinInput.trim() || !emailInput.trim()}
                style={{
                  ...nextBtnStyle(!!linkedinInput.trim() && !!emailInput.trim()),
                  width: "100%",
                  marginTop: 14,
                  padding: "14px",
                  fontSize: 16,
                  borderRadius: 12,
                  justifyContent: "center",
                }}
              >
                Get Started →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

// ─── Shared Styles ──────────────────────────────────────────────────────────
const labelStyle = {
  display: "block", fontSize: 13, fontWeight: 600,
  color: "#3730A3", marginBottom: 6, fontFamily: FONT,
};

const inputStyle = {
  width: "100%", padding: "12px 14px",
  fontSize: 16, border: `1.5px solid ${C.border}`,
  borderRadius: 10, fontFamily: FONT,
  color: "#171717", background: "#fff",
  transition: "border-color 0.15s, box-shadow 0.15s",
  WebkitAppearance: "none",
  boxSizing: "border-box",
};

const nextBtnStyle = (enabled) => ({
  display: "inline-flex", alignItems: "center",
  padding: "12px 18px",
  background: enabled ? "#4F46E5" : "#C7D2FE",
  color: "#fff", border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 600, fontFamily: FONT,
  cursor: enabled ? "pointer" : "not-allowed",
  whiteSpace: "nowrap", flexShrink: 0,
  transition: "background 0.15s",
});

const editBtnStyle = {
  display: "inline-flex", alignItems: "center",
  padding: "12px 14px",
  background: "#F5F5F4", color: "#78716C",
  border: "none", borderRadius: 10,
  fontSize: 13, fontFamily: FONT, cursor: "pointer",
  flexShrink: 0,
};

// ─── Logged-in user card ─────────────────────────────────────────────────────

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
            style={{
              flex: 1, padding: "10px 14px",
              fontSize: 16, fontFamily: FONT,
              color: C.ink, background: "#F9FAFB",
              border: `1.5px solid ${C.border}`,
              borderRadius: 10,
              WebkitAppearance: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={e => { e.target.style.borderColor = C.accent; }}
            onBlur={e => { e.target.style.borderColor = C.border; }}
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
  const [loginOpen, setLoginOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [identitySubmitting, setIdentitySubmitting] = useState(false);

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

  async function handleIdentityComplete(identity) {
    setIdentitySubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identity),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      sessionStorage.setItem("vouchfour_personId", String(data.personId));
      sessionStorage.setItem("vouchfour_firstName", identity.name.split(" ")[0]);
      window.location.href = "/start-vouch";
    } catch (err) {
      setError(err.message);
      setIdentitySubmitting(false);
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 0 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5 }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </span>
          {!user && (
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
        <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.6, marginLeft: 10 }}>
          Not Connections. Trusted Recommendations.
        </div>
      </div>

      <div style={{
        width: "100%", maxWidth: 900,
        background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px",
        borderRadius: 0, margin: "80px 0 0",
      }}>
        {/* Header */}
        <div style={{ padding: "12px 4px 0", marginBottom: 40 }}>

          {/* Login expander */}
          {!user && loginOpen && (
            <div style={{
              marginTop: 14, padding: "16px 18px",
              background: "rgba(255,255,255,0.7)", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.4)",
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
                      fontSize: 16, border: `1.5px solid ${C.border}`,
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

          {/* Identity form for logged-out users */}
          {!user && (
            <div style={{ marginBottom: 32 }}>
              <IdentityForm onComplete={handleIdentityComplete} />
              {identitySubmitting && (
                <div style={{ marginTop: 16, fontSize: 14, color: C.sub, fontFamily: FONT, textAlign: "center" }}>
                  Setting things up…
                </div>
              )}
              {error && !loginOpen && (
                <div style={{
                  marginTop: 16, padding: "10px 14px", borderRadius: 8,
                  background: "#FEF2F2", border: "1.5px solid #FCA5A5",
                  fontSize: 13, color: "#991B1B",
                }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {/* How it works */}
          <div style={{
            background: "linear-gradient(135deg, #ECFDF5 0%, #DBEAFE 100%)",
            borderRadius: 14, border: "1px solid rgba(255,255,255,0.4)",
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
                title="Vouch for your top 4 colleagues"
                description="Pick a job function and name your 4 all-time best colleagues in that field."
              />
              <StepRow
                number="2"
                title="They vouch for their top 4"
                description="Each person you vouch for is invited to name their own top 4."
              />
              <StepRow
                number="3"
                title="Access expertise. Find top talent."
                description="Discover the people your trusted colleagues say are the best at what they do."
              />
            </div>
          </div>

          {/* Why it's different */}
          <div style={{
            background: "linear-gradient(135deg, #FDE6D0 0%, #D4F0E0 100%)",
            borderRadius: 14, border: "1px solid rgba(255,255,255,0.4)",
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
                  Each person can only vouch for 4 people — so you can be confident that they really know and trust the people they pick.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 2 }}>
                  Confidential vouches
                </div>
                <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, fontFamily: FONT }}>
                  People vouch freely because their individual picks stay private. You see who was vouched for, but not by whom.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 2 }}>
                  Your network, not the whole internet
                </div>
                <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, fontFamily: FONT }}>
                  Every result traces back to someone you personally vouched for. No strangers, no algorithms.
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <p style={{
            marginTop: 32, fontSize: 11, color: "#7C6FA0",
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
