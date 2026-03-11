const C = {
  ink: "#1E1B18",
  accent: "#6D5BD0",
  sub: "#78716C",
  border: "#E7E5E2",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

export default function SharedHeader({ user, isMobile, children }) {
  return (
    <div style={{
      position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
      zIndex: 100, width: "100%",
      background: "#FFFFFF", padding: "10px 20px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: `1px solid ${C.border}`,
    }}>
      <a href="/brain" style={{ fontSize: 24, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none", flexShrink: 0 }}>
        Vouch<span style={{ color: C.accent }}>Four</span>
      </a>

      {user ? (
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 16, flex: 1, justifyContent: "flex-end", minWidth: 0, marginLeft: 16 }}>
          {/* Page-specific controls injected here (e.g. Brain avatar pill + bell) */}
          {children}

          {/* Logout */}
          <button
            onClick={() => {
              fetch("/api/auth/logout", { method: "POST", credentials: "include" })
                .then(() => { window.location.href = "/"; })
                .catch(() => { window.location.href = "/"; });
            }}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 4,
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
