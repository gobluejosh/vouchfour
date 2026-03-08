import { useState, useEffect, useRef, useCallback } from "react";
import { capture, identify } from "../lib/posthog.js";
import { gradientForName, initialsForName } from "../lib/avatar.js";

// ─── Email Finder via backend ────────────────────────────────────────────────
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
  ink: "#171717",
  sub: "#6B7280",
  border: "#E7E5E0",
  accent: "#4F46E5",
  accentLight: "#EFF6FF",
  accentSub: "#93C5FD",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chip: "#F0F4FF",
  chipBorder: "#BFDBFE",
  warn: "#D97706",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

function Avatar({ name, size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.26,
      background: gradientForName(name), color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, fontFamily: FONT,
      flexShrink: 0, textShadow: "0 1px 2px rgba(0,0,0,0.15)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    }}>{initialsForName(name)}</div>
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
              background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)",
              backgroundSize: "200% 100%",
              animation: `shimmer 1.2s ${i * 0.15}s infinite`,
            }} />
          ))}
        </div>
      ) : type === "linkedin" ? (
        items.length === 0 ? (
          <div style={{ padding: "10px 14px", fontSize: 13, color: C.sub, fontFamily: FONT }}>
            No LinkedIn profile suggestions. Please enter it above.
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

  const [liSuggestions, setLiSuggestions] = useState([]);
  const [liLoading, setLiLoading] = useState(false);
  const [liSearched, setLiSearched] = useState(false);
  const [liConfirmed, setLiConfirmed] = useState(null); // {url, label, detail}
  const [liFaded, setLiFaded] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineCompany, setRefineCompany] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);

  const [step, setStep] = useState("name"); // name | linkedin | done
  const nameInputRef = useRef();
  const liInputRef = useRef();

  // Transfer focus from bridge input to name input on mount
  useEffect(() => {
    if (nameInputRef.current) nameInputRef.current.focus();
  }, []);

  const debouncedName = useDebounce(name, 800);
  const liSearchId = useRef(0);
  const prefetchCache = useRef({});
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

  function handleNameNext() {
    if (!name.trim()) return;
    const trimmed = name.trim();
    const cached = prefetchCache.current[trimmed];

    capture("linkedin_search_started", { slot_index: index });

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
    capture("linkedin_result_selected", { slot_index: index, method: "suggestion" });
  }

  function handleManualLinkedin() {
    if (!linkedinInput.trim()) return;
    setLiConfirmed({ label: name.trim(), detail: linkedinInput.trim(), url: linkedinInput.trim() });
    setLiSuggestions([]);
    capture("linkedin_result_selected", { slot_index: index, method: "manual" });
  }

  function handleLinkedInConfirm() {
    setStep("done");
    capture("vouch_slot_filled", { slot_index: index });
    onComplete({ name: capitalizeName(name), linkedin: linkedinInput.trim(), email: null });
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

  const liShowSuggestions = step === "linkedin" && !liConfirmed && (liLoading || liSuggestions.length > 0 || liSearched);

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
            <button onClick={() => { setStep("name"); setLiConfirmed(null); setLinkedinInput(""); setEmailConfirmed(null); setLiSearched(false); setLiSuggestions([]); }} style={editBtnStyle}>
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
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>✓ {liConfirmed.detail}</span>
              {step === "linkedin" && (
                <button onClick={() => {
                  setLiConfirmed(null); setLinkedinInput("");
                  // Restore suggestions from prefetch cache
                  const cached = prefetchCache.current[name.trim()];
                  if (cached && cached !== "__loading__") { setLiSuggestions(cached); }
                  setLiSearched(true);
                }} style={{
                  background: "none", border: "none", padding: "2px 6px",
                  fontSize: 12, color: C.sub, fontFamily: FONT,
                  cursor: "pointer", textDecoration: "underline",
                  textDecorationStyle: "dotted", textUnderlineOffset: 3,
                }}>
                  Change
                </button>
              )}
            </div>
          )}
          {step === "linkedin" && liConfirmed && (
            <button
              onClick={handleLinkedInConfirm}
              style={{
                ...nextBtnStyle(true),
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

    </div>
  );
}

// ─── Share Link Box (email-free mode success screen) ─────────────────────────
function ShareLinkBox({ shareToken, jobFnShort, voucherFirstName }) {
  const [copied, setCopied] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);
  const link = `${window.location.origin}/invite/${shareToken}`;

  const smsMsg = `I'm sharing an invite link for VouchFour. It's a new professional network site where you only get to invite your all-time best colleagues. I recommended you.\n\n${link}`;

  const emailSubject = "Sharing an invite";
  const emailBody = `Hi,\n\nI'm building out my professional network on a new site - VouchFour. It's invite-only and the premise is that you only get to invite your 4 all-time best colleagues in each job function. I recommended you as one of the top 4 ${jobFnShort || "professionals"} I've ever worked with. The link below will get you access to the site:\n\n${link}\n\nLet me know what you think,\n${voucherFirstName || ""}`;

  const shareBtnBase = {
    flex: 1, padding: "10px 6px", borderRadius: 999,
    fontSize: 12, fontWeight: 700, fontFamily: FONT,
    cursor: "pointer", textAlign: "center",
    textDecoration: "none", display: "block", lineHeight: 1.3,
    border: "none", color: "#fff",
    textShadow: "0 1px 2px rgba(0,0,0,0.15)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  };

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Share buttons — primary action */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <a
          href={`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`}
          style={{ ...shareBtnBase, background: "linear-gradient(135deg, #3B82F6, #6366F1)" }}
        >
          Email
        </a>
        <a
          href={`https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...shareBtnBase, background: "linear-gradient(135deg, #E11D48, #F97316)" }}
        >
          Gmail
        </a>
        <a
          href={`sms:?&body=${encodeURIComponent(smsMsg)}`}
          style={{ ...shareBtnBase, background: "linear-gradient(135deg, #10B981, #06B6D4)" }}
        >
          Text
        </a>
        <button
          onClick={() => {
            navigator.clipboard.writeText(smsMsg);
            setMsgCopied(true);
            setTimeout(() => setMsgCopied(false), 2000);
          }}
          style={{ ...shareBtnBase, background: "linear-gradient(135deg, #8B5CF6, #EC4899)" }}
        >
          {msgCopied ? "Copied!" : "Copy msg"}
        </button>
      </div>

      {/* Raw link — secondary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", background: "rgba(255,255,255,0.6)",
        border: `1px solid ${C.border}`, borderRadius: 10,
      }}>
        <input
          readOnly
          value={link}
          style={{
            flex: 1, border: "none", background: "transparent",
            fontSize: 12, fontFamily: FONT, color: C.sub,
            outline: "none", minWidth: 0,
          }}
          onClick={e => e.target.select()}
        />
        <button
          onClick={() => {
            navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          style={{
            padding: "4px 10px", background: "transparent", color: C.accent,
            border: `1px solid #C7D2FE`, borderRadius: 6, fontSize: 11,
            fontWeight: 600, fontFamily: FONT, cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
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
          {contact.email || contact.linkedin || ""}
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
  const [invitee, setInvitee] = useState(null);
  const [isUpdate, setIsUpdate] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(!!token);
  const [shareToken, setShareToken] = useState(null);
  const [activeVoucheeNames, setActiveVoucheeNames] = useState([]);
  const [totalVouchees, setTotalVouchees] = useState(0);

  // Validate token on mount — try to create session and redirect pre-vouch users to homepage
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        // Try to create a session from the vouch invite token
        const sessionRes = await fetch(`/api/auth/vouch-session?token=${token}`, { credentials: "include" });
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          // If this is a new pre-vouch user, redirect to homepage for the welcome experience
          // Skip redirect if they clicked the CTA from the welcome page (?ready=1)
          const urlParams = new URLSearchParams(window.location.search);
          const ready = urlParams.get("ready");
          if (!sessionData.isUpdate && !sessionData.user.has_vouched && !ready) {
            sessionStorage.setItem("vouchfour_vouchToken", token);
            if (sessionData.inviterName) {
              sessionStorage.setItem("vouchfour_inviterName", sessionData.inviterName);
            }
            if (sessionData.jobFunction) {
              sessionStorage.setItem("vouchfour_jobFunction", JSON.stringify(sessionData.jobFunction));
            }
            window.location.href = "/";
            return;
          }
        }

        // For returning/update users, or if vouch-session fails, continue with existing form flow
        const res = await fetch(`/api/vouch-invite/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invalid invite');
        setInvitee(data);

        capture("vouch_page_viewed", {
          has_inviter: !!data.inviterName,
          job_function: data.jobFunction?.name || null,
          is_update: data.isUpdate || false,
        });

        // Pre-populate contacts if this is an update (re-vouch)
        if (data.isUpdate && data.existingVouches?.length > 0) {
          setIsUpdate(true);
          const prefilled = [null, null, null, null];
          data.existingVouches.forEach((v, i) => {
            if (i < 4) {
              prefilled[i] = { name: v.name, linkedin: v.linkedin, email: v.email || '', responded: !!v.responded };
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
      const res = await fetch('/api/submit-vouch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, recommendations }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      // Capture share token + active vouchee info for email-free mode success screen
      if (data.shareToken) {
        setShareToken(data.shareToken);
        setActiveVoucheeNames(data.activeVoucheeNames || []);
        setTotalVouchees(data.totalVouchees || 0);
      }

      // Store identity so StartVouchPage works for chained (non-authenticated) users
      if (data.personId) {
        sessionStorage.setItem("vouchfour_personId", String(data.personId));
        sessionStorage.setItem("vouchfour_hasVouched", "true");
        identify(data.personId, { name: invitee?.name });
      }
      if (invitee?.name) {
        sessionStorage.setItem("vouchfour_firstName", invitee.name.split(" ")[0]);
      }

      capture("vouch_form_submitted", {
        vouch_count: recommendations.length,
        job_function: invitee?.jobFunction?.name || null,
        is_update: isUpdate,
      });

      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "instant" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    } catch (err) {
      console.error('[VouchForm] Submit error:', err);
      setSubmitError(err.message);
      try {
        fetch('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            message: err.message,
            stack: err.stack,
            context: 'vouch_form_submit',
            url: window.location.href,
            userAgent: navigator.userAgent,
          }),
        }).catch(() => {})
      } catch {}
    } finally {
      setSubmitting(false);
    }
  }

  const focusBridgeRef = useRef();

  function handleComplete(index, data) {
    const next = [...contacts];
    next[index] = data;
    setContacts(next);
    // Open next slot if available
    const nextEmpty = next.findIndex((c, i) => i > index && c === null);
    if (nextEmpty !== -1) {
      // On mobile Safari, we must grab focus synchronously within the user gesture
      // so the keyboard stays up. We focus a hidden bridge input, then transfer
      // focus to the real name input after React re-renders.
      if (focusBridgeRef.current) focusBridgeRef.current.focus();
      setActiveIndex(nextEmpty);
    }
    else setActiveIndex(-1); // all done
  }

  const completedCount = contacts.filter(Boolean).length;
  const countWord = ["zero","one","two","three","four"][completedCount] || completedCount;
  const canSubmit = completedCount >= 1;

  // Show loading state while validating token
  if (tokenLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
        <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
          <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </a>
        </div>
        <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px", borderRadius: 0, margin: "52px 0 0" }}>
          <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 16 }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: C.border }} />
                ))}
              </div>
              <div style={{ height: 20, width: "75%", borderRadius: 6, background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.2s infinite" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{
                  height: 140, borderRadius: 16,
                  background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)",
                  backgroundSize: "200% 100%",
                  animation: `shimmer 1.2s ${i * 0.15}s infinite`,
                }} />
              ))}
            </div>
            <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
          </div>
        </div>
      </div>
    );
  }

  // Show error if token is invalid or missing
  if (token && tokenError) {
    return (
      <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
        <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
          <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </a>
        </div>
        <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px", borderRadius: 0, margin: "52px 0 0" }}>
          <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", paddingTop: 40 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>Invalid Invite</div>
            <div style={{ marginTop: 8, fontSize: 14, color: C.sub }}>{tokenError}</div>
            <a href="/" style={{ display: "inline-block", marginTop: 24, fontSize: 14, color: C.accent, textDecoration: "underline" }}>Go home</a>
          </div>
        </div>
      </div>
    );
  }

  // If no token provided, redirect to start-vouch page
  if (!token) {
    window.location.href = '/start-vouch';
    return null;
  }

  const vouchFirstName = invitee?.name?.split(" ")[0] || "";
  const submittedContacts = contacts.filter(Boolean);

  // Helper: format a list of first names for display
  function formatNames(names) {
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
  }

  if (submitted) {
    const jobFnShort = invitee?.jobFunction?.practitionerLabel || null;

    return (
      <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
        <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
          <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </a>
        </div>
        <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px", borderRadius: 0, margin: "52px 0 0" }}>

          <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 16 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.ink, marginBottom: 12, lineHeight: 1.3 }}>
              Your network is taking shape, {vouchFirstName}.
            </div>
            {/* Share link / email notification */}
            <div style={{
              background: "linear-gradient(135deg, #FDE6D0 0%, #D4F0E0 100%)",
              borderRadius: 14, border: "1.5px solid rgba(0,0,0,0.06)",
              padding: "18px 18px 22px", marginBottom: 20,
            }}>
              {(() => {
                const allNames = submittedContacts.map(c => c.name.split(" ")[0]);
                const activeFirstNames = activeVoucheeNames.map(n => n.split(" ")[0]);
                const newNames = allNames.filter(n => !activeFirstNames.includes(n));

                if (activeVoucheeNames.length >= totalVouchees && totalVouchees > 0) {
                  /* All vouchees are already active */
                  return (
                    <p style={{ fontSize: 15, color: C.ink, lineHeight: 1.6, marginBottom: 0, marginTop: 0 }}>
                      <strong>{formatNames(activeFirstNames)}</strong> {activeFirstNames.length === 1 ? "is" : "are"} already on VouchFour — no need to share an invite link. Your vouches have been recorded and their networks just got stronger.
                    </p>
                  );
                } else if (activeVoucheeNames.length > 0) {
                  /* Some vouchees are already active */
                  return (
                    <>
                      <p style={{ fontSize: 15, color: C.ink, lineHeight: 1.6, marginBottom: 4, marginTop: 0 }}>
                        <strong>{formatNames(activeFirstNames)}</strong> {activeFirstNames.length === 1 ? "is" : "are"} already on VouchFour, so they're all set.
                      </p>
                      <p style={{ fontSize: 15, color: C.ink, lineHeight: 1.6, marginBottom: 16, marginTop: 0 }}>
                        Just share your invite with <strong>{formatNames(newNames)}</strong> via whatever method is easiest for you:
                      </p>
                      <ShareLinkBox shareToken={shareToken} jobFnShort={jobFnShort} voucherFirstName={vouchFirstName} />
                    </>
                  );
                } else {
                  /* No vouchees are active */
                  return (
                    <>
                      <p style={{ fontSize: 15, color: C.ink, lineHeight: 1.6, marginBottom: 16, marginTop: 0 }}>
                        Now share an invite with <strong>{formatNames(allNames)}</strong> so they can access their network. Pick the best option for you:
                      </p>
                      <ShareLinkBox shareToken={shareToken} jobFnShort={jobFnShort} voucherFirstName={vouchFirstName} />
                    </>
                  );
                }
              })()}
            </div>

            {/* Keep building your network */}
            <div style={{
              background: "#fff", borderRadius: 14, border: `1.5px solid ${C.border}`,
              padding: "18px 18px 22px", marginBottom: 28,
            }}>
              <p style={{ fontSize: 15, color: C.ink, lineHeight: 1.6, marginBottom: 14, marginTop: 0, fontWeight: 600 }}>
                Keep building your network by vouching in another function:
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  id="success-function-select"
                  defaultValue=""
                  style={{
                    flex: 1, padding: "12px 14px", fontSize: 16, fontFamily: FONT,
                    borderRadius: 10, border: `1.5px solid ${C.border}`,
                    background: "#fff", color: C.ink, appearance: "none",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
                    paddingRight: 32, cursor: "pointer",
                  }}
                >
                  <option value="" disabled>Choose a function…</option>
                  {[
                    { id: 15, name: "Clinicians", slug: "clinicians" },
                    { id: 16, name: "Coaches", slug: "coaches" },
                    { id: 17, name: "Communications / PR", slug: "communications" },
                    { id: 18, name: "Consultants", slug: "consultants" },
                    { id: 10, name: "Customer Success", slug: "customer-success" },
                    { id: 6, name: "Data / Analytics", slug: "data" },
                    { id: 5, name: "Design (Product/UX)", slug: "design" },
                    { id: 19, name: "Educators", slug: "educators" },
                    { id: 1, name: "Engineering", slug: "engineering" },
                    { id: 11, name: "Executive", slug: "executive" },
                    { id: 7, name: "Finance / Accounting", slug: "finance" },
                    { id: 20, name: "Founders", slug: "founders" },
                    { id: 14, name: "General Management", slug: "general-management" },
                    { id: 21, name: "Generalists", slug: "generalists" },
                    { id: 12, name: "Investor", slug: "investor" },
                    { id: 13, name: "Legal", slug: "legal" },
                    { id: 3, name: "Marketing", slug: "marketing" },
                    { id: 8, name: "Operations", slug: "operations" },
                    { id: 9, name: "People / HR", slug: "people-hr" },
                    { id: 22, name: "People Managers", slug: "people-managers" },
                    { id: 2, name: "Product Management", slug: "product" },
                    { id: 4, name: "Sales", slug: "sales" },
                    { id: 23, name: "Strategists", slug: "strategists" },
                  ].filter(jf => jf.slug !== invitee?.jobFunction?.slug).map(jf => (
                    <option key={jf.id} value={JSON.stringify(jf)}>{jf.name}</option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    const sel = document.getElementById("success-function-select");
                    if (!sel.value) return;
                    const jf = JSON.parse(sel.value);
                    try {
                      const controller = new AbortController();
                      const timeout = setTimeout(() => controller.abort(), 15000);
                      const res = await fetch("/api/start-vouch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ jobFunctionId: jf.id }),
                        signal: controller.signal,
                      });
                      clearTimeout(timeout);
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed");
                      window.location.href = `/vouch?token=${data.token}&ready=1`;
                    } catch (err) {
                      alert(err.message);
                      try {
                        fetch('/api/client-error', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({
                            message: err.message, stack: err.stack,
                            context: 'vouch_success_start_vouch',
                            url: window.location.href, userAgent: navigator.userAgent,
                          }),
                        }).catch(() => {})
                      } catch {}
                    }
                  }}
                  style={{
                    padding: "12px 20px", background: C.accent, color: "#fff",
                    border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600,
                    fontFamily: FONT, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  Vouch →
                </button>
              </div>
            </div>

            {/* View talent network link */}
            {(() => {
              const li = invitee?.linkedin;
              const slugMatch = li && li.match(/\/in\/([^/]+)/);
              const talentSlug = slugMatch ? slugMatch[1] : null;
              return talentSlug ? (
                <a href={`/talent/${talentSlug}`} style={{
                  display: "block", textAlign: "center", padding: "12px 28px",
                  background: "rgba(255,255,255,0.5)", color: C.accent,
                  border: `1.5px solid ${C.accent}`, borderRadius: 10,
                  fontSize: 14, fontWeight: 600, textDecoration: "none",
                  fontFamily: FONT,
                }}>
                  View Your Network
                </a>
              ) : null;
            })()}

          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>

      {/* Fixed logo bar */}
      <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
      </div>

      {/* Phone-width container */}
      <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px", borderRadius: 0, margin: "52px 0 0" }}>

       <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 16 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                height: 4, flex: 1, borderRadius: 2,
                background: contacts[i] ? C.accent : "rgba(255,255,255,0.5)",
                transition: "background 0.3s",
              }} />
            ))}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 17, color: C.ink, fontWeight: 600, lineHeight: 1.45, paddingLeft: 10 }}>
            {isUpdate
              ? `Update your top${invitee?.jobFunction ? ` ${invitee.jobFunction.practitionerLabel || invitee.jobFunction.name}` : ""}`
              : invitee?.jobFunction
                ? `Who are the best ${invitee.jobFunction.practitionerLabel || invitee.jobFunction.name} you've ever worked with?`
                : "Who are the highest performers you've worked with in your career?"}
          </p>
        </div>
        {/* Hidden input to bridge focus on mobile Safari between form saves */}
        <input ref={focusBridgeRef} aria-hidden="true" style={{ position: "absolute", opacity: 0, height: 0, width: 0, padding: 0, border: "none", pointerEvents: "none" }} tabIndex={-1} />
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
                  {contacts[i].responded ? (
                    <span title="This person has already responded — their vouch can't be edited" style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "2px 6px", color: C.sub, fontSize: 13,
                      cursor: "default",
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                    </span>
                  ) : (
                    <button onClick={() => setActiveIndex(i)} style={{
                      background: "none", border: "none",
                      fontSize: 12, color: C.sub, cursor: "pointer", padding: "2px 6px",
                      borderRadius: 4, fontFamily: FONT,
                    }}>Edit</button>
                  )}
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

        {canSubmit && completedCount === 1 && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                background: "none", border: "none", cursor: submitting ? "default" : "pointer",
                fontSize: 14, fontWeight: 600, color: C.accent,
                fontFamily: FONT, textDecoration: "underline",
                padding: "4px 0",
              }}
            >
              {submitting ? "Submitting..." : "Submit 1 of 4 picks"}
            </button>
          </div>
        )}
        {canSubmit && completedCount >= 2 && completedCount <= 3 && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: "100%", padding: "16px",
              background: submitting ? "#93C5FD" : "#6366F1", color: "#fff",
              border: "none", borderRadius: 14,
              fontSize: 17, fontWeight: 700,
              fontFamily: FONT, cursor: submitting ? "default" : "pointer",
              marginTop: 8,
              boxShadow: "0 4px 16px rgba(99,102,241,0.20)",
            }}
          >
            {submitting ? "Submitting..." : `Submit ${completedCount} of 4`}
          </button>
        )}
        {canSubmit && completedCount === 4 && (
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

        <div style={{
          marginTop: 32, padding: "16px 18px",
          background: "linear-gradient(135deg, #ECFDF5 0%, #DBEAFE 100%)", borderRadius: 12,
          border: `1.5px solid rgba(0,0,0,0.06)`,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: C.ink,
            marginBottom: 6, fontFamily: FONT,
          }}>
            Your Picks Build Your Network
          </div>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.55, fontFamily: FONT }}>
            Each person you pick will be invited to vouch for their 4 all-time best{invitee?.jobFunction?.name ? ` ${invitee.jobFunction.name}` : ""} colleagues. The talent you will discover in your VouchFour network comes from this chain, so pick people who are genuinely great at what they do and whose judgment you trust.
          </div>
        </div>


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
  color: "#3730A3", marginBottom: 6, fontFamily: FONT,
};

const inputStyle = {
  width: "100%", padding: "12px 14px",
  fontSize: 16, border: `1.5px solid ${C.border}`,
  borderRadius: 10, fontFamily: FONT,
  color: "#1C1917", background: "#fff",
  transition: "border-color 0.15s, box-shadow 0.15s",
  WebkitAppearance: "none",
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
