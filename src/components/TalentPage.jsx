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
  warn: "#D97706",
  chipBorder: "#BFDBFE",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : true
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);
  return mobile;
}

const DEGREE_LABELS = { 1: "1st", 2: "2nd", 3: "3rd" };
const DEGREE_COLORS = {
  1: { bg: "#EEF2FF", border: "#A5B4FC", badge: "linear-gradient(135deg, #6366F1, #4F46E5)" },
  2: { bg: "#ECFDF5", border: "#86EFAC", badge: "linear-gradient(135deg, #34D399, #16A34A)" },
  3: { bg: "#F5F3FF", border: "#C4B5FD", badge: "linear-gradient(135deg, #A78BFA, #7C3AED)" },
};

const DEGREE_AVATAR_GRADIENTS = {
  1: "linear-gradient(135deg, #6366F1, #4F46E5)", // indigo
  2: "linear-gradient(135deg, #34D399, #16A34A)", // emerald
  3: "linear-gradient(135deg, #A78BFA, #7C3AED)", // violet
};
function Avatar({ name, size = 38, degree }) {
  const bg = (degree && DEGREE_AVATAR_GRADIENTS[degree]) || gradientForName(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.26,
      background: bg, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, fontFamily: FONT,
      flexShrink: 0, textShadow: "0 1px 2px rgba(0,0,0,0.15)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    }}>{initialsForName(name)}</div>
  );
}

function isPlaceholderPhoto(url) {
  return url && url.includes("static.licdn.com");
}

function PhotoAvatar({ name, photoUrl, size = 42, degree }) {
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
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      />
    );
  }
  return <Avatar name={name} size={size} degree={degree} />;
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
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

function BrainIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function TalentCard({ talent }) {
  const colors = DEGREE_COLORS[talent.degree] || DEGREE_COLORS[3];
  const count = Number(talent.recommendation_count);
  const recText = count === 1
    ? "Recommended by 1 person"
    : `Recommended by ${count} people`;
  const subtitle = [talent.current_title, talent.current_company].filter(Boolean).join(" at ");

  return (
    <a
      href={`/person/${talent.id}`}
      onClick={() => capture("talent_card_clicked", { person_id: talent.id, degree: talent.degree, is_cross_function: talent.is_cross_function })}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px", background: "#FFFFFF",
        borderRadius: 12, border: `1px solid ${C.border}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        textDecoration: "none", cursor: "pointer",
        transition: "box-shadow 0.15s",
      }}
    >
      <PhotoAvatar name={talent.display_name} photoUrl={talent.photo_url} size={42} degree={talent.degree} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: C.ink, fontFamily: FONT }}>{talent.display_name}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#fff",
            background: colors.badge, borderRadius: 4,
            padding: "1px 5px", letterSpacing: 0.3,
          }}>
            {DEGREE_LABELS[talent.degree]}
          </span>
        </div>
        {subtitle && (
          <div style={{
            fontSize: 12, color: C.ink, fontFamily: FONT, marginTop: 2,
            opacity: 0.7,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {subtitle}
          </div>
        )}
        <div style={{ fontSize: 11, color: C.sub, fontFamily: FONT, marginTop: 2 }}>
          {recText}
        </div>
      </div>
      <ChevronRightIcon />
    </a>
  );
}

function VouchStatusCard({ vouches, vouchToken, shareToken, label, dropdown }) {
  const [expanded, setExpanded] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const responded = vouches.filter(v => v.inviteStatus === "completed").length;
  const inviteLink = shareToken ? `${window.location.origin}/invite/${shareToken}` : null;

  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, border: `1.5px solid ${C.border}`,
      padding: "14px 18px", marginTop: 24,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
        Vouch Invite Status{label ? ` — ${label}` : ""}
      </div>
      {dropdown && <div style={{ marginTop: 10 }}>{dropdown}</div>}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          cursor: "pointer", userSelect: "none", marginTop: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT }}>
            {responded} of {vouches.length} responded
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{
              transition: "transform 0.2s",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {vouches.map((v, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0",
              borderTop: i > 0 ? `1px solid ${C.border}` : "none",
            }}>
              <Avatar name={v.name} size={30} />
              <div style={{ flex: 1, fontSize: 14, color: C.ink, fontFamily: FONT }}>{v.name}</div>
              {v.inviteStatus === "completed" ? (
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
          {vouchToken && (
            <a
              href={`/vouch?token=${vouchToken}`}
              style={{ fontSize: 12, color: C.accent, fontFamily: FONT, marginTop: 8, display: "block", textAlign: "right" }}
            >
              Edit vouches →
            </a>
          )}
          {inviteLink && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", marginTop: 8,
              background: "#F9FAFB", borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: "nowrap" }}>
                Invite link:
              </div>
              <input
                readOnly
                value={inviteLink}
                style={{
                  flex: 1, border: "none", background: "transparent",
                  fontSize: 12, fontFamily: FONT, color: C.ink,
                  outline: "none", minWidth: 0,
                }}
                onClick={e => { e.stopPropagation(); e.target.select(); }}
              />
              <button
                onClick={e => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(inviteLink);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2000);
                }}
                style={{
                  padding: "4px 10px", background: "transparent", color: C.accent,
                  border: `1px solid #C7D2FE`, borderRadius: 6, fontSize: 11,
                  fontWeight: 600, fontFamily: FONT, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
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
            fontSize: 16, border: `1.5px solid ${C.border}`,
            borderRadius: 10, fontFamily: FONT,
            color: C.ink, background: "#fff",
            WebkitAppearance: "none",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
          onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; }}
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
  const [myVouches, setMyVouches] = useState({}); // { engineering: [{name, linkedin, inviteStatus}], ... }
  const [vouchTokens, setVouchTokens] = useState({}); // { engineering: "token", ... }
  const [activeJobFunctions, setActiveJobFunctions] = useState([]); // functions user has vouched in
  const [reachableFunctions, setReachableFunctions] = useState([]); // all functions with reachable talent
  const [availableJobFunctions, setAvailableJobFunctions] = useState([]); // functions user hasn't vouched in
  const [activeFunction, setActiveFunction] = useState(null); // slug or null for "All"
  const [totalPeople, setTotalPeople] = useState(0); // unfiltered total for user card

  const [shareToken, setShareToken] = useState(null); // invite share link token
  const [selectedNextFn, setSelectedNextFn] = useState(""); // id of function picked in CTA dropdown
  const [startingVouch, setStartingVouch] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedItems, setFeedItems] = useState([]);
  const [vouchFunction, setVouchFunction] = useState(null);

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
      fetch(`/api/auth/validate?token=${loginToken}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (data.user) {
            setUser(data.user);
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
        .then(data => {
          setUser(data.user);
          setAuthState("authenticated");
        })
        .catch(() => setAuthState("unauthenticated"));
    }
  }, [slug]);

  // Fetch talent data once authenticated (re-fetches when activeFunction changes)
  useEffect(() => {
    if (authState !== "authenticated" || !slug) return;

    setLoading(true);
    const fnParam = activeFunction ? `?fn=${activeFunction}` : "";
    fetch(`/api/talent/${slug}${fnParam}`, { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then(data => {
        setTalent(data.talent || []);
        if (!activeFunction) setTotalPeople((data.talent || []).length);
        setMyVouches(data.myVouches || {});
        setVouchTokens(data.vouchTokens || {});
        setActiveJobFunctions(data.activeJobFunctions || []);
        const rf = data.reachableFunctions || data.activeJobFunctions || [];
        setReachableFunctions(rf);
        setAvailableJobFunctions(data.availableJobFunctions || []);
        if (!activeFunction) {
          const mv = data.myVouches || {};
          const slugsWithVouches = Object.keys(mv).filter(s => mv[s]?.vouches?.length > 0);
          const sorted = slugsWithVouches.sort((a, b) => {
            const la = (rf.find(f => f.slug === a)?.practitionerLabel || a).toLowerCase();
            const lb = (rf.find(f => f.slug === b)?.practitionerLabel || b).toLowerCase();
            return la.localeCompare(lb);
          });
          if (sorted.length > 0) setVouchFunction(sorted[0]);
        }
        if (data.shareToken) setShareToken(data.shareToken);

        if (data.user?.id) identify(data.user.id, { name: data.user.name });
        capture("talent_page_viewed", {
          talent_count: (data.talent || []).length,
          function_filter: activeFunction || "all",
          active_functions_count: (data.activeJobFunctions || []).length,
        });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [authState, slug, activeFunction]);

  // Fetch What's New feed
  useEffect(() => {
    if (authState !== "authenticated") return;
    fetch("/api/feed", { credentials: "include" })
      .then(res => res.ok ? res.json() : { items: [] })
      .then(data => setFeedItems(data.items || []))
      .catch(() => {});
  }, [authState]);

  const isMobile = useIsMobile();
  const firstName = user?.name?.split(" ")[0] || "";
  const fullName = user?.name || "";

  // Get the vouch data for the currently-active function tab
  const displayedFunctionSlug = activeFunction || (reachableFunctions.length === 1 ? reachableFunctions[0]?.slug : null);
  const currentVouchData = displayedFunctionSlug ? myVouches[displayedFunctionSlug] : null;
  const currentVouches = currentVouchData?.vouches || [];
  const currentVouchToken = displayedFunctionSlug ? vouchTokens[displayedFunctionSlug] : null;

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
      {/* Fixed logo bar */}
      <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
      </div>
      <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px", borderRadius: 0, margin: "52px 0 0" }}>

        <div style={{ maxWidth: isMobile ? 480 : 1100, margin: "0 auto", paddingTop: 12 }}>

          {/* Checking auth — show heading + shimmers */}
          {authState === "checking" && (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>
                  {fullName ? `${fullName}'s Trusted Talent Network` : "Trusted Talent Network"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} style={{
                    height: 62, borderRadius: 12,
                    background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)",
                    backgroundSize: "200% 100%",
                    animation: `shimmer 1.2s ${i * 0.15}s infinite`,
                  }} />
                ))}
                <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
              </div>
            </>
          )}

          {/* Unauthenticated — show login prompt */}
          {authState === "unauthenticated" && !error && (
            <LoginPrompt />
          )}

          {/* Error */}
          {error && (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 8 }}>Something went wrong</div>
              <div style={{ fontSize: 14, color: C.sub }}>{error}</div>
            </div>
          )}

          {/* Authenticated — talent network */}
          {authState === "authenticated" && !error && (() => {
            /* ---- Shared blocks ---- */
            const userCard = (
              <a
                href={user?.id ? `/person/${user.id}` : "#"}
                onClick={() => capture("own_profile_clicked", { source: "talent_page" })}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 16px", marginBottom: 20,
                  background: "#FFFFFF",
                  borderRadius: 14, border: `1px solid ${C.border}`,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  textDecoration: "none", cursor: "pointer",
                }}
              >
                <PhotoAvatar name={fullName} photoUrl={user?.photo_url} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>{fullName}</div>
                  {(user?.current_title || user?.current_company) && (
                    <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.3, marginTop: 2 }}>
                      {[user.current_title, user.current_company].filter(Boolean).join(" at ")}
                    </div>
                  )}
                  {!loading && (
                    <div style={{ fontSize: 12, color: C.accent, fontWeight: 600, marginTop: 4 }}>
                      {totalPeople} {totalPeople === 1 ? "person" : "people"}{activeJobFunctions.length > 0 ? ` · ${activeJobFunctions.length} ${activeJobFunctions.length === 1 ? "function" : "functions"}` : ""}
                    </div>
                  )}
                </div>
                <ChevronRightIcon />
              </a>
            );

            const brainForm = (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const q = e.target.elements.brainQ.value.trim();
                  capture("brain_cta_clicked", { source: "talent_page", has_query: !!q });
                  window.location.href = q ? `/brain?q=${encodeURIComponent(q)}` : "/brain";
                }}
                style={{ display: "flex", gap: 6 }}
              >
                <input
                  name="brainQ"
                  placeholder="Ask anything about your network..."
                  autoComplete="off"
                  style={{
                    flex: 1, padding: isMobile ? "12px 14px" : "14px 16px", fontSize: isMobile ? 16 : 17, fontFamily: FONT,
                    color: C.ink, background: isMobile ? "#fff" : "#F9FAFB", border: `1.5px solid ${C.border}`,
                    borderRadius: 10, WebkitAppearance: "none",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; e.target.style.background = "#fff"; }}
                  onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; e.target.style.background = isMobile ? "#fff" : "#F9FAFB"; }}
                />
                <button type="submit" style={{
                  padding: "10px 16px", background: C.accent, border: "none", borderRadius: 10,
                  cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
                }}>
                  <BrainIcon size={18} />
                </button>
              </form>
            );

            const brainPrompt = !loading && talent.length > 0 ? (
              isMobile ? (
                <div
                  onClick={() => { window.location.href = "/brain"; }}
                  style={{
                    background: "#EEF2FF", borderRadius: 14, padding: "18px 16px",
                    border: `1px solid #C7D2FE`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    marginBottom: 16, cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ color: C.accent, display: "flex", alignItems: "center" }}><BrainIcon size={16} /></div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: FONT, flex: 1 }}>Network Brain</span>
                    <ChevronRightIcon />
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    {brainForm}
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { window.location.href = "/brain"; }}
                  style={{
                    background: "#EEF2FF", borderRadius: 14, padding: "28px 16px",
                    border: `1px solid #C7D2FE`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    marginBottom: 16, cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <div style={{ color: C.accent, display: "flex", alignItems: "center" }}><BrainIcon size={18} /></div>
                    <span style={{ fontSize: 17, fontWeight: 700, color: C.ink, fontFamily: FONT, flex: 1 }}>Network Brain</span>
                    <ChevronRightIcon />
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    {brainForm}
                  </div>
                </div>
              )
            ) : null;

            const feedTimeAgo = (dateStr) => {
              const diffMin = Math.floor((Date.now() - new Date(dateStr)) / 60000);
              if (diffMin < 1) return "just now";
              if (diffMin < 60) return `${diffMin}m`;
              const diffHr = Math.floor(diffMin / 60);
              if (diffHr < 24) return `${diffHr}h`;
              return `${Math.floor(diffHr / 24)}d`;
            };

            const feedItemLabel = (item) => {
              if (item.type === "vouch") return <><b>{item.subject.name}</b> was vouched for by {item.actor.name}</>;
              if (item.type === "ask") return <><b>{item.actor.name}</b> sent you an Ask</>;
              if (item.type === "thread") return <><b>{item.actor.name}</b> posted in {item.topic} · {feedTimeAgo(item.ts)}</>;
              return "";
            };

            const feedAvatar = (item) => {
              if (item.type === "vouch") return { name: item.subject.name, photo: item.subject.photo_url };
              return { name: item.actor.name, photo: item.actor.photo_url };
            };

            const whatsNew = (
              <div style={{
                background: "#FFFFFF", borderRadius: 14, padding: "16px 18px",
                border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: feedItems.length ? 12 : 4 }}>What's New</div>
                {feedItems.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.sub }}>Activity from your network will appear here.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {feedItems.slice(0, 5).map((item, i) => {
                      const av = feedAvatar(item);
                      return (
                        <a
                          key={i}
                          href={item.type === "vouch" ? `/person/${item.subject.id}` : item.type === "thread" ? `/thread/${item.access_token}` : undefined}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit",
                            padding: "6px 10px", borderRadius: 10, background: "#F9FAFB",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = "#F3F4F6"}
                          onMouseLeave={e => e.currentTarget.style.background = "#F9FAFB"}
                        >
                          <PhotoAvatar name={av.name} photoUrl={av.photo} size={28} />
                          <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ink, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {feedItemLabel(item)}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );

            const functionDropdown = (
              <>
                {!loading && reachableFunctions.length === 1 && (
                  <div style={{ marginBottom: 20 }}>
                    <select disabled style={{
                      width: "100%", padding: "10px 14px", fontSize: 16, fontFamily: FONT, fontWeight: 600,
                      border: `1.5px solid ${C.accent}`, borderRadius: 10, color: C.accent,
                      background: C.accentLight, cursor: "default",
                      WebkitAppearance: "none", appearance: "none",
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%234F46E5' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center",
                    }}>
                      <option>{reachableFunctions[0].practitionerLabel || reachableFunctions[0].name}</option>
                    </select>
                  </div>
                )}
                {!loading && reachableFunctions.length >= 2 && (
                  <div style={{ marginBottom: 20 }}>
                    <select
                      value={activeFunction || ""}
                      onChange={e => {
                        const val = e.target.value || null;
                        setActiveFunction(val);
                        setVisibleCount(10);
                        capture("talent_filter_changed", { function_filter: val || "all" });
                      }}
                      style={{
                        width: "100%", padding: "10px 14px", fontSize: 16, fontFamily: FONT, fontWeight: 600,
                        border: `1.5px solid ${C.border}`, borderRadius: 10, color: C.ink, background: "#fff", cursor: "pointer",
                        WebkitAppearance: "none", appearance: "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236B7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center",
                      }}
                    >
                      <option value="">Filter Your Network</option>
                      {reachableFunctions.map(jf => (
                        <option key={jf.slug} value={jf.slug}>{jf.practitionerLabel || jf.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            );

            const shimmerPlaceholders = loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} style={{
                    height: 62, borderRadius: 12,
                    background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)",
                    backgroundSize: "200% 100%", animation: `shimmer 1.2s ${i * 0.15}s infinite`,
                  }} />
                ))}
                <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
              </div>
            ) : null;

            const emptyState = !loading && talent.length === 0 ? (
              <div style={{ background: C.accentLight, borderRadius: 12, padding: "16px 18px", border: `1px solid ${C.chipBorder}` }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>No recommendations yet</div>
                <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, margin: 0 }}>
                  Ask your all-time best colleagues for recommendations by selecting a function in the box below.
                </p>
              </div>
            ) : null;

            const talentList = !loading && talent.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {talent.slice(0, visibleCount).map((t) => (
                  <TalentCard key={t.id} talent={t} />
                ))}
                {talent.length > visibleCount && (
                  <a href="#" onClick={e => { e.preventDefault(); setVisibleCount(v => v + 10); }}
                    style={{ display: "block", textAlign: "center", fontSize: 14, color: C.accent, fontWeight: 600, fontFamily: FONT, textDecoration: "none", padding: "8px 0", marginTop: 4 }}>
                    Show more ({talent.length - visibleCount} remaining)
                  </a>
                )}
              </div>
            ) : null;

            const vouchFunctionSlugs = Object.keys(myVouches)
              .filter(s => myVouches[s]?.vouches?.length > 0)
              .sort((a, b) => {
                const la = (reachableFunctions.find(f => f.slug === a)?.practitionerLabel || a).toLowerCase();
                const lb = (reachableFunctions.find(f => f.slug === b)?.practitionerLabel || b).toLowerCase();
                return la.localeCompare(lb);
              });
            const vouchVouches = vouchFunction ? (myVouches[vouchFunction]?.vouches || []) : [];
            const vouchToken = vouchFunction ? vouchTokens[vouchFunction] : null;

            const vouchDropdown = vouchFunctionSlugs.length >= 2 ? (
              <select
                value={vouchFunction || ""}
                onChange={e => setVouchFunction(e.target.value)}
                style={{
                  width: "100%", padding: "10px 14px", fontSize: 14, fontFamily: FONT,
                  color: C.ink, background: "#fff", border: `1.5px solid ${C.border}`,
                  borderRadius: 10, WebkitAppearance: "none", MozAppearance: "none",
                  appearance: "none", cursor: "pointer",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
                }}
              >
                {vouchFunctionSlugs.map(slug => (
                  <option key={slug} value={slug}>
                    {reachableFunctions.find(f => f.slug === slug)?.practitionerLabel || slug}
                  </option>
                ))}
              </select>
            ) : null;

            const vouchStatus = vouchFunctionSlugs.length === 0 || vouchVouches.length === 0 ? null : (
              <VouchStatusCard vouches={vouchVouches} vouchToken={vouchToken} shareToken={shareToken} label="" dropdown={vouchDropdown} />
            );

            const keepBuildingCTA = availableJobFunctions.length > 0 ? (
              <div style={{
                borderRadius: 14, marginTop: 24, marginBottom: 16,
                background: isMobile ? "#F5F3FF" : "#FFFFFF", border: `1px solid ${isMobile ? "#E9E5F5" : C.border}`,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                padding: "16px 18px",
              }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 4 }}>Keep Building Your Network</div>
                  <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, margin: "0 0 14px" }}>Which function should we work on next?</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <select value={selectedNextFn} onChange={e => setSelectedNextFn(e.target.value)}
                      style={{
                        flex: "1 1 200px", minWidth: 0, padding: "10px 12px", fontSize: 14, fontFamily: FONT,
                        border: `1.5px solid ${C.border}`, borderRadius: 10, color: selectedNextFn ? C.ink : C.sub,
                        background: "#fff", cursor: "pointer", WebkitAppearance: "none", appearance: "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2378716C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 32,
                      }}
                    >
                      <option value="" disabled>Select a function</option>
                      {availableJobFunctions.map(jf => (
                        <option key={jf.id} value={jf.id}>{jf.practitionerLabel || jf.name}</option>
                      ))}
                    </select>
                    <button disabled={!selectedNextFn || startingVouch}
                      onClick={async () => {
                        if (!selectedNextFn || startingVouch) return;
                        setStartingVouch(true);
                        try {
                          const controller = new AbortController();
                          const timeout = setTimeout(() => controller.abort(), 15000);
                          const res = await fetch("/api/start-vouch", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            credentials: "include", body: JSON.stringify({ jobFunctionId: Number(selectedNextFn) }),
                            signal: controller.signal,
                          });
                          clearTimeout(timeout);
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || "Failed");
                          window.location.href = `/vouch?token=${data.token}`;
                        } catch (err) {
                          console.error("[TalentPage] Start vouch error:", err);
                          setStartingVouch(false);
                          try {
                            fetch('/api/client-error', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ message: err.message, stack: err.stack, context: 'talent_page_start_vouch', url: window.location.href, userAgent: navigator.userAgent }),
                            }).catch(() => {})
                          } catch {}
                        }
                      }}
                      style={{
                        padding: "10px 20px",
                        background: selectedNextFn && !startingVouch ? C.accent : "#C7D2FE",
                        color: "#fff", border: "1.5px solid transparent", borderRadius: 10,
                        fontSize: 14, fontWeight: 600, fontFamily: FONT,
                        cursor: selectedNextFn && !startingVouch ? "pointer" : "not-allowed",
                        whiteSpace: "nowrap", flexShrink: 0,
                      }}
                    >
                      {startingVouch ? "..." : "Let's go"}
                    </button>
                  </div>
              </div>
            ) : null;

            const genericCTA = !loading && availableJobFunctions.length === 0 && activeJobFunctions.length === 0 ? (
              <div style={{
                background: "#FFFFFF", borderRadius: 14, border: `1.5px solid ${C.border}`,
                padding: "16px 18px", marginTop: 24, textAlign: "center",
              }}>
                <a href="/start-vouch" style={{
                  display: "inline-block", padding: "10px 22px", background: C.accent, color: "#fff",
                  borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: "none", fontFamily: FONT,
                }}>Start Vouching</a>
              </div>
            ) : null;

            /* ---- Layout ---- */
            if (isMobile) {
              return (
                <>
                  {userCard}
                  {brainPrompt}
                  {functionDropdown}
                  {shimmerPlaceholders}
                  {emptyState}
                  {talentList}
                  {vouchStatus}
                  {keepBuildingCTA}
                  {whatsNew}
                  {genericCTA}
                </>
              );
            }

            return (
              <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                <div style={{ flex: 2, minWidth: 0 }}>
                  {userCard}
                  {brainPrompt}
                  {keepBuildingCTA}
                  {whatsNew}
                  {vouchStatus}
                  {genericCTA}
                </div>
                <div style={{ flex: 1, minWidth: 0, position: "sticky", top: 76, alignSelf: "flex-start" }}>
                  {functionDropdown}
                  {shimmerPlaceholders}
                  {emptyState}
                  {talentList}
                </div>
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
