import { useState, useEffect } from "react";

const C = {
  ink: "#171717",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentLight: "#EFF6FF",
  border: "#E7E5E0",
  success: "#16A34A",
  successLight: "#F0FDF4",
  warn: "#D97706",
  warnLight: "#FFFBEB",
  chipBorder: "#BFDBFE",
  danger: "#DC2626",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const TEMPLATE_LABELS = {
  vouch_invite: "Vouch Invite",
  login_link: "Login Link",
  please_vouch: "Please Vouch (Legacy)",
  you_were_vouched: "You Were Vouched (Legacy)",
  role_network: "Role Network (Legacy)",
  role_ready: "Role Ready (Legacy)",
  quick_ask: "Quick Ask",
  thread_invite: "Group Thread Invite",
  thread_reply_notification: "Group Thread Reply Notification",
};

function adminFetch(url, secret, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": secret,
      ...(options.headers || {}),
    },
  });
}

// ─── Section Card ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14, border: `1.5px solid ${C.border}`,
      padding: "20px 22px", marginBottom: 16,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 16, fontFamily: FONT }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Save Button ─────────────────────────────────────────────────────────────

function SaveButton({ onClick, saving, saved, label = "Save" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
      <button
        onClick={onClick}
        disabled={saving}
        style={{
          padding: "10px 22px",
          background: saving ? "#93C5FD" : C.accent,
          color: "#fff", border: "none", borderRadius: 8,
          fontSize: 13, fontWeight: 600, fontFamily: FONT,
          cursor: saving ? "default" : "pointer",
        }}
      >
        {saving ? "Saving..." : label}
      </button>
      {saved && (
        <span style={{ fontSize: 12, color: C.success, fontWeight: 500, fontFamily: FONT }}>Saved</span>
      )}
    </div>
  );
}

// ─── Input Row ───────────────────────────────────────────────────────────────

function InputRow({ label, value, onChange, type = "text", step, description }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: "block", fontSize: 12, fontWeight: 600,
        color: "#3730A3", marginBottom: 4, fontFamily: FONT,
      }}>
        {label}
      </label>
      {description && (
        <div style={{ fontSize: 11, color: C.sub, marginBottom: 4, fontFamily: FONT }}>{description}</div>
      )}
      <input
        type={type}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "10px 12px",
          fontSize: 14, border: `1.5px solid ${C.border}`,
          borderRadius: 8, fontFamily: FONT,
          color: C.ink, background: "#fff",
          WebkitAppearance: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ─── Email Mode Toggle ──────────────────────────────────────────────────────

function EmailToggle({ testMode, onToggle, saving }) {
  const isTest = testMode === "true";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <button
        onClick={() => onToggle(isTest ? "false" : "true")}
        disabled={saving}
        style={{
          width: 48, height: 26, borderRadius: 13,
          background: isTest ? C.warn : C.success,
          border: "none", cursor: saving ? "default" : "pointer",
          position: "relative", transition: "background 0.2s",
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: "50%",
          background: "#fff",
          position: "absolute", top: 3,
          left: isTest ? 3 : 25,
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }} />
      </button>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
          {isTest ? "Test mode" : "Live mode"}
        </div>
        <div style={{ fontSize: 11, color: C.sub, fontFamily: FONT, marginTop: 1 }}>
          {isTest
            ? "All emails go to josh@joshscott.me"
            : "Emails go to real recipients"}
        </div>
      </div>
    </div>
  );
}

// ─── Template Accordion ─────────────────────────────────────────────────────

function TemplateAccordion({ template, isOpen, onToggle, onChange }) {
  const label = TEMPLATE_LABELS[template.template_key] || template.template_key;
  const vars = (template.available_vars || "").split(",").filter(Boolean);

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 10,
      marginBottom: 8, overflow: "hidden",
    }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 14px", background: isOpen ? "#FAFAF9" : "#fff",
          border: "none", cursor: "pointer", fontFamily: FONT,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{label}</span>
        <span style={{
          fontSize: 18, color: C.sub, transition: "transform 0.2s",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          display: "inline-block",
        }}>
          v
        </span>
      </button>
      {isOpen && (
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}` }}>
          {vars.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 6, fontFamily: FONT }}>
                Available variables
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {vars.map(v => (
                  <span key={v} style={{
                    display: "inline-block", padding: "3px 10px",
                    background: C.accentLight, border: `1px solid ${C.chipBorder}`,
                    borderRadius: 12, fontSize: 11, fontFamily: "monospace",
                    color: C.accent, fontWeight: 500,
                  }}>
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <label style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "#3730A3", marginBottom: 4, fontFamily: FONT,
            }}>
              Subject line
            </label>
            <input
              value={template.subject}
              onChange={e => onChange(template.template_key, "subject", e.target.value)}
              style={{
                width: "100%", padding: "8px 10px",
                fontSize: 13, border: `1.5px solid ${C.border}`,
                borderRadius: 8, fontFamily: FONT,
                color: C.ink, background: "#fff",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "#3730A3", marginBottom: 4, fontFamily: FONT,
            }}>
              Body HTML
            </label>
            <textarea
              value={template.body_html}
              onChange={e => onChange(template.template_key, "body_html", e.target.value)}
              rows={15}
              style={{
                width: "100%", padding: "10px 12px",
                fontSize: 12, border: `1.5px solid ${C.border}`,
                borderRadius: 8, fontFamily: "monospace",
                color: C.ink, background: "#FAFAF9",
                resize: "vertical", lineHeight: 1.5,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ────────────────────────────────────────────────────────

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Data
  const [settings, setSettings] = useState({});
  const [coefficients, setCoefficients] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);

  // Save states
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSettings, setSavedSettings] = useState(false);
  const [savingCoeffs, setSavingCoeffs] = useState(false);
  const [savedCoeffs, setSavedCoeffs] = useState(false);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);

  // Accordion
  const [openTemplate, setOpenTemplate] = useState(null);

  // Brain starters
  const [brainStarters, setBrainStarters] = useState([]);
  const [savingStarters, setSavingStarters] = useState(false);
  const [savedStarters, setSavedStarters] = useState(false);

  // Auto-authenticate from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem("vouchfour_admin_secret");
    if (saved) {
      setSecret(saved);
      adminFetch("/api/admin/settings", saved)
        .then(res => { if (res.ok) { setAuthed(true); loadAllData(saved); } })
        .catch(() => {});
    }
  }, []);

  async function handleAuth(e) {
    e?.preventDefault();
    if (!secret.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await adminFetch("/api/admin/settings", secret.trim());
      if (!res.ok) throw new Error("Invalid password");
      setAuthed(true);
      sessionStorage.setItem("vouchfour_admin_secret", secret.trim());
      loadAllData(secret.trim());
    } catch {
      setAuthError("Invalid admin password");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadAllData(sec) {
    setLoading(true);
    try {
      const [settingsRes, coeffsRes, templatesRes, startersRes] = await Promise.all([
        adminFetch("/api/admin/settings", sec),
        adminFetch("/api/admin/coefficients", sec),
        adminFetch("/api/admin/email-templates", sec),
        fetch("/api/brain-starters"),
      ]);
      const settingsData = await settingsRes.json();
      const coeffsData = await coeffsRes.json();
      const templatesData = await templatesRes.json();
      const startersData = await startersRes.json();
      setSettings(settingsData.settings || {});
      setCoefficients(coeffsData.coefficients || []);
      setTemplates((templatesData.templates || []).filter(t => TEMPLATE_LABELS[t.template_key]));
      setBrainStarters(startersData.starters || []);
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    setSavedSettings(false);
    try {
      const res = await adminFetch("/api/admin/settings", secret.trim(), {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            cross_function_discount: settings.cross_function_discount,
            sibling_coefficient: settings.sibling_coefficient,
            quick_ask_max_recipients: settings.quick_ask_max_recipients,
            quick_ask_max_sends_per_week: settings.quick_ask_max_sends_per_week,
            quick_ask_max_receives_per_week: settings.quick_ask_max_receives_per_week,
            thread_max_participants: settings.thread_max_participants,
            thread_notification_throttle_minutes: settings.thread_notification_throttle_minutes,
          },
        }),
      });
      const data = await res.json();
      setSettings(data.settings);
      setSavedSettings(true);
      setTimeout(() => setSavedSettings(false), 2000);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveCoefficients() {
    setSavingCoeffs(true);
    setSavedCoeffs(false);
    try {
      const res = await adminFetch("/api/admin/coefficients", secret.trim(), {
        method: "PUT",
        body: JSON.stringify({ coefficients }),
      });
      const data = await res.json();
      setCoefficients(data.coefficients);
      setSavedCoeffs(true);
      setTimeout(() => setSavedCoeffs(false), 2000);
    } catch (err) {
      console.error("Failed to save coefficients:", err);
    } finally {
      setSavingCoeffs(false);
    }
  }

  async function toggleEmailMode(newValue) {
    setSavingToggle(true);
    try {
      const res = await adminFetch("/api/admin/settings", secret.trim(), {
        method: "PUT",
        body: JSON.stringify({ settings: { email_test_mode: newValue } }),
      });
      const data = await res.json();
      setSettings(data.settings);
    } catch (err) {
      console.error("Failed to toggle email mode:", err);
    } finally {
      setSavingToggle(false);
    }
  }

  async function saveTemplates() {
    setSavingTemplates(true);
    setSavedTemplates(false);
    try {
      const res = await adminFetch("/api/admin/email-templates", secret.trim(), {
        method: "PUT",
        body: JSON.stringify({
          templates: templates.map(t => ({
            template_key: t.template_key,
            subject: t.subject,
            body_html: t.body_html,
          })),
        }),
      });
      const data = await res.json();
      setTemplates(data.templates);
      setSavedTemplates(true);
      setTimeout(() => setSavedTemplates(false), 2000);
    } catch (err) {
      console.error("Failed to save templates:", err);
    } finally {
      setSavingTemplates(false);
    }
  }

  async function saveBrainStarters() {
    setSavingStarters(true);
    setSavedStarters(false);
    try {
      const res = await adminFetch("/api/brain-starters", secret.trim(), {
        method: "PUT",
        body: JSON.stringify({ starters: brainStarters.filter(s => s.trim()) }),
      });
      const data = await res.json();
      setBrainStarters(data.starters || []);
      setSavedStarters(true);
      setTimeout(() => setSavedStarters(false), 2000);
    } catch (err) {
      console.error("Failed to save brain starters:", err);
    } finally {
      setSavingStarters(false);
    }
  }

  function updateTemplate(templateKey, field, value) {
    setTemplates(prev =>
      prev.map(t =>
        t.template_key === templateKey ? { ...t, [field]: value } : t
      )
    );
  }

  function updateCoefficient(degree, value) {
    setCoefficients(prev =>
      prev.map(c =>
        c.degree === degree ? { ...c, coefficient: value } : c
      )
    );
  }

  // ─── Password gate ──────────────────────────────────────────────────

  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
        <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
          <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
            Vouch<span style={{ color: C.accent }}>Four</span>
          </a>
          <span style={{ fontSize: 12, color: C.sub, marginLeft: 10, fontFamily: FONT }}>Admin</span>
        </div>
        <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px", borderRadius: 0, margin: "52px 0 0" }}>

          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ paddingTop: 40 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                Admin Access
              </div>
              <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.5, marginBottom: 20 }}>
                Enter the admin password to continue.
              </p>
              <form onSubmit={handleAuth} style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="Admin password"
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
                  disabled={!secret.trim() || authLoading}
                  style={{
                    padding: "12px 20px",
                    background: secret.trim() && !authLoading ? C.accent : "#C7D2FE",
                    color: "#fff", border: "none", borderRadius: 10,
                    fontSize: 14, fontWeight: 600, fontFamily: FONT,
                    cursor: secret.trim() && !authLoading ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {authLoading ? "..." : "Enter"}
                </button>
              </form>
              {authError && (
                <div style={{ marginTop: 10, fontSize: 13, color: C.danger, fontFamily: FONT }}>
                  {authError}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Admin dashboard ────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#000000", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", overflowX: "hidden" }}>
      {/* Fixed logo bar */}
      <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, width: "100%", background: "#FFFFFF", padding: "12px 20px" }}>
        <a href="/" style={{ fontSize: 28, fontWeight: 700, color: C.ink, letterSpacing: -0.5, textDecoration: "none" }}>
          Vouch<span style={{ color: C.accent }}>Four</span>
        </a>
        <span style={{ fontSize: 12, color: C.sub, marginLeft: 10, fontFamily: FONT }}>Admin</span>
      </div>
      <div style={{ width: "100%", background: "linear-gradient(180deg, #FFFFFF 0%, #F0DDD6 30%, #DDD0F0 65%, #DDD0F0 100%)", padding: "0 16px 120px", borderRadius: 0, margin: "52px 0 0" }}>

        <div style={{ maxWidth: 540, margin: "0 auto" }}>

          {loading ? (
            <div style={{ textAlign: "center", paddingTop: 60 }}>
              <div style={{ fontSize: 15, color: C.sub }}>Loading...</div>
            </div>
          ) : (
            <>
              {/* Enrichment Review Link */}
              <a
                href="/admin/review"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#FFFFFF",
                  borderRadius: 14,
                  border: `1.5px solid ${C.border}`,
                  padding: "16px 22px",
                  marginBottom: 16,
                  textDecoration: "none",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
                    Enrichment Review
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 2 }}>
                    Review AI-generated profiles for accuracy
                  </div>
                </div>
                <span style={{ fontSize: 18, color: C.sub }}>→</span>
              </a>

              {/* Email Mode Toggle */}
              <Section title="Email Delivery">
                <EmailToggle
                  testMode={settings.email_test_mode || "true"}
                  onToggle={toggleEmailMode}
                  saving={savingToggle}
                />

              </Section>

              {/* Network Scoring */}
              <Section title="Network Scoring">
                <p style={{ fontSize: 12, color: C.sub, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
                  Multipliers that adjust scores for talent discovered through indirect network paths.
                  Lower values = stronger discount. Applied on top of degree coefficients.
                </p>
                <InputRow
                  label="Sibling coefficient"
                  description="Multiplier for talent reached via sponsors' other vouchees (0-1)"
                  type="number"
                  step="0.01"
                  value={settings.sibling_coefficient || ""}
                  onChange={v => setSettings(s => ({ ...s, sibling_coefficient: v }))}
                />
                <InputRow
                  label="Cross-function discount"
                  description="Multiplier for talent reached through cross-function bridges (0-1)"
                  type="number"
                  step="0.01"
                  value={settings.cross_function_discount || ""}
                  onChange={v => setSettings(s => ({ ...s, cross_function_discount: v }))}
                />
                <SaveButton onClick={saveSettings} saving={savingSettings} saved={savedSettings} />
              </Section>

              {/* Quick Ask Limits */}
              <Section title="Quick Ask Limits">
                <p style={{ fontSize: 12, color: C.sub, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
                  Rate limits for the Quick Ask outreach feature. Controls how many messages
                  users can send and receive through the network.
                </p>
                <InputRow
                  label="Max recipients per ask"
                  description="Maximum people a user can message in a single ask"
                  type="number"
                  value={settings.quick_ask_max_recipients || ""}
                  onChange={v => setSettings(s => ({ ...s, quick_ask_max_recipients: v }))}
                />
                <InputRow
                  label="Max sends per week (sender)"
                  description="Maximum asks a user can send per rolling 7-day window"
                  type="number"
                  value={settings.quick_ask_max_sends_per_week || ""}
                  onChange={v => setSettings(s => ({ ...s, quick_ask_max_sends_per_week: v }))}
                />
                <InputRow
                  label="Max receives per week (recipient)"
                  description="Maximum asks a person can receive per rolling 7-day window"
                  type="number"
                  value={settings.quick_ask_max_receives_per_week || ""}
                  onChange={v => setSettings(s => ({ ...s, quick_ask_max_receives_per_week: v }))}
                />
                <SaveButton onClick={saveSettings} saving={savingSettings} saved={savedSettings} />
              </Section>

              {/* Group Threads */}
              <Section title="Group Threads">
                <p style={{ fontSize: 12, color: C.sub, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
                  Settings for the group thread conversation feature.
                </p>
                <InputRow
                  label="Max participants per thread"
                  description="Maximum number of people that can be added to a thread"
                  type="number"
                  value={settings.thread_max_participants || ""}
                  onChange={v => setSettings(s => ({ ...s, thread_max_participants: v }))}
                />
                <InputRow
                  label="Notification throttle (minutes)"
                  description="Minimum time between reply notification emails per thread per person"
                  type="number"
                  value={settings.thread_notification_throttle_minutes || ""}
                  onChange={v => setSettings(s => ({ ...s, thread_notification_throttle_minutes: v }))}
                />
                <SaveButton onClick={saveSettings} saving={savingSettings} saved={savedSettings} />
              </Section>

              {/* Degree Coefficients */}
              <Section title="Degree Coefficients">
                <p style={{ fontSize: 12, color: C.sub, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
                  Scoring multipliers for different relationship distances. Higher = more weight.
                </p>
                {coefficients.map(c => (
                  <InputRow
                    key={c.degree}
                    label={`Degree ${c.degree} (${c.degree === 1 ? "direct" : c.degree === 2 ? "2 hops" : "3 hops"})`}
                    type="number"
                    step="0.001"
                    value={c.coefficient}
                    onChange={v => updateCoefficient(c.degree, v)}
                  />
                ))}
                <SaveButton onClick={saveCoefficients} saving={savingCoeffs} saved={savedCoeffs} />
              </Section>

              {/* Brain Starter Questions */}
              <Section title="Brain Starter Questions">
                <p style={{ fontSize: 12, color: C.sub, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
                  Suggestion chips shown below the Brain prompt on the talent page. Empty rows are removed on save.
                </p>
                {brainStarters.map((q, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <input
                      value={q}
                      onChange={e => {
                        const updated = [...brainStarters];
                        updated[i] = e.target.value;
                        setBrainStarters(updated);
                      }}
                      style={{
                        flex: 1, padding: "8px 12px", fontSize: 13, fontFamily: FONT,
                        border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.ink,
                      }}
                      placeholder="e.g. Who has startup founding experience?"
                    />
                    <button
                      onClick={() => setBrainStarters(brainStarters.filter((_, j) => j !== i))}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 18, color: C.sub, padding: "4px 8px", lineHeight: 1,
                      }}
                    >×</button>
                  </div>
                ))}
                <button
                  onClick={() => setBrainStarters([...brainStarters, ""])}
                  style={{
                    background: "none", border: `1.5px dashed ${C.border}`, borderRadius: 8,
                    padding: "8px 14px", fontSize: 12, color: C.accent, fontWeight: 600,
                    fontFamily: FONT, cursor: "pointer", marginBottom: 12, width: "100%",
                  }}
                >+ Add question</button>
                <SaveButton onClick={saveBrainStarters} saving={savingStarters} saved={savedStarters} />
              </Section>

              {/* Email Templates */}
              <Section title="Email Templates">
                <p style={{ fontSize: 12, color: C.sub, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
                  Edit the subject lines and body HTML for each email type. Use {"{{variable}}"} placeholders
                  for dynamic content. The header (VouchFour logo) and footer are applied automatically.
                </p>
                {templates.map(t => (
                  <TemplateAccordion
                    key={t.template_key}
                    template={t}
                    isOpen={openTemplate === t.template_key}
                    onToggle={() => setOpenTemplate(
                      openTemplate === t.template_key ? null : t.template_key
                    )}
                    onChange={updateTemplate}
                  />
                ))}
                <SaveButton
                  onClick={saveTemplates}
                  saving={savingTemplates}
                  saved={savedTemplates}
                  label="Save All Templates"
                />
              </Section>
            </>
          )}

          {/* Footer */}
          <p style={{
            marginTop: 40, fontSize: 11, color: "#78716C",
            lineHeight: 1.5, textAlign: "center", padding: "0 12px",
          }}>
            VouchFour Admin Panel
          </p>
        </div>
      </div>
    </div>
  );
}
