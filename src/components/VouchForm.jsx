import { useState, useEffect, useRef, useCallback } from "react";

// ─── Email Finder via backend ────────────────────────────────────────────────
async function fetchEmailSuggestions(fullName, linkedinUrl, linkedinDetail, { braveOnly = false } = {}) {
  const response = await fetch("/api/find-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, linkedinUrl, detail: linkedinDetail, braveOnly }),
  });

  const data = await response.json();
  console.log(`[Email] Results (${data.source || 'unknown'}):`, data.emails);
  return { emails: (data.emails || []).slice(0, 3), source: data.source || 'unknown' };
}

// ─── LinkedIn Search via backend proxy → Claude API + web search ─────────────
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
  bg: "#F7F5F2",
  card: "#FFFFFF",
  cardDone: "#FAFAF9",
  ink: "#1C1917",
  sub: "#78716C",
  border: "#E7E5E0",
  accent: "#2563EB",
  accentLight: "#EFF6FF",
  accentSub: "#93C5FD",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chip: "#F0F4FF",
  chipBorder: "#BFDBFE",
  warn: "#D97706",
};

const FONT = "'Helvetica Neue', Arial, sans-serif";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function useDebounce(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function Avatar({ name, size = 36 }) {
  const initials = name.split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();
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

// ─── Suggestion Chips ────────────────────────────────────────────────────────
function SuggestionChips({ items, onSelect, loading, show, type }) {
  if (!show) return null;
  return (
    <div style={{
      marginTop: 8,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              height: 58, borderRadius: 12,
              background: "linear-gradient(90deg, #f0ede9 25%, #e8e4df 50%, #f0ede9 75%)",
              backgroundSize: "200% 100%",
              animation: `shimmer 1.2s ${i * 0.15}s infinite`,
            }} />
          ))}
        </div>
      ) : type === "linkedin" ? (
        items.length === 0 ? (
          <div style={{ padding: "10px 14px", fontSize: 13, color: C.sub, fontFamily: FONT }}>
            No profiles found — try adding their company name.
          </div>
        ) : (
          items.map((item, i) => (
            <button key={i} onClick={() => onSelect(item)} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderRadius: 12,
              border: `1.5px solid ${C.chipBorder}`,
              background: C.chip, cursor: "pointer",
              textAlign: "left", width: "100%",
              transition: "all 0.12s",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill={C.accent} style={{ flexShrink: 0 }}>
                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
              </svg>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.ink, fontFamily: FONT }}>{item.label}</div>
                <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 1 }}>{item.detail}</div>
              </div>
            </button>
          ))
        )
      ) : items.length === 0 ? (
        <div style={{ padding: "8px 2px", fontSize: 13, color: C.sub, fontFamily: FONT }}>
          Couldn't find a suggested email — type it in above.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {items.map((item, i) => (
            <button key={i} onClick={() => onSelect(item)} style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 14px", borderRadius: 20,
              border: `1.5px solid ${C.chipBorder}`,
              background: C.chip, cursor: "pointer",
              fontFamily: FONT, fontSize: 13, fontWeight: 500, color: C.ink,
              whiteSpace: "nowrap",
            }}>
              <span>{item.email}</span>
              <span style={{ fontSize: 11, color: C.sub, fontWeight: 400 }}>{item.confidence}%</span>
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}

// ─── Single Contact Form ─────────────────────────────────────────────────────
function SingleContactForm({ index, onComplete }) {
  const [name, setName] = useState("");
  const [linkedinInput, setLinkedinInput] = useState("");
  const [emailInput, setEmailInput] = useState("");

  const [liSuggestions, setLiSuggestions] = useState([]);
  const [liLoading, setLiLoading] = useState(false);
  const [liSearched, setLiSearched] = useState(false);
  const [liConfirmed, setLiConfirmed] = useState(null); // {url, label, detail}
  const [liFaded, setLiFaded] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineCompany, setRefineCompany] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);

  const [emailSuggestions, setEmailSuggestions] = useState([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSearched, setEmailSearched] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(null);
  const [emailLoadingMsg, setEmailLoadingMsg] = useState(""); // progressive status

  const [step, setStep] = useState("name"); // name | linkedin | email | done
  const nameInputRef = useRef();
  const liInputRef = useRef();
  const emailInputRef = useRef();

  const debouncedName = useDebounce(name, 800);
  const liSearchId = useRef(0);
  const prefetchCache = useRef({});
  const emailSearchId = useRef(0);
  const [prefetchStatus, setPrefetchStatus] = useState("idle"); // idle | loading | ready

  // Prefetch LinkedIn while user is still on the name step.
  // Fires as soon as name is 3+ chars and stable for 800ms.
  // Result is cached so the LinkedIn step can show it instantly.
  useEffect(() => {
    const trimmed = debouncedName.trim();
    if (trimmed.length < 3) { setPrefetchStatus("idle"); return; }
    if (liConfirmed) return;
    if (prefetchCache.current[trimmed]) return; // already fetched or in-flight

    const searchId = ++liSearchId.current;
    prefetchCache.current[trimmed] = "__loading__";
    setPrefetchStatus("loading");

    // Show shimmer only if user has already advanced to the linkedin step
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

  // Fade the green confirmation on the LI field after 2s
  useEffect(() => {
    if (!liConfirmed) { setLiFaded(false); return; }
    const t = setTimeout(() => setLiFaded(true), 2000);
    return () => clearTimeout(t);
  }, [liConfirmed]);

  // Fetch email suggestions as soon as LinkedIn is confirmed
  // Always runs a refined Brave search with company info from the LinkedIn profile,
  // even if the prefetch found something (prefetch lacks company context → low quality).
  useEffect(() => {
    if (!liConfirmed) return;
    const searchId = ++emailSearchId.current;
    const trimmed = name.trim();

    setEmailLoading(true);
    setEmailSearched(false);
    setEmailSuggestions([]);
    setEmailLoadingMsg("Searching for email…");

    // Brave search with company/detail context from LinkedIn (fast, ~500ms)
    fetchEmailSuggestions(trimmed, liConfirmed.url, liConfirmed.detail, { braveOnly: true })
      .then(result => {
        if (emailSearchId.current !== searchId) return;
        if (result.emails.length > 0) {
          setEmailSuggestions(result.emails);
          setEmailLoading(false);
          setEmailSearched(true);
          setEmailLoadingMsg("");
          return;
        }

        // Brave still empty — fall back to Claude (slow)
        setEmailLoadingMsg("Digging deeper…");
        return fetchEmailSuggestions(trimmed, liConfirmed.url, liConfirmed.detail);
      })
      .then(result => {
        if (!result) return; // already handled above
        if (emailSearchId.current !== searchId) return;
        setEmailSuggestions(result.emails);
        setEmailLoading(false);
        setEmailSearched(true);
        setEmailLoadingMsg("");
      })
      .catch(() => {
        if (emailSearchId.current !== searchId) return;
        setEmailSuggestions([]);
        setEmailLoading(false);
        setEmailSearched(true);
        setEmailLoadingMsg("");
      });
  }, [liConfirmed]);

  function handleNameNext() {
    if (!name.trim()) return;
    const trimmed = name.trim();
    const cached = prefetchCache.current[trimmed];

    if (cached && cached !== "__loading__") {
      // Results already in — show instantly, no shimmer
      setLiSuggestions(cached);
      setLiLoading(false);
      setLiSearched(true);
    } else if (cached === "__loading__") {
      // Fetch in flight — show shimmer, results will surface when promise resolves
      setLiSuggestions([]);
      setLiLoading(true);
    } else {
      // Somehow not started yet (e.g. name < 3 chars then edited) — kick off now
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

  function handleEmailSelect(item) {
    setEmailConfirmed(item);
    setEmailInput(item.email);
    setEmailSuggestions([]);
  }

  function handleDone() {
    if (!name.trim() || !emailInput.trim()) return;
    setStep("done");
    onComplete({ name, linkedin: linkedinInput, email: emailInput });
  }

  const liShowSuggestions = step === "linkedin" && !liConfirmed && (liLoading || liSuggestions.length > 0 || liSearched);
  const emailShowSuggestions = step === "email" && !emailConfirmed && !emailLoadingMsg && (emailLoading || emailSuggestions.length > 0 || emailSearched);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* NAME */}
      <div>
        <label style={labelStyle}>Full name</label>
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
            <button onClick={handleNameNext} disabled={!name.trim()} style={nextBtnStyle(!!name.trim())}>
              Next →
            </button>
          )}
          {step !== "name" && (
            <button onClick={() => { setStep("name"); setLiConfirmed(null); setEmailConfirmed(null); setLiSearched(false); setLiSuggestions([]); }} style={editBtnStyle}>
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
          <input
            ref={liInputRef}
            value={linkedinInput}
            onChange={e => { setLinkedinInput(e.target.value); setLiConfirmed(null); }}
            placeholder="Select below or paste a URL"
            autoComplete="off"
            style={{
              ...inputStyle,
              background: liConfirmed && !liFaded ? C.successLight : "#fff",
              borderColor: liConfirmed && !liFaded ? "#86EFAC" : C.border,
              color: liConfirmed ? (liFaded ? C.sub : C.success) : C.ink,
              fontSize: liConfirmed ? 13 : 15,
              transition: "background 0.8s ease, border-color 0.8s ease, color 0.8s ease",
            }}
          />
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
            type="linkedin"
          />

          {/* Refine search */}
          {step === "linkedin" && !liConfirmed && !liLoading && liSuggestions.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {!refineOpen ? (
                <button
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
                  background: "#FAFAF9",
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 12,
                  display: "flex", flexDirection: "column", gap: 10,
                }}>
                  <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT }}>
                    Add their company or title to narrow results:
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
            onChange={e => { setEmailInput(e.target.value); setEmailConfirmed(null); }}
            placeholder="Select below or type an address"
            autoComplete="off"
            inputMode="email"
            style={{
              ...inputStyle,
              background: emailConfirmed ? C.successLight : "#fff",
              borderColor: emailConfirmed ? "#86EFAC" : C.border,
              color: emailConfirmed ? C.success : C.ink,
            }}
          />
          {emailConfirmed && (
            <div style={{ marginTop: 5, fontSize: 12, color: C.success, fontFamily: FONT, fontWeight: 500 }}>
              ✓ Email selected
            </div>
          )}
          {emailLoading && emailLoadingMsg && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, paddingLeft: 2 }}>
              <span style={{
                width: 10, height: 10, borderRadius: "50%",
                border: `1.5px solid ${C.accentSub}`,
                borderTop: `1.5px solid ${C.accent}`,
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, color: C.sub, fontFamily: FONT }}>{emailLoadingMsg}</span>
            </div>
          )}
          <SuggestionChips
            show={emailShowSuggestions}
            loading={emailLoading && !emailLoadingMsg}
            items={emailSuggestions}
            onSelect={handleEmailSelect}
            type="email"
          />
          {step === "email" && (
            <button
              onClick={handleDone}
              disabled={!emailInput.trim()}
              style={{
                ...nextBtnStyle(!!emailInput.trim()),
                width: "100%",
                marginTop: 14,
                padding: "14px",
                fontSize: 16,
                borderRadius: 12,
                justifyContent: "center",
              }}
            >
              Save ✓
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Collapsed Contact Card ──────────────────────────────────────────────────
function ContactCard({ contact, index, onEdit }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px", background: C.successLight,
      borderRadius: 12, border: `1.5px solid #86EFAC`,
    }}>
      <Avatar name={contact.name} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: C.ink, fontFamily: FONT }}>{contact.name}</div>
        <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {contact.email}
        </div>
      </div>
      <button onClick={onEdit} style={{
        background: "none", border: "none", color: C.sub,
        fontSize: 13, fontFamily: FONT, cursor: "pointer",
        padding: "4px 8px", borderRadius: 6,
      }}>
        Edit
      </button>
      <span style={{ fontSize: 18, color: C.success }}>✓</span>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [contacts, setContacts] = useState([null, null, null, null]); // null = empty, object = complete
  const [activeIndex, setActiveIndex] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Token-based invite flow
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token'));
  const [roleSlug] = useState(() => new URLSearchParams(window.location.search).get('role'));
  const [invitee, setInvitee] = useState(null);
  const [role, setRole] = useState(null);
  const [isUpdate, setIsUpdate] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(!!token);

  // Validate token on mount — use role-invite endpoint if role param present
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const endpoint = roleSlug
          ? `/api/role-invite/${token}`
          : `/api/vouch-invite/${token}`;
        const res = await fetch(endpoint);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invalid invite');
        setInvitee(data);

        // Store role context if present
        if (data.role) {
          setRole(data.role);
        }

        // Pre-populate contacts if this is an update (re-vouch)
        if (data.isUpdate && data.existingVouches?.length > 0) {
          setIsUpdate(true);
          const prefilled = [null, null, null, null];
          data.existingVouches.forEach((v, i) => {
            if (i < 4) {
              prefilled[i] = { name: v.name, linkedin: v.linkedin, email: v.email || '' };
            }
          });
          setContacts(prefilled);
          // Set activeIndex to first empty slot, or -1 if all filled
          const firstEmpty = prefilled.findIndex(c => c === null);
          setActiveIndex(firstEmpty !== -1 ? firstEmpty : -1);
        }
      } catch (err) {
        setTokenError(err.message);
      } finally {
        setTokenLoading(false);
      }
    })();
  }, [token]);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const recommendations = contacts.filter(Boolean);
      const endpoint = roleSlug ? '/api/submit-role-vouch' : '/api/submit-vouch';
      const payload = roleSlug
        ? { token, roleSlug, recommendations }
        : { token, recommendations };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      // If this was an update and they have a talent page, redirect there
      if (data.talentReady && data.talentUrl) {
        window.location.href = data.talentUrl;
        return;
      }

      setSubmitted(true);
    } catch (err) {
      console.error('[VouchForm] Submit error:', err);
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleComplete(index, data) {
    const next = [...contacts];
    next[index] = data;
    setContacts(next);
    // Open next slot if available
    const nextEmpty = next.findIndex((c, i) => i > index && c === null);
    if (nextEmpty !== -1) setActiveIndex(nextEmpty);
    else setActiveIndex(-1); // all done
  }

  const completedCount = contacts.filter(Boolean).length;
  const countWord = ["zero","one","two","three","four"][completedCount] || completedCount;
  const canSubmit = completedCount >= 1;

  // Show loading state while validating token
  if (tokenLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 900, minHeight: "100vh", background: "#F8F4E8", padding: "28px 16px 120px" }}>
          <div style={{ padding: "0 20px", marginBottom: 24 }}>
            <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
              Vouch<span style={{ color: C.accent }}>Four</span>
            </a>
          </div>
          <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", paddingTop: 60 }}>
            <div style={{ fontSize: 15, color: C.sub }}>Loading your invite...</div>
          </div>
        </div>
      </div>
    );
  }

  // Show error if token is invalid or missing
  if (token && tokenError) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 900, minHeight: "100vh", background: "#F8F4E8", padding: "28px 16px 120px" }}>
          <div style={{ padding: "0 20px", marginBottom: 24 }}>
            <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
              Vouch<span style={{ color: C.accent }}>Four</span>
            </a>
          </div>
          <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", paddingTop: 40 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>Invalid Invite</div>
            <div style={{ marginTop: 8, fontSize: 14, color: C.sub }}>{tokenError}</div>
            <a href="/" style={{ display: "inline-block", marginTop: 24, fontSize: 14, color: C.accent, textDecoration: "underline" }}>Go home</a>
          </div>
        </div>
      </div>
    );
  }

  // If no token provided, show a message directing user to use their invite link
  if (!token) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 900, minHeight: "100vh", background: "#F8F4E8", padding: "28px 16px 120px" }}>
          <div style={{ padding: "0 20px", marginBottom: 24 }}>
            <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
              Vouch<span style={{ color: C.accent }}>Four</span>
            </a>
          </div>
          <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", paddingTop: 40 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>Invite Required</div>
            <div style={{ marginTop: 8, fontSize: 14, color: C.sub, lineHeight: 1.5 }}>
              To vouch for talent, you need an invite link. Check your email for an invitation from someone in your network.
            </div>
            <a href="/" style={{ display: "inline-block", marginTop: 24, fontSize: 14, color: C.accent, textDecoration: "underline" }}>Go home</a>
          </div>
        </div>
      </div>
    );
  }

  const vouchFirstName = invitee?.name?.split(" ")[0] || "";
  const submittedContacts = contacts.filter(Boolean);

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
              Thanks, {vouchFirstName}!
            </div>
            <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, marginBottom: 24 }}>
              {role
                ? `Your recommendations for the ${role.jobFunction} role have been recorded. The people you've recommended will receive a note letting them know.`
                : "Your recommendations have been recorded. The people you've vouched for will receive a note letting them know someone thinks highly of them."}
            </p>

            <div style={{
              background: C.card, borderRadius: 14, border: `1.5px solid ${C.border}`,
              padding: "16px 18px", marginBottom: 28,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {role ? "You recommended" : "You vouched for"}
              </div>
              {submittedContacts.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 0",
                  borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: C.accent, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, fontFamily: FONT, flexShrink: 0,
                  }}>
                    {c.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: C.ink }}>{c.name}</div>
                  </div>
                </div>
              ))}
            </div>

            {!role && (
              <div style={{
                background: C.accentLight, borderRadius: 12, padding: "16px 18px",
                border: `1px solid ${C.chipBorder}`,
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 6 }}>
                  Want to build your own talent network?
                </div>
                <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, margin: "0 0 14px" }}>
                  VouchFour aggregates recommendations from people you trust to build a
                  high performing talent network custom to you.
                </p>
                <a href={`/network?${new URLSearchParams({
                  ...(invitee?.name ? { name: invitee.name } : {}),
                  ...(invitee?.linkedin ? { linkedin: invitee.linkedin } : {}),
                  ...(invitee?.email ? { email: invitee.email } : {}),
                }).toString()}`} style={{
                  display: "inline-block", padding: "10px 22px",
                  background: C.accent, color: "#fff", borderRadius: 10,
                  fontSize: 14, fontWeight: 600, textDecoration: "none",
                  fontFamily: FONT,
                }}>
                  Build Your Network
                </a>
              </div>
            )}

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

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4DF", fontFamily: FONT, display: "flex", justifyContent: "center" }}>

      {/* Phone-width container */}
      <div style={{ width: "100%", maxWidth: 900, minHeight: "100vh", background: "#F8F4E8", padding: "28px 16px 120px" }}>
        <div style={{ padding: "0 20px", marginBottom: 16 }}>
          <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </a>
        </div>

       <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          {invitee && (
            <div style={{
              padding: "10px 14px", marginBottom: 12,
              background: C.accentLight, borderRadius: 10,
              fontSize: 14, color: C.ink, fontFamily: FONT,
            }}>
              Welcome, <strong>{invitee.name}</strong>
            </div>
          )}

          {/* Role context card */}
          {role && (
            <div style={{
              background: "#FFFFFF", borderRadius: 12,
              border: `1.5px solid ${C.border}`,
              padding: "14px 16px", marginBottom: 14,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                Role Search{role.creatorName ? ` for ${role.creatorName}` : ""}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>
                {role.jobFunction}
              </div>
              <div style={{ fontSize: 13, color: C.sub, marginTop: 3 }}>
                {role.level}
              </div>
              {role.specialSkills && (
                <div style={{ fontSize: 12, color: C.sub, marginTop: 4, fontStyle: "italic" }}>
                  {role.specialSkills}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 6 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                height: 4, flex: 1, borderRadius: 2,
                background: contacts[i] ? C.accent : C.border,
                transition: "background 0.3s",
              }} />
            ))}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 17, color: C.ink, fontWeight: 600, lineHeight: 1.45, paddingLeft: 10 }}>
            {isUpdate
              ? "Update your VouchFour recommendations"
              : role
                ? `Who would you recommend for this ${role.jobFunction} role?`
                : "Who are 4 of the highest performers you've worked with in your career?"}
          </p>
        </div>
        {[0, 1, 2, 3].map(i => {
          const isComplete = !!contacts[i];
          const isActive = activeIndex === i;

          // Don't show future empty slots until previous is complete
          const prevComplete = i === 0 || contacts[i-1] !== null;
          if (!isComplete && !isActive && !prevComplete) return null;

          return (
            <div key={i} style={{
              position: "relative",
              background: C.card,
              borderRadius: 16,
              border: `1.5px solid ${isComplete ? "#86EFAC" : isActive ? C.accent : C.border}`,
              padding: isActive ? "20px 18px" : "14px 16px",
              marginBottom: 12,
              transition: "all 0.2s",
              boxShadow: isActive ? "0 4px 20px rgba(37,99,235,0.10)" : "0 1px 4px rgba(0,0,0,0.04)",
            }}>
              {/* Number badge on card border */}
              <div style={{
                position: "absolute", top: -10, left: 16,
                width: 20, height: 20, borderRadius: "50%",
                background: isComplete ? C.success : isActive ? C.accent : C.border,
                color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700,
                transition: "background 0.2s",
              }}>
                {isComplete ? "✓" : i + 1}
              </div>

              {/* Completed header */}
              {isComplete && !isActive && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.success, flex: 1 }}>
                    {contacts[i].name}
                  </span>
                  <button onClick={() => setActiveIndex(i)} style={{
                    background: "none", border: "none",
                    fontSize: 12, color: C.sub, cursor: "pointer", padding: "2px 6px",
                    borderRadius: 4, fontFamily: FONT,
                  }}>Edit</button>
                </div>
              )}

              {/* Collapsed summary */}
              {isComplete && !isActive && (
                <div style={{ marginTop: 2 }}>
                  <div style={{ fontSize: 12, color: C.sub }}>{contacts[i].email}</div>
                </div>
              )}

              {/* Active form */}
              {isActive && (
                <SingleContactForm
                  key={`contact-form-${i}`}
                  index={i}
                  onComplete={(data) => handleComplete(i, data)}
                />
              )}
            </div>
          );
        })}

        {/* Submit */}
        {submitError && (
          <div style={{
            padding: "12px 16px", marginTop: 8,
            background: "#FEF2F2", border: "1px solid #FECACA",
            borderRadius: 10, fontSize: 13, color: "#DC2626",
            fontFamily: FONT,
          }}>
            {submitError}
          </div>
        )}

        {canSubmit && activeIndex === -1 && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: "100%", padding: "16px",
              background: submitting ? "#93C5FD" : C.accent, color: "#fff",
              border: "none", borderRadius: 14,
              fontSize: 17, fontWeight: 700,
              fontFamily: FONT, cursor: submitting ? "default" : "pointer",
              marginTop: 8,
              boxShadow: "0 4px 16px rgba(37,99,235,0.25)",
            }}
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        )}

        {canSubmit && activeIndex !== -1 && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: "100%", padding: "14px",
              background: "none", color: submitting ? "#93C5FD" : "#1D4ED8",
              border: "none", borderRadius: 12,
              fontSize: 14, fontFamily: FONT, cursor: submitting ? "default" : "pointer", marginTop: 4,
              textDecoration: "underline",
              textDecorationColor: "#93C5FD",
              textUnderlineOffset: 3,
            }}
          >
            {submitting ? "Submitting..." : "Submit and skip the rest →"}
          </button>
        )}

        <p style={{
          marginTop: 40, fontSize: 12, color: "#57534E",
          lineHeight: 1.5, textAlign: "left", padding: "0 12px",
        }}>
          {role
            ? "Each person you recommend will receive a flattering email indicating that you think highly of them. Your recommendations will help the requester find the right talent for this role."
            : "Each of the people you VouchFour will receive a flattering email indicating that you think of them highly. No one else will be able to see specifically who you VouchFour."}
        </p>

        <p style={{
          marginTop: 24, fontSize: 11, color: "#78716C",
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

      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input:focus { outline: none; border-color: ${C.accent} !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
        button:active { opacity: 0.82; }
      `}</style>
    </div>
  );
}

// ─── Shared Styles ───────────────────────────────────────────────────────────
const labelStyle = {
  display: "block", fontSize: 13, fontWeight: 600,
  color: "#44403C", marginBottom: 6, fontFamily: FONT,
};

const inputStyle = {
  width: "100%", padding: "12px 14px",
  fontSize: 15, border: `1.5px solid ${C.border}`,
  borderRadius: 10, fontFamily: FONT,
  color: "#1C1917", background: "#fff",
  transition: "border-color 0.15s, box-shadow 0.15s",
  WebkitAppearance: "none",
};

const nextBtnStyle = (enabled) => ({
  display: "inline-flex", alignItems: "center",
  padding: "12px 18px",
  background: enabled ? "#2563EB" : "#D1D5DB",
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
