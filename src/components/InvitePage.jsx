import { useState, useEffect } from "react";
import { capture } from "../lib/posthog.js";
import { gradientForName, initialsForName } from "../lib/avatar.js";

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentLight: "#EEF2FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  error: "#DC2626",
  errorLight: "#FEF2F2",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

function Avatar({ name, photoUrl, size = 56 }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }
  const bg = gradientForName(name || "?");
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: bg, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, color: "#fff", fontFamily: FONT,
    }}>
      {initialsForName(name || "?")}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function InvitePage() {
  const [state, setState] = useState("loading"); // loading | form | submitting | success | notfound
  const [voucherName, setVoucherName] = useState("");
  const [voucherPhotoUrl, setVoucherPhotoUrl] = useState(null);
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [personName, setPersonName] = useState("");

  const shareToken = window.location.pathname.split("/invite/")[1]?.split("?")[0] || "";

  useEffect(() => {
    if (!shareToken) {
      setState("notfound");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/invite/${shareToken}`);
        if (res.status === 404) {
          setState("notfound");
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setVoucherName(data.voucherName || "");
        setVoucherPhotoUrl(data.voucherPhotoUrl || null);
        setState("form");
        capture("invite_page_viewed", { share_token: shareToken });
      } catch {
        setState("notfound");
      }
    })();
  }, [shareToken]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!linkedinUrl.trim() || !email.trim()) return;

    const emailVal = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    setState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shareToken,
          linkedinUrl: linkedinUrl.trim(),
          email: email.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setState("form");
        return;
      }
      setPersonName(data.personName || "");
      setState("success");
      capture("invite_claim_submitted", { share_token: shareToken });
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setState("form");
    }
  }

  const voucherFirst = voucherName.split(" ")[0] || "Someone";

  return (
    <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
      {/* Header */}
      <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
      </div>

      {/* Body */}
      <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F6 15%, #FAF9F6 100%)", padding: "0 16px 40px", margin: "56px 0 0", minHeight: "calc(100vh - 56px)" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 24, minHeight: "calc(100vh - 96px)", display: "flex", flexDirection: "column" }}>

          {state === "loading" && (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.sub, fontSize: 15 }}>
              Loading…
            </div>
          )}

          {state === "notfound" && (
            <div style={{
              borderRadius: 18, padding: 2,
              background: "linear-gradient(135deg, #6366F1, #818CF8)",
              boxShadow: "0 4px 24px rgba(79,70,229,0.12)",
              marginTop: 70,
            }}>
              <div style={{
                background: C.accentLight, borderRadius: 16,
                padding: "36px 20px 32px", textAlign: "center",
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                  Invalid link
                </div>
                <div style={{ fontSize: 15, color: C.sub, lineHeight: 1.5 }}>
                  This invite link is not valid. Please check the link and try again.
                </div>
              </div>
            </div>
          )}

          {(state === "form" || state === "submitting") && (
            <div style={{
              borderRadius: 18, padding: 2,
              background: "linear-gradient(135deg, #6366F1, #818CF8)",
              boxShadow: "0 4px 24px rgba(79,70,229,0.12)",
              marginTop: 70,
            }}>
              <div style={{
                background: C.accentLight, borderRadius: 16,
                padding: "36px 20px 32px",
              }}>
                <p style={{
                  fontSize: 20, fontWeight: 700, color: C.ink, lineHeight: 1.4, fontFamily: FONT,
                  marginBottom: 6, marginTop: 0, textAlign: "center",
                }}>
                  Professional network built on{" "}<br />curated recommendations.
                </p>
                <p style={{
                  fontSize: 14, color: C.sub, fontFamily: FONT, marginBottom: 24,
                  fontStyle: "italic", textAlign: "center", marginTop: 0,
                }}>
                  Available by invitation only.
                </p>

                {/* Login card */}
                <div style={{
                  padding: "18px 20px",
                  background: "#fff", borderRadius: 12,
                  border: "1px solid #DBEAFE",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <Avatar name={voucherName} photoUrl={voucherPhotoUrl} size={32} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
                      {voucherName || voucherFirst} recommended you. Log in to accept the invitation:
                    </div>
                  </div>

                  <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      type="url"
                      value={linkedinUrl}
                      onChange={e => setLinkedinUrl(e.target.value)}
                      placeholder="LinkedIn profile URL"
                      autoComplete="url"
                      disabled={state === "submitting"}
                      style={{
                        width: "100%", padding: "12px 14px",
                        fontSize: 16, border: `1.5px solid ${C.border}`,
                        borderRadius: 10, fontFamily: FONT,
                        color: C.ink, background: "#fff",
                        WebkitAppearance: "none", boxSizing: "border-box",
                      }}
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="Email address"
                      autoComplete="email"
                      disabled={state === "submitting"}
                      style={{
                        width: "100%", padding: "12px 14px",
                        fontSize: 16, border: `1.5px solid ${C.border}`,
                        borderRadius: 10, fontFamily: FONT,
                        color: C.ink, background: "#fff",
                        WebkitAppearance: "none", boxSizing: "border-box",
                      }}
                    />

                    {errorMsg && (
                      <div style={{
                        padding: "10px 14px", background: C.errorLight, borderRadius: 10,
                        fontSize: 14, color: C.error, fontFamily: FONT,
                        lineHeight: 1.5,
                      }}>
                        {errorMsg}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={state === "submitting" || !linkedinUrl.trim() || !email.trim()}
                      style={{
                        width: "100%", padding: "12px 20px",
                        background: (linkedinUrl.trim() && email.trim() && state !== "submitting") ? C.accent : "#A5B4FC",
                        color: "#fff", border: "none", borderRadius: 10,
                        fontSize: 14, fontWeight: 600, fontFamily: FONT,
                        cursor: (linkedinUrl.trim() && email.trim() && state !== "submitting") ? "pointer" : "not-allowed",
                        transition: "background 0.15s",
                      }}
                    >
                      {state === "submitting" ? "Checking…" : "Log in"}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {state === "success" && (
            <div style={{
              borderRadius: 18, padding: 2,
              background: "linear-gradient(135deg, #6366F1, #818CF8)",
              boxShadow: "0 4px 24px rgba(79,70,229,0.12)",
              marginTop: 70,
            }}>
              <div style={{
                background: C.accentLight, borderRadius: 16,
                padding: "36px 20px 32px",
              }}>
                <p style={{
                  fontSize: 20, fontWeight: 700, color: C.ink, lineHeight: 1.4, fontFamily: FONT,
                  marginBottom: 6, marginTop: 0, textAlign: "center",
                }}>
                  Professional network built on{" "}<br />curated recommendations.
                </p>
                <p style={{
                  fontSize: 14, color: C.sub, fontFamily: FONT, marginBottom: 24,
                  fontStyle: "italic", textAlign: "center", marginTop: 0,
                }}>
                  Available by invitation only.
                </p>

                <div style={{
                  padding: "18px 20px",
                  background: "#fff", borderRadius: 12,
                  border: "1px solid #DBEAFE",
                }}>
                  <div style={{
                    padding: "12px 14px", borderRadius: 10,
                    background: C.successLight, border: "1px solid #86EFAC",
                  }}>
                    <div style={{ fontSize: 14, color: C.success, fontWeight: 600, marginBottom: 4, fontFamily: FONT }}>
                      Check your email
                    </div>
                    <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, fontFamily: FONT }}>
                      We sent a login link to <strong style={{ color: C.ink }}>{email}</strong>.
                      Click it to access your professional network{personName ? `, ${personName.split(" ")[0]}` : ""}.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
