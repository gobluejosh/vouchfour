import { useState, useEffect } from "react";
import { capture, identify } from "../lib/posthog.js";

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chipBorder: "#BFDBFE",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const JOB_FUNCTIONS = [
  { id: 16, name: "Coaches", slug: "coaches" },
  { id: 17, name: "Communications / PR", slug: "communications" },
  { id: 18, name: "Consultants", slug: "consultants" },
  { id: 10, name: "Customer Success", slug: "customer-success" },
  { id: 6, name: "Data / Analytics", slug: "data" },
  { id: 5, name: "Design (Product/UX)", slug: "design" },
  { id: 1, name: "Engineering / Software Development", slug: "engineering" },
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
];

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function StartVouchPage() {
  const [authState, setAuthState] = useState("checking");
  const [user, setUser] = useState(null);
  const [personId, setPersonId] = useState(null);
  const [firstName, setFirstName] = useState(null);
  const [vouchedFunctions, setVouchedFunctions] = useState(new Set());
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);

  // Check session + sessionStorage on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("token");
    const endpoint = loginToken
      ? `/api/auth/validate?token=${loginToken}`
      : "/api/auth/session";

    fetch(endpoint, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Not authenticated");
        return r.json();
      })
      .then((data) => {
        setUser(data.user);
        setFirstName(data.user?.name?.split(" ")[0] || null);
        setAuthState("authenticated");
        if (data.user?.id) identify(data.user.id, { name: data.user.name });
        capture("start_vouch_page_viewed", { auth_state: "authenticated" });
        if (loginToken) {
          const url = new URL(window.location);
          url.searchParams.delete("token");
          window.history.replaceState({}, "", url.pathname);
        }
      })
      .catch(() => {
        // Not authenticated — check for personId from homepage identity form
        const storedPersonId = sessionStorage.getItem("vouchfour_personId");
        if (storedPersonId) {
          setPersonId(Number(storedPersonId));
          setFirstName(sessionStorage.getItem("vouchfour_firstName") || null);
          setAuthState("identified");
          identify(storedPersonId, { name: sessionStorage.getItem("vouchfour_firstName") || undefined });
          capture("start_vouch_page_viewed", { auth_state: "identified" });
        } else {
          // No identity — redirect to homepage
          window.location.href = "/";
        }
      });
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    fetch("/api/my-vouch-functions", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setVouchedFunctions(new Set(data.vouchedFunctions || [])))
      .catch(() => {});
  }, [authState]);

  const handleFunctionClick = async (jf) => {
    setLoading(jf.id);
    setError(null);
    capture("vouch_function_selected", {
      job_function: jf.name,
      job_function_slug: jf.slug,
      already_vouched: vouchedFunctions.has(jf.slug),
    });
    try {
      const bodyData = { jobFunctionId: jf.id };
      if (authState === "identified" && personId) {
        bodyData.personId = personId;
      }
      const res = await fetch("/api/start-vouch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(bodyData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start vouch");
      sessionStorage.setItem("vouchfour_hasVouched", "true");
      window.location.href = `/vouch?token=${data.token}`;
    } catch (err) {
      setError(err.message);
      setLoading(null);
    }
  };

  const isChecking = authState === "checking";

  return (
    <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
      {/* Fixed logo bar */}
      <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
        <a href="/" style={{ textDecoration: "none" }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, fontFamily: FONT }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </span>
        </a>
      </div>
      <div style={{
        width: "100%",
        background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px",
        borderRadius: 0, margin: "52px 0 0",
      }}>

        <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 6 }}>
          {isChecking ? (
            <>
              <div style={{ height: 28, width: "60%", borderRadius: 6, marginBottom: 10, background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.2s infinite" }} />
              <div style={{ height: 16, width: "85%", borderRadius: 6, marginBottom: 28, background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.2s 0.1s infinite" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0,1,2,3,4,5,6,7,8,9].map(i => (
                  <div key={i} style={{
                    height: 52, borderRadius: 10,
                    background: "linear-gradient(90deg, #c0ddd0 25%, #b7d4c7 50%, #c0ddd0 75%)",
                    backgroundSize: "200% 100%",
                    animation: `shimmer 1.2s ${i * 0.08}s infinite`,
                  }} />
                ))}
              </div>
              <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
            </>
          ) : (
          <>
          <h1 style={{
            fontSize: 22, fontWeight: 700, color: C.ink,
            margin: "0 0 8px", lineHeight: 1.3,
          }}>
            {(() => {
              const hasVouched = vouchedFunctions.size > 0 || sessionStorage.getItem("vouchfour_hasVouched");
              if (firstName && hasVouched) return `Let's keep going, ${firstName}.`;
              if (firstName && authState === "authenticated") return `Welcome back, ${firstName}.`;
              if (firstName) return `Nice to meet you, ${firstName}.`;
              return "Welcome.";
            })()}
          </h1>
          <p style={{ fontSize: 14, color: C.sub, margin: "0 0 28px", lineHeight: 1.5 }}>
            {vouchedFunctions.size > 0 || sessionStorage.getItem("vouchfour_hasVouched")
              ? "What function do you want to focus on next?"
              : "As we build out your trusted talent network, what function do you want to focus on first?"}
          </p>

          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: "#FEF2F2", border: "1.5px solid #FCA5A5",
              marginBottom: 16, fontSize: 13, color: "#991B1B",
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {JOB_FUNCTIONS.map((jf) => {
              const alreadyVouched = vouchedFunctions.has(jf.slug);
              const isLoading = loading === jf.id;
              return (
                <button
                  key={jf.id}
                  onClick={() => handleFunctionClick(jf)}
                  disabled={isLoading}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 16px", borderRadius: 10,
                    border: `1.5px solid ${alreadyVouched ? C.success : "#C7D2FE"}`,
                    background: alreadyVouched ? C.successLight : "#fff",
                    cursor: isLoading ? "wait" : "pointer",
                    textAlign: "left", fontFamily: FONT,
                    transition: "border-color 0.15s",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#1E1B4B", lineHeight: 1.3 }}>
                      {jf.name}
                    </div>
                    {alreadyVouched && (
                      <div style={{
                        fontSize: 11, color: C.success, fontWeight: 600,
                        marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4,
                      }}>
                        Already vouched — update your picks
                      </div>
                    )}
                  </div>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke={alreadyVouched ? C.success : C.sub}
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              );
            })}
          </div>

          <p style={{ fontSize: 13, color: "#7C6FA0", margin: "18px 0 0", lineHeight: 1.5, textAlign: "center" }}>
            You'll vouch for the 4 best professionals you've worked with in that function.
          </p>

          {authState === "authenticated" && user?.linkedin && (
            <div style={{ marginTop: 28, textAlign: "center" }}>
              <a
                href={`/talent/${user.linkedin.match(/\/in\/([^/]+)/)?.[1] || ""}`}
                style={{ fontSize: 13, color: C.accent, textDecoration: "none", fontWeight: 500 }}
              >
                View your talent network results
              </a>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
