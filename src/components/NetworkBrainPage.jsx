import { useState, useEffect, useRef, useMemo } from "react";
import { capture, identify } from "../lib/posthog.js";
import { gradientForName, initialsForName } from "../lib/avatar.js";
import QuickAskDraftPanel from "./QuickAskDraftPanel.jsx";
import ThreadDraftPanel from "./ThreadDraftPanel.jsx";
import SharedHeader from "./SharedHeader.jsx";

const C = {
  ink: "#1E1B18",
  sub: "#78716C",
  accent: "#6D5BD0",
  accentLight: "#F0EDFF",
  border: "#E7E5E2",
  terracotta: "#C06329",
  userBubble: "#FBF5ED",
  userBubbleBorder: "#E2DDD6",
  bg: "#FAF9F6",
  success: "#16A34A",
  successLight: "#F0FDF4",
  chipBg: "#F0EDFF",
  chipBorder: "#D4CAFE",
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

const DEGREE_AVATAR_GRADIENTS = {
  1: "linear-gradient(135deg, #7C6CD8, #6D5BD0)",
  2: "linear-gradient(135deg, #34D399, #16A34A)",
  3: "linear-gradient(135deg, #A78BFA, #7C3AED)",
};

const GIVE_TYPES = [
  { key: "talent_recommendations", label: "Talent recommendations" },
  { key: "reference_checks", label: "Reference checks" },
  { key: "informational_interviews", label: "Brief informational interviews about my role or career" },
  { key: "experience_advice", label: "Advice based on my experience" },
  { key: "gut_checks", label: "Gut-checks / sounding board conversations" },
  { key: "candid_feedback", label: "Candid feedback" },
  { key: "introductions", label: "Introductions" },
  { key: "resume_reviews", label: "Resume reviews" },
  { key: "referrals", label: "Referrals" },
];

// Starter questions fetched from admin-configurable site_settings

// ── Tiny components ────────────────────────────────────────────────────

function Avatar({ name, size = 34, degree }) {
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

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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

// ── Simple markdown renderer ───────────────────────────────────────────
// ctx = { people, onOpenPerson } — threaded through for person chips

function renderMarkdown(text, ctx) {
  if (!text) return null;

  // Split into lines
  const lines = text.split("\n");
  const elements = [];
  let currentList = [];
  let key = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={key++} style={{ margin: "8px 0", paddingLeft: 20, listStyleType: "disc" }}>
          {currentList.map((item, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: C.ink, marginBottom: 4 }}>
              {renderInline(item, ctx)}
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
      continue;
    }
    flushList();

    if (line.trim() === "") {
      elements.push(<div key={key++} style={{ height: 8 }} />);
    } else if (line.startsWith("**") && line.endsWith("**")) {
      // Bold heading line
      elements.push(
        <div key={key++} style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 12, marginBottom: 4 }}>
          {line.replace(/\*\*/g, "")}
        </div>
      );
    } else {
      elements.push(
        <p key={key++} style={{ fontSize: 14, lineHeight: 1.6, color: C.ink, margin: "4px 0" }}>
          {renderInline(line, ctx)}
        </p>
      );
    }
  }
  flushList();
  return elements;
}

function renderInline(text, ctx) {
  // Split on **bold**, [link](url), and {{person:ID:Name}} tokens
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\{\{person:\d+:[^}]+\}\})/g);
  return parts.map((part, i) => {
    // Person token: {{person:ID:Name}}
    const personMatch = part.match(/^\{\{person:(\d+):([^}]+)\}\}$/);
    if (personMatch && ctx) {
      const personId = Number(personMatch[1]);
      const personName = personMatch[2];
      const person = ctx.people?.find(p => p.id === personId);
      return (
        <PersonNameChip
          key={`person-${personId}-${i}`}
          person={person || { id: personId, name: personName }}
          onTap={(p) => ctx.onOpenPerson?.(p)}
        />
      );
    }
    // Bold: **text** — recursively render inner content to handle links/tokens inside bold
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      return <strong key={i} style={{ fontWeight: 600 }}>{renderInlineInner(inner, ctx)}</strong>;
    }
    // Link: [text](url) — backward compat with old sessionStorage messages
    const lm = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (lm) {
      return <a key={i} href={lm[2]} style={{ color: C.accent, textDecoration: "none" }}>{lm[1]}</a>;
    }
    return part;
  });
}

// Handle links + person tokens inside already-matched bold sections
function renderInlineInner(text, ctx) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\{\{person:\d+:[^}]+\}\})/g);
  return parts.map((part, i) => {
    // Person token inside bold
    const personMatch = part.match(/^\{\{person:(\d+):([^}]+)\}\}$/);
    if (personMatch && ctx) {
      const personId = Number(personMatch[1]);
      const personName = personMatch[2];
      const person = ctx.people?.find(p => p.id === personId);
      return (
        <PersonNameChip
          key={`person-${personId}-${i}`}
          person={person || { id: personId, name: personName }}
          onTap={(p) => ctx.onOpenPerson?.(p)}
        />
      );
    }
    const lm = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (lm) {
      return <a key={i} href={lm[2]} style={{ fontWeight: 600, color: C.accent, textDecoration: "none" }}>{lm[1]}</a>;
    }
    return part;
  });
}

// Inject {{person:ID:Name}} tokens into brain answer text (replaces old link approach)
function linkifyNamesAsTokens(text, people) {
  if (!text || !people?.length) return text;
  // Sort longest names first to avoid partial replacement issues
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const p of sorted) {
    const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const token = `{{person:${p.id}:${p.name}}}`;
    // Replace **Name** → **{{person:ID:Name}}**
    result = result.replaceAll(`**${p.name}**`, `**${token}**`);
    // Replace remaining plain Name → {{person:ID:Name}}
    // Negative lookbehind for { prevents double-tokenizing
    const re = new RegExp(`(?<!\\{)\\b${esc}\\b(?!\\})`, "g");
    result = result.replace(re, token);
  }
  return result;
}

// Keep old linkifyNames for backward compat with sessionStorage messages
function linkifyNames(text, people) {
  if (!text || !people?.length) return text;
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const p of sorted) {
    const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const link = `[${p.name}](/person/${p.id})`;
    result = result.replaceAll(`**${p.name}**`, `**${link}**`);
    const re = new RegExp(`(?<!\\[)\\b${esc}\\b(?![\\]\\(])`, "g");
    result = result.replace(re, link);
  }
  return result;
}

// ── Photo avatar ──────────────────────────────────────────────────────

function isPlaceholderPhoto(url) {
  return url && url.includes("static.licdn.com");
}

function PhotoAvatar({ name, photoUrl, size = 36, degree }) {
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

// ── Inline person expansion components ────────────────────────────────

function PersonNameChip({ person, onTap }) {
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onTap?.(person); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px 2px 2px",
        background: C.chipBg, border: `1px solid ${C.chipBorder}`,
        borderRadius: 12, cursor: "pointer",
        transition: "all 0.15s", verticalAlign: "middle",
        lineHeight: 1,
      }}
    >
      <PhotoAvatar name={person.name} photoUrl={person.photo_url} size={20} degree={person.degree} />
      <span style={{ fontSize: 13, fontWeight: 600, color: C.accent, fontFamily: FONT }}>
        {person.name}
      </span>
    </span>
  );
}

function PersonInlineCard({ person, onCollapse }) {
  const subtitle = [person.current_title, person.current_company].filter(Boolean).join(" at ");
  const snippet = person.evidence || person.ai_summary_snippet || null;
  const firstName = (name) => (name || "").split(/\s+/)[0];

  // For permission-blocked contacts, find the intermediary (person before target in vouch path)
  const intermediary = (!person.can_ask && person.vouch_path?.length >= 3)
    ? person.vouch_path[person.vouch_path.length - 2] // second-to-last is the intermediary
    : null;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onCollapse?.(); }}
      style={{
        display: "block", margin: "8px 0",
        background: C.accentLight, border: `1px solid #D4CAFE`,
        borderRadius: 12, padding: "12px 14px",
        cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <PhotoAvatar name={person.name} photoUrl={person.photo_url} size={36} degree={person.degree} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: C.ink, fontFamily: FONT }}>{person.name}</div>
          {subtitle && (
            <div style={{
              fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {subtitle}
            </div>
          )}
          {snippet && (
            <div style={{
              fontSize: 12, color: C.ink, fontFamily: FONT,
              marginTop: 6, lineHeight: 1.5, opacity: 0.8,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {snippet}
            </div>
          )}
          <VouchPath path={person.vouch_path} />
          {/* Permission-blocked: suggest intermediary */}
          {!person.can_ask && intermediary && (
            <div style={{
              fontSize: 12, color: C.sub, fontFamily: FONT,
              marginTop: 6, lineHeight: 1.4, fontStyle: "italic",
            }}>
              {person.name.split(" ")[0]} isn't accepting direct messages, but you're connected through{" "}
              <strong style={{ color: C.ink, fontStyle: "normal" }}>{intermediary.name}</strong>
              {" — you could ask " + firstName(intermediary.name) + " for an introduction."}
            </div>
          )}
          {/* View profile link */}
          <a
            href={`/person/${person.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-block", marginTop: 8,
              fontSize: 12, fontWeight: 600, color: C.accent,
              textDecoration: "none", fontFamily: FONT,
            }}
          >
            View profile →
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Person card ────────────────────────────────────────────────────────

function VouchPath({ path }) {
  if (!path || path.length < 2) return null;
  // path = [{id, name, photo_url}, ...] from user to target
  // Show intermediate nodes (skip first "you" and last "target" since target is already shown)
  const intermediates = path.slice(1, -1);
  if (intermediates.length === 0) return null; // 1st degree — no intermediary

  const firstName = (name) => (name || "").split(/\s+/)[0];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      marginTop: 6, paddingTop: 6,
      borderTop: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 11, color: C.sub, fontFamily: FONT, marginRight: 2 }}>via</span>
      {intermediates.map((node, i) => (
        <a
          key={node.id}
          href={`/person/${node.id}`}
          onClick={e => e.stopPropagation()}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            textDecoration: "none",
          }}
        >
          <PhotoAvatar name={node.name} photoUrl={node.photo_url} size={20} />
          <span style={{ fontSize: 11, fontWeight: 500, color: C.accent, fontFamily: FONT }}>
            {firstName(node.name)}
          </span>
          {i < intermediates.length - 1 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )}
        </a>
      ))}
    </div>
  );
}

function PersonCard({ person, showCheckbox, isSelected, onToggle }) {
  const subtitle = [person.current_title, person.current_company].filter(Boolean).join(" at ");
  const canCheck = person.can_ask !== false;

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: "10px 14px",
        background: isSelected ? C.accentLight : "#FFFFFF",
        borderRadius: 12,
        border: `1.5px solid ${isSelected ? C.accent : C.border}`,
        transition: "all 0.15s",
      }}
    >
      {showCheckbox && (
        canCheck ? (
          <div
            onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle?.(person.id); }}
            style={{
              width: 20, height: 20, borderRadius: 6,
              border: `2px solid ${isSelected ? C.accent : C.border}`,
              background: isSelected ? C.accent : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "all 0.15s", cursor: "pointer",
              marginTop: 8,
            }}
          >
            {isSelected && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        ) : (
          <div className="disabled-check-tip" style={{ position: "relative", flexShrink: 0, marginTop: 8 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 6,
              border: `2px solid ${C.border}`,
              background: "#F5F5F4", opacity: 0.5,
              cursor: "not-allowed",
            }} />
          </div>
        )
      )}
      <a
        href={`/person/${person.id}`}
        style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          flex: 1, minWidth: 0,
          textDecoration: "none", cursor: "pointer",
        }}
      >
        <PhotoAvatar name={person.name} photoUrl={person.photo_url} size={36} degree={person.degree} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: C.ink, fontFamily: FONT }}>{person.name}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: "auto" }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: C.ink, fontFamily: FONT, marginTop: 2, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtitle}
            </div>
          )}
          {person.evidence && (
            <div style={{
              fontSize: 11, color: C.sub, fontFamily: FONT,
              marginTop: 4, lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              ↳ {person.evidence}
            </div>
          )}
          <VouchPath path={person.vouch_path} />
        </div>
      </a>
    </div>
  );
}

// ── People mentioned — avatar strip + expand ─────────────────────────

function PeopleMentioned({ people, selectedPeople, onTogglePerson, style: outerStyle, defaultExpanded = false, showCheckboxes = false, maxRecipients = 3 }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!people || people.length === 0) return null;

  const selectedCount = selectedPeople?.size || 0;

  return (
    <div style={outerStyle}>
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", gap: 0,
          background: "none", border: "none", cursor: "pointer",
          padding: "6px 0", fontFamily: FONT, width: "100%",
        }}
      >
        {/* Stacked avatars */}
        <div style={{ display: "flex", flexShrink: 0 }}>
          {people.slice(0, 5).map((p, i) => (
            <div
              key={p.id}
              style={{
                marginLeft: i === 0 ? 0 : -8,
                zIndex: people.length - i,
                borderRadius: "50%",
                border: "2px solid transparent",
                lineHeight: 0,
              }}
            >
              <PhotoAvatar name={p.name} photoUrl={p.photo_url} size={28} degree={p.degree} />
            </div>
          ))}
        </div>
        <span style={{
          fontSize: 12, color: C.sub, fontWeight: 500,
          marginLeft: 10, whiteSpace: "nowrap",
        }}>
          {people.length} {people.length === 1 ? "person" : "people"} mentioned
          {selectedCount > 0 && ` · ${selectedCount} selected`}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: 4, flexShrink: 0, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded cards */}
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {showCheckboxes && selectedCount === 0 && (
            <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, padding: "0 2px 2px" }}>
              Select (up to {maxRecipients}) people to draft a message
            </div>
          )}
          {people.map(p => (
            <PersonCard
              key={p.id}
              person={p}
              showCheckbox={showCheckboxes}
              isSelected={selectedPeople?.has(p.id)}
              onToggle={onTogglePerson}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Person detail panel (bottom sheet / side drawer) ──────────────────

function ConnectionPathway({ path }) {
  if (!path || path.length < 2) return null;
  const firstName = (name) => (name || "").split(/\s+/)[0];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {path.map((node, i) => (
        <div key={node.id} style={{ display: "contents" }}>
          <div style={{ textAlign: "center" }}>
            <PhotoAvatar name={node.name} photoUrl={node.photo_url} size={28} />
            <div style={{ fontSize: 10, color: C.sub, fontFamily: FONT, marginTop: 2, maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {i === 0 ? "You" : firstName(node.name)}
            </div>
          </div>
          {i < path.length - 1 && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, margin: "0 2px" }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

function VouchStatusContent({ person }) {
  const data = person._vouchData || {};
  const myVouches = data.myVouches || {};
  const vouchTokens = data.vouchTokens || {};
  const shareToken = data.shareToken || null;
  const inviteLink = shareToken ? `${window.location.origin}/invite/${shareToken}` : null;

  // Sort functions alphabetically by practitionerLabel
  const functionSlugs = Object.keys(myVouches).sort((a, b) =>
    (myVouches[a].practitionerLabel || myVouches[a].name).localeCompare(myVouches[b].practitionerLabel || myVouches[b].name)
  );

  const [selectedSlug, setSelectedSlug] = useState(functionSlugs[0] || null);
  const [linkCopied, setLinkCopied] = useState(false);

  if (functionSlugs.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ fontSize: 14, color: C.sub, fontFamily: FONT }}>
          You haven't vouched for anyone yet.
        </div>
        <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, marginTop: 4 }}>
          Type <span style={{ fontWeight: 600, color: C.accent }}>/vouch</span> to get started.
        </div>
      </div>
    );
  }

  const currentFn = myVouches[selectedSlug] || myVouches[functionSlugs[0]];
  const vouches = currentFn?.vouches || [];
  const responded = vouches.filter(v => v.inviteStatus === "completed").length;
  const currentToken = vouchTokens[selectedSlug || functionSlugs[0]];

  return (
    <div>
      {/* Function dropdown */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={selectedSlug || ""}
          onChange={e => setSelectedSlug(e.target.value)}
          style={{
            width: "100%", padding: "8px 12px",
            fontSize: 14, fontFamily: FONT, color: C.ink,
            background: "#fff", border: `1.5px solid ${C.border}`,
            borderRadius: 8, WebkitAppearance: "none", appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2378716C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
            cursor: "pointer",
          }}
        >
          {functionSlugs.map(slug => (
            <option key={slug} value={slug}>
              {myVouches[slug].practitionerLabel || myVouches[slug].name}
            </option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, marginBottom: 14 }}>
        {responded} of {vouches.length} responded
      </div>

      {/* Vouchee list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {vouches.map(v => (
          <div
            key={v.personId}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: 8,
            }}
          >
            <PhotoAvatar name={v.name} size={28} />
            <div style={{ flex: 1, fontSize: 14, color: C.ink, fontFamily: FONT, fontWeight: 500, minWidth: 0 }}>
              {v.name}
            </div>
            <div style={{
              padding: "3px 8px", borderRadius: 6,
              fontSize: 11, fontWeight: 600, fontFamily: FONT, flexShrink: 0,
              background: v.inviteStatus === "completed" ? C.successLight : "#FFFBEB",
              color: v.inviteStatus === "completed" ? C.success : "#D97706",
            }}>
              {v.inviteStatus === "completed" ? "Responded" : "Pending"}
            </div>
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: C.border, margin: "16px 0" }} />

      {/* Edit vouches link */}
      {currentToken && (
        <a
          href={`/vouch?token=${currentToken}`}
          style={{
            display: "block", fontSize: 13, color: C.accent, fontWeight: 600,
            fontFamily: FONT, textDecoration: "none", marginBottom: 12,
          }}
        >
          Edit vouches →
        </a>
      )}

      {/* Invite link */}
      {inviteLink && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            Invite Link
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              readOnly
              value={inviteLink}
              onClick={e => e.target.select()}
              style={{
                flex: 1, padding: "7px 10px", fontSize: 12, fontFamily: FONT,
                color: C.sub, background: "#F9FAFB", border: `1px solid ${C.border}`,
                borderRadius: 6, minWidth: 0,
              }}
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(inviteLink);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
              style={{
                padding: "7px 14px", fontSize: 12, fontWeight: 600,
                fontFamily: FONT, borderRadius: 6, border: "none", cursor: "pointer",
                background: linkCopied ? C.successLight : C.accent,
                color: linkCopied ? C.success : "#fff",
                transition: "background 0.15s, color 0.15s",
                flexShrink: 0,
              }}
            >
              {linkCopied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonDetailPanel({ person, isMobile, onClose, onAsk, noDim }) {
  if (!person) return null;

  const subtitle = [person.current_title, person.current_company].filter(Boolean).join(" at ");
  const firstName = (person.name || "").split(/\s+/)[0];
  const summary = person.ai_summary || person.ai_summary_snippet || null;

  // For permission-blocked contacts
  const intermediary = (!person.can_ask && person.vouch_path?.length >= 3)
    ? person.vouch_path[person.vouch_path.length - 2]
    : null;

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const [summaryExpanded, setSummaryExpanded] = useState(false);

  // ── Note state ──────────────────────────────────────────────
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteEditing, setNoteEditing] = useState(!!person._openNoteEdit);
  const noteRef = useRef(null);

  // Fetch existing note when panel opens
  useEffect(() => {
    if (!person?.id) return;
    fetch(`/api/person/${person.id}/note`, { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        if (d) {
          setNoteText(d.note_text || "");
          setNoteSaved(d.note_text || "");
        }
      })
      .catch(() => {});
  }, [person?.id]);

  // Auto-focus textarea when opened via /note
  useEffect(() => {
    if (noteEditing && noteRef.current) {
      noteRef.current.focus();
      // Scroll note into view on mobile
      setTimeout(() => noteRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 100);
    }
  }, [noteEditing]);

  async function saveNote() {
    const trimmed = noteText.trim();
    if (trimmed === noteSaved) { setNoteEditing(false); return; }
    setNoteSaving(true);
    try {
      const res = await fetch(`/api/person/${person.id}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ note_text: trimmed }),
      });
      if (res.ok) {
        const d = await res.json();
        setNoteSaved(d.note_text || "");
        setNoteText(d.note_text || "");
      }
    } catch {}
    setNoteSaving(false);
    setNoteEditing(false);
  }

  // ── Gives state (self-gives mode) ─────────────────────────────
  const [givesSet, setGivesSet] = useState(() => new Set(person.gives || []));
  const [givesFreeText, setGivesFreeText] = useState(person.gives_free_text || "");
  const [givesSaveStatus, setGivesSaveStatus] = useState(null);

  async function autoSaveGives(overrides = {}) {
    const payload = {
      type: "preferences",
      gives: overrides.gives ? [...overrides.gives] : [...givesSet],
      gives_free_text: (overrides.freeText ?? givesFreeText).trim() || null,
    };
    setGivesSaveStatus("saving");
    try {
      const res = await fetch(`/api/person/${person.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      setGivesSaveStatus("saved");
      setTimeout(() => setGivesSaveStatus(null), 2000);
    } catch {
      setGivesSaveStatus("error");
    }
  }

  function handleToggleGive(key) {
    setGivesSet(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      autoSaveGives({ gives: next });
      return next;
    });
  }

  function handleGivesFreeTextBlur() {
    if (givesFreeText.trim() !== (person.gives_free_text || "").trim()) {
      autoSaveGives({ freeText: givesFreeText });
    }
  }

  const sectionHeader = (text) => (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.sub, fontFamily: FONT,
      textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
    }}>{text}</div>
  );

  const divider = <div style={{ height: 1, background: C.border, margin: "16px 0" }} />;

  const content = (
    <div style={{ padding: isMobile ? "16px 20px 32px" : "24px" }}>
      {/* Drag handle + close (mobile) / Close button (desktop) */}
      {isMobile ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginBottom: 16 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border }} />
          <button
            onClick={onClose}
            style={{
              position: "absolute", right: 0, top: -4,
              width: 32, height: 32, borderRadius: 8,
              border: "none", background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: "none", background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Photo + Name + Subtitle */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
        <PhotoAvatar name={person.name} photoUrl={person.photo_url} size={64} degree={person.degree} />
        <div style={{ fontSize: 18, fontWeight: 600, color: C.ink, fontFamily: FONT, marginTop: 10, textAlign: "center" }}>
          {person.name}
        </div>
        {subtitle && (
          <div style={{ fontSize: 14, color: C.sub, fontFamily: FONT, marginTop: 2, textAlign: "center" }}>
            {subtitle}
          </div>
        )}
        {person.location && (
          <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, marginTop: 2 }}>
            {person.location}
          </div>
        )}
      </div>

      {/* Self-view modes */}
      {person._isVouchStatus ? (
        <VouchStatusContent person={person} isMobile={isMobile} />
      ) : person._isSelfGives ? (
        <div>
          {sectionHeader(
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span>Your Gives</span>
              {givesSaveStatus && (
                <span style={{
                  fontSize: 11, fontWeight: 500, textTransform: "none", letterSpacing: 0,
                  color: givesSaveStatus === "saved" ? C.success : givesSaveStatus === "error" ? "#DC2626" : C.sub,
                }}>
                  {givesSaveStatus === "saving" ? "Saving..." : givesSaveStatus === "saved" ? "Saved ✓" : "Save failed"}
                </span>
              )}
            </span>
          )}
          <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, marginBottom: 14, lineHeight: 1.4 }}>
            Let people in your network know what you're open to helping with.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {GIVE_TYPES.map(g => (
              <div
                key={g.key}
                onClick={() => handleToggleGive(g.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                  background: givesSet.has(g.key) ? C.accentLight : "transparent",
                  transition: "background 0.15s",
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: givesSet.has(g.key) ? "none" : `1.5px solid ${C.border}`,
                  background: givesSet.has(g.key) ? C.accent : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 0.15s, border 0.15s",
                }}>
                  {givesSet.has(g.key) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.4 }}>
                  {g.label}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            {sectionHeader("Anything else?")}
            <textarea
              value={givesFreeText}
              onChange={e => setGivesFreeText(e.target.value)}
              onBlur={handleGivesFreeTextBlur}
              placeholder="e.g. Happy to chat about building developer tools, transitioning into product management..."
              rows={2}
              style={{
                width: "100%", padding: "8px 12px",
                fontSize: 13, fontFamily: FONT, color: C.ink,
                background: "#fff", border: `1.5px solid ${C.border}`,
                borderRadius: 8, resize: "vertical", lineHeight: 1.5,
                boxSizing: "border-box",
              }}
            />
          </div>
          {divider}
          <a
            href={`/person/${person.id}`}
            style={{
              display: "block", padding: "10px 0", textAlign: "center",
              borderRadius: 10, border: `1.5px solid ${C.border}`,
              fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT,
              textDecoration: "none",
            }}
          >
            View Your Full Profile
          </a>
        </div>
      ) : (
      <>
      {/* AI summary (clamped with expand) */}
      {summary && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 14, lineHeight: 1.6, color: C.ink, fontFamily: FONT,
            ...(!summaryExpanded ? {
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
            } : {}),
          }}>
            {summary}
          </div>
          {summary.length > 180 && (
            <button
              onClick={() => setSummaryExpanded(prev => !prev)}
              style={{
                background: "none", border: "none", padding: 0, marginTop: 4,
                fontSize: 12, color: C.accent, fontWeight: 600, fontFamily: FONT,
                cursor: "pointer",
              }}
            >
              {summaryExpanded ? "Show less" : "More"}
            </button>
          )}
        </div>
      )}

      {divider}

      {/* HOW YOU'RE CONNECTED */}
      {person.vouch_path && person.vouch_path.length >= 2 && (
        <div style={{ marginBottom: 16 }}>
          {sectionHeader("How You're Connected")}
          <ConnectionPathway path={person.vouch_path} />
        </div>
      )}

      {/* SHARED HISTORY */}
      {person.user_overlap?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {sectionHeader("Career Overlap")}
          {person.user_overlap.map((o, i) => {
            const fmtDate = (d) => {
              if (!d) return "?";
              const dt = new Date(d);
              return dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
            };
            return (
              <div key={i} style={{ fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.5, marginBottom: i < person.user_overlap.length - 1 ? 8 : 0 }}>
                <span style={{ marginRight: 4 }}>⚡</span>
                <strong>{o.organization}</strong> · {fmtDate(o.overlap_start)} – {fmtDate(o.overlap_end)}
              </div>
            );
          })}
        </div>
      )}

      {/* TRUST IN YOUR NETWORK */}
      {person.recommendation_count > 0 && (
        <div style={{ marginBottom: 16 }}>
          {sectionHeader("Trust in Your Network")}
          <div style={{ fontSize: 13, color: C.ink, fontFamily: FONT }}>
            <span style={{ marginRight: 4 }}>⭐</span>
            Vouched for by {person.recommendation_count} {Number(person.recommendation_count) === 1 ? "person" : "people"} in your network
          </div>
        </div>
      )}

      {/* WAYS THEY CAN HELP */}
      {(person.gives?.length > 0 || person.gives_free_text) && (
        <div style={{ marginBottom: 16 }}>
          {sectionHeader(`Ways ${firstName} Can Help`)}
          {person.gives?.length > 0 && (
            <div style={{ marginBottom: person.gives_free_text ? 8 : 0 }}>
              {person.gives.map((g, i) => (
                <div key={i} style={{
                  fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.5,
                  paddingLeft: 10, position: "relative",
                }}>
                  <span style={{ position: "absolute", left: 0, color: C.sub }}>·</span>
                  {g}
                </div>
              ))}
            </div>
          )}
          {person.gives_free_text && (
            <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, lineHeight: 1.4, fontStyle: "italic" }}>
              "{person.gives_free_text}"
            </div>
          )}
        </div>
      )}

      {/* YOUR NOTES */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: C.sub, fontFamily: FONT,
          textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>Your Notes <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(private)</span></span>
          {!noteEditing && noteSaved && (
            <button
              onClick={() => setNoteEditing(true)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, color: C.accent, fontWeight: 600, padding: 0,
                fontFamily: FONT, textTransform: "none", letterSpacing: 0,
              }}
            >
              Edit
            </button>
          )}
        </div>
        {noteEditing ? (
          <div>
            <textarea
              ref={noteRef}
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder={`Add a private note about ${firstName}...`}
              rows={3}
              style={{
                width: "100%", padding: "8px 12px",
                fontSize: 16, fontFamily: FONT, color: C.ink,
                background: "#fff", border: `1.5px solid ${C.accent}`,
                borderRadius: 8, resize: "vertical", lineHeight: 1.4,
                boxSizing: "border-box", outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setNoteText(noteSaved); setNoteEditing(false); }}
                style={{
                  padding: "5px 12px", fontSize: 12, fontWeight: 600,
                  background: "none", border: `1px solid ${C.border}`,
                  borderRadius: 6, cursor: "pointer", color: C.sub, fontFamily: FONT,
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveNote}
                disabled={noteSaving}
                style={{
                  padding: "5px 12px", fontSize: 12, fontWeight: 600,
                  background: C.accent, border: "none",
                  borderRadius: 6, cursor: "pointer", color: "#fff", fontFamily: FONT,
                  opacity: noteSaving ? 0.6 : 1,
                }}
              >
                {noteSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : noteSaved ? (
          <div
            onClick={() => setNoteEditing(true)}
            style={{
              fontSize: 13, color: C.ink, fontFamily: FONT, lineHeight: 1.6,
              whiteSpace: "pre-wrap", cursor: "pointer",
            }}
          >
            {noteSaved}
          </div>
        ) : (
          <button
            onClick={() => setNoteEditing(true)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 13, color: C.sub, fontFamily: FONT, padding: 0,
              width: "100%", textAlign: "left",
            }}
          >
            <span style={{
              display: "block", padding: "8px 12px", borderRadius: 8,
              border: `1px dashed ${C.border}`,
            }}>
              + Add a private note about {firstName}
            </span>
          </button>
        )}
      </div>

      {divider}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        <a
          href={`/person/${person.id}`}
          style={{
            flex: 1, padding: "10px 0", textAlign: "center",
            borderRadius: 10, border: `1.5px solid ${C.border}`,
            fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT,
            textDecoration: "none", display: "block",
          }}
        >
          View Full Profile
        </a>
        {person.can_ask === true ? (
          <button
            onClick={() => onAsk?.(person)}
            style={{
              flex: 1, padding: "10px 0",
              borderRadius: 10, border: "none",
              background: C.accent, color: "#fff",
              fontSize: 14, fontWeight: 600, fontFamily: FONT,
              cursor: "pointer",
            }}
          >
            Ask {firstName} →
          </button>
        ) : intermediary ? (
          <button
            onClick={() => onAsk?.(intermediary, person)}
            style={{
              flex: 1, padding: "10px 0",
              borderRadius: 10, border: "none",
              background: C.accent, color: "#fff",
              fontSize: 14, fontWeight: 600, fontFamily: FONT,
              cursor: "pointer",
            }}
          >
            Ask via {intermediary.name.split(" ")[0]} →
          </button>
        ) : null}
      </div>
      </>)}
    </div>
  );

  // Mobile: bottom sheet
  if (isMobile) {
    return (
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 250,
          background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "flex-end",
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: "100%", maxHeight: "85vh",
            background: "#fff", borderRadius: "16px 16px 0 0",
            overflow: "auto", WebkitOverflowScrolling: "touch",
            animation: "slideUp 0.25s ease-out",
          }}
        >
          <div key={person.id} style={{ animation: "panelContentFade 0.6s ease-in-out" }}>
            {content}
          </div>
        </div>
      </div>
    );
  }

  // Desktop: side drawer
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: noDim ? "transparent" : "rgba(0,0,0,0.2)",
        display: "flex", justifyContent: "flex-end",
        pointerEvents: noDim ? "none" : "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 380, height: "100%",
          background: "#fff", borderLeft: `1px solid ${C.border}`,
          overflow: "auto", WebkitOverflowScrolling: "touch",
          animation: "slideInRight 0.2s ease-out",
          pointerEvents: "auto",
        }}
      >
        <div key={person.id} style={{ animation: "panelContentFade 0.6s ease-in-out" }}>
          {content}
        </div>
      </div>
    </div>
  );
}

// ── Network Bin dropdown ───────────────────────────────────────────────

const DEGREE_DOTS = { 1: "#6D5BD0", 2: "#16A34A", 3: "#7C3AED" };

function NetworkBin({ isMobile, people, onClose, onSelectPerson, onVouch }) {
  // Sort: people with photos first, then by name
  const sorted = useMemo(() => {
    return [...people].sort((a, b) => {
      const aPhoto = a.photo_url ? 0 : 1;
      const bPhoto = b.photo_url ? 0 : 1;
      return aPhoto - bPhoto || (a.name || "").localeCompare(b.name || "");
    });
  }, [people]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  if (people.length === 0) return null;

  const content = (
    <div style={{ padding: "16px 20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: C.ink, fontFamily: FONT }}>Your Network</span>
          {onVouch && (
            <button
              onClick={onVouch}
              title="Vouch for someone"
              style={{
                background: "none", border: `1.5px solid ${C.border}`, borderRadius: "50%",
                width: 26, height: 26, cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: C.accent, fontSize: 16, fontWeight: 600, lineHeight: 1,
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = C.accentLight; e.currentTarget.style.borderColor = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = C.border; }}
            >+</button>
          )}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, fontSize: 18, color: C.sub }}>✕</button>
      </div>
      {/* People rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sorted.map(p => {
          const subtitle = [p.current_title, p.current_company].filter(Boolean).join(" at ");
          return (
            <button
              key={p.id}
              onClick={() => onSelectPerson(p)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 4px",
                background: "none", border: "none", cursor: "pointer", textAlign: "left",
                borderRadius: 8, transition: "background 0.15s", width: "100%",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = C.accentLight; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <PhotoAvatar name={p.name} photoUrl={p.photo_url} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontFamily: FONT, color: C.ink }}>{p.name}</div>
                {subtitle && (
                  <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {subtitle}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
        <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxHeight: "85vh", background: "#fff", borderRadius: "16px 16px 0 0", overflow: "auto", WebkitOverflowScrolling: "touch", animation: "slideUp 0.25s ease-out" }}>
          {content}
        </div>
      </div>
    );
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.2)", display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 340, height: "100%", background: "#fff", borderLeft: `1px solid ${C.border}`, overflow: "auto", WebkitOverflowScrolling: "touch", animation: "slideInRight 0.2s ease-out" }}>
        {content}
      </div>
    </div>
  );
}

// ── Notifications / messages panel ─────────────────────────────────────

function NotificationsPanel({ isMobile, onClose, userId }) {
  const [askConvos, setAskConvos] = useState([]);
  const [groupThreads, setGroupThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/person/${userId}`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch("/api/my-threads", { credentials: "include" }).then(r => r.ok ? r.json() : null),
    ]).then(([personData, threadsData]) => {
      setAskConvos(personData?.my_conversations || []);
      setGroupThreads(threadsData?.threads || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  function timeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  }

  const content = (
    <div style={{ padding: "16px 20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: C.ink, fontFamily: FONT }}>Messages</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, fontSize: 18, color: C.sub }}>✕</button>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 48, borderRadius: 10, background: `linear-gradient(90deg, #E7E5E0 25%, #D6D3CE 50%, #E7E5E0 75%)`, backgroundSize: "200% 100%", animation: `shimmer 1.2s ${i * 0.15}s infinite` }} />
          ))}
          <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
        </div>
      ) : (
        <>
          {/* Asks section */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub, marginBottom: 10, fontFamily: FONT }}>
              Asks{askConvos.length > 0 && ` (${askConvos.length})`}
            </div>
            {askConvos.length === 0 ? (
              <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>No conversations yet</div>
            ) : askConvos.map((c, i) => (
              <a
                key={i}
                href={`/thread/${c.access_token}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                  borderBottom: i < askConvos.length - 1 ? `1px solid ${C.border}` : "none",
                  textDecoration: "none", color: C.ink,
                }}
              >
                {c.has_new && <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />}
                <PhotoAvatar name={c.other_name} photoUrl={c.other_photo} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: c.has_new ? 700 : 600, fontFamily: FONT, color: C.ink }}>{c.other_name}</div>
                  {c.last_message_body && (
                    <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.last_message_body}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: C.sub, fontFamily: FONT, flexShrink: 0 }}>{timeAgo(c.last_message_at)}</span>
              </a>
            ))}
          </div>

          {/* Group Threads section */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: C.sub, marginBottom: 10, fontFamily: FONT }}>
              Group Threads{groupThreads.length > 0 && ` (${groupThreads.length})`}
            </div>
            {groupThreads.length === 0 ? (
              <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>No group threads yet</div>
            ) : groupThreads.map((t, i) => (
              <a
                key={i}
                href={`/thread/${t.access_token}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                  borderBottom: i < groupThreads.length - 1 ? `1px solid ${C.border}` : "none",
                  textDecoration: "none", color: C.ink,
                }}
              >
                {t.has_new && <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />}
                <div style={{
                  width: 32, height: 32, borderRadius: 8, background: "#EEF2FF",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: t.has_new ? 700 : 600, fontFamily: FONT, color: C.ink }}>{t.topic || "Group Thread"}</div>
                  {t.last_message_preview && (
                    <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.last_message_author}: {t.last_message_preview}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: C.sub, fontFamily: FONT, flexShrink: 0 }}>{timeAgo(t.last_message_at)}</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
        <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxHeight: "85vh", background: "#fff", borderRadius: "16px 16px 0 0", overflow: "auto", WebkitOverflowScrolling: "touch", animation: "slideUp 0.25s ease-out" }}>
          {content}
        </div>
      </div>
    );
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.2)", display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 360, height: "100%", background: "#fff", borderLeft: `1px solid ${C.border}`, overflow: "auto", WebkitOverflowScrolling: "touch", animation: "slideInRight 0.2s ease-out" }}>
        {content}
      </div>
    </div>
  );
}

// ── Login prompt ───────────────────────────────────────────────────────

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
        Access Network Brain
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
          onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 0 0 3px rgba(109,91,208,0.12)"; }}
          onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; }}
        />
        <button
          type="submit"
          disabled={!identifier.trim() || sending}
          style={{
            padding: "12px 20px",
            background: identifier.trim() && !sending ? C.accent : "#D4CAFE",
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
        <div style={{ marginTop: 10, fontSize: 13, color: "#DC2626", fontFamily: FONT }}>{error}</div>
      )}
    </div>
  );
}

// ── Responsive hook ──────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// ── Main page ──────────────────────────────────────────────────────────

export default function NetworkBrainPage() {
  const [authState, setAuthState] = useState("checking");
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem("brain_messages");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  }); // [{ role: 'user'|'brain', text, people? }]
  const hadSavedMessages = useRef(messages.length > 0); // track if sessionStorage had messages on mount
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activePerson, setActivePerson] = useState(null); // person object for detail panel
  const bottomRef = useRef(null);
  const lastBrainRef = useRef(null);
  const inputRef = useRef(null);
  const isNearBottomRef = useRef(true); // Track if user is scrolled near bottom (for auto-scroll during streaming)

  // Persist messages to sessionStorage (exclude welcome messages)
  useEffect(() => {
    try {
      const toSave = messages.filter(m => !m.isWelcome);
      sessionStorage.setItem("brain_messages", JSON.stringify(toSave));
    } catch {}
  }, [messages]);

  // Reset textarea height when input is cleared
  useEffect(() => {
    if (!input && inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = "48px";
    }
  }, [input]);

  // Track whether user is scrolled near the bottom (for auto-scroll during streaming)
  useEffect(() => {
    const handleScroll = () => {
      const scrollBottom = window.innerHeight + window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      isNearBottomRef.current = docHeight - scrollBottom < 150;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Quick Ask state
  const [askMode, setAskMode] = useState(null); // msg index of brain response in ask mode
  const [selectedPeople, setSelectedPeople] = useState(new Set());
  const [recipientContext, setRecipientContext] = useState({}); // { personId: { knows_them: bool, relationship: string } }
  const [showContextStep, setShowContextStep] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [askId, setAskId] = useState(null);
  const [draftingLoading, setDraftingLoading] = useState(false);
  const [askError, setAskError] = useState(null);
  const [maxRecipients, setMaxRecipients] = useState(3);

  const isMobile = useIsMobile();

  // Group Thread state
  const [threadMode, setThreadMode] = useState(false);
  const [threadTopic, setThreadTopic] = useState("");
  const [threadDraft, setThreadDraft] = useState(null); // { thread_id, creator_token, topic, draft_body, participants }
  const [threadDraftLoading, setThreadDraftLoading] = useState(false);
  const [starterQuestions, setStarterQuestions] = useState([]);

  // Header / notification state
  const [notifCounts, setNotifCounts] = useState({ unread_asks: 0, unread_groups: 0, total: 0 });
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);

  // Network Bin state
  const [networkBinOpen, setNetworkBinOpen] = useState(false);
  const [networkPeople, setNetworkPeople] = useState([]);

  // Header avatars: only people with real photos, sorted by name
  const headerAvatars = useMemo(() => {
    return networkPeople
      .filter(p => p.photo_url && !isPlaceholderPhoto(p.photo_url))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [networkPeople]);

  // Sequenced welcome state
  const [welcomeRevealing, setWelcomeRevealing] = useState(false);
  const [slashHighlighted, setSlashHighlighted] = useState(false);
  const revealTimersRef = useRef([]);

  // Slash command state
  const [slashMode, setSlashMode] = useState(null); // 'ask' | 'group' | null
  const [slashQuery, setSlashQuery] = useState("");
  const [slashResults, setSlashResults] = useState([]);
  const [slashGuideOpen, setSlashGuideOpen] = useState(false);
  const [slashSelectedPeople, setSlashSelectedPeople] = useState([]); // for /group
  const [slashSearchLoading, setSlashSearchLoading] = useState(false);
  const slashDebounceRef = useRef(null);
  const [vouchFunctions, setVouchFunctions] = useState([]); // for /vouch
  const [vouchedSlugs, setVouchedSlugs] = useState(new Set());
  const [vouchLoading, setVouchLoading] = useState(false);

  // Bio interview state
  const [bioMode, setBioMode] = useState(false);
  const [bioMessages, setBioMessages] = useState([]); // [{ role: 'user'|'bio', text, vouchSuggestion? }]
  const [bioLoading, setBioLoading] = useState(false);
  const [bioStatus, setBioStatus] = useState("none"); // none | active | paused | completed

  // Scroll to bottom when bio messages change or bio mode is entered
  useEffect(() => {
    if (bioMode && bioMessages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [bioMode, bioMessages]);

  // Fetch job functions when /vouch is activated
  useEffect(() => {
    if (slashMode !== "vouch") return;
    let cancelled = false;
    (async () => {
      try {
        const [fnRes, myRes] = await Promise.all([
          fetch("/api/job-functions", { credentials: "include" }),
          fetch("/api/my-vouch-functions", { credentials: "include" }),
        ]);
        if (cancelled) return;
        const fnData = await fnRes.json();
        const myData = myRes.ok ? await myRes.json() : { vouchedFunctions: [] };
        setVouchFunctions(fnData.jobFunctions || []);
        setVouchedSlugs(new Set(myData.vouchedFunctions || []));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [slashMode]);

  // Rotating placeholder prompts
  const PLACEHOLDER_PROMPTS = [
    "What's on your mind?",
    "I'm navigating a tough decision...",
    "Who do I know at...",
    "Show me my engineering network",
    "I need help with...",
  ];
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    if (hasInteracted || messages.length > 0) return;
    const timer = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % PLACEHOLDER_PROMPTS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [hasInteracted, messages.length]);

  // People from the most recent brain response (for recently mentioned)
  const latestBrainMsg = [...messages].reverse().find(m => m.role === "brain" && m.people?.length > 0);
  const latestBrainMsgIndex = latestBrainMsg ? messages.indexOf(latestBrainMsg) : -1;

  // Debug mode (show version toggle) via ?debug=1
  const showDebug = new URLSearchParams(window.location.search).has("debug");

  // Auth flow on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("token");

    if (loginToken) {
      fetch(`/api/auth/validate?token=${loginToken}`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (data.user) {
            setUser({ ...data.user, inviterName: data.inviterName || null });
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
          setUser({ ...data.user, inviterName: data.inviterName || null });
          setAuthState("authenticated");
          if (data.user?.id) identify(data.user.id, { name: data.user.name });
          capture("network_brain_viewed");
        })
        .catch(() => setAuthState("unauthenticated"));
    }
  }, []);

  // Fetch brain starter questions
  useEffect(() => {
    fetch("/api/brain-starters")
      .then(res => res.ok ? res.json() : { starters: [] })
      .then(data => setStarterQuestions(data.starters || []))
      .catch(() => {});
  }, []);

  // Fetch notification counts + network people for header
  useEffect(() => {
    if (authState !== "authenticated") return;
    fetch("/api/notifications", { credentials: "include" })
      .then(res => res.ok ? res.json() : { total: 0 })
      .then(data => setNotifCounts(data))
      .catch(() => {});
    fetch("/api/my-network", { credentials: "include" })
      .then(res => res.ok ? res.json() : { people: [] })
      .then(data => setNetworkPeople(data.people || []))
      .catch(() => {});
  }, [authState]);

  // Cleanup reveal timers on unmount
  useEffect(() => {
    return () => revealTimersRef.current.forEach(id => clearTimeout(id));
  }, []);

  // Welcome message — context-aware greeting on fresh page load
  const welcomeInsertedRef = useRef(false);
  useEffect(() => {
    if (authState !== "authenticated" || !user || welcomeInsertedRef.current) return;
    if (messages.length > 0) return; // already have conversation history
    // Don't show welcome if navigated with ?q= (question will auto-submit)
    const params = new URLSearchParams(window.location.search);
    if (params.get("q")?.trim()) return;
    welcomeInsertedRef.current = true;

    const name = user.name?.split(" ")[0] || "there";

    if (!user.has_vouched && !user.welcome_seen) {
      // Scenario A: first visit, no vouch — full sequenced welcome tour
      (async () => {
        try {
          // Show shimmer while waiting for Claude
          setMessages([{
            role: "brain", text: "", people: [], streaming: true, isWelcome: true,
          }]);
          setLoading(false);

          const res = await fetch("/api/network-brain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ question: "[welcome]", version: 2, history: [] }),
          });

          if (!res.ok) throw new Error("Welcome fetch failed");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = "";
          let fullText = "";
          let handledSequence = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const chunks = sseBuffer.split("\n\n");
            sseBuffer = chunks.pop();

            for (const chunk of chunks) {
              if (!chunk.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(chunk.slice(6));

                if (event.type === "welcome_intro") {
                  // ── Immediate: show hardcoded intro + populate bin ──
                  handledSequence = true;
                  const allPeople = event.all_people || [];
                  if (allPeople.length > 0) setNetworkPeople(allPeople);

                  setWelcomeRevealing(true);
                  const msg = event.message;
                  setMessages([{ role: "brain", text: msg.text, people: [], isWelcome: true }]);

                  // After a 5s beat, open the network bin (desktop only — blocks screen on mobile)
                  if (!isMobile) {
                    const binTimer = setTimeout(() => setNetworkBinOpen(true), 5000);
                    revealTimersRef.current.push(binTimer);
                  }

                } else if (event.type === "welcome_followup") {
                  // ── Reveal Claude-generated messages with delays ──
                  const followupMessages = event.messages || [];
                  // Per-message delays: gap BEFORE each followup message appears
                  // idx 0 (inviter): 3s after intro
                  // idx 1 (shared history): 8s shorter gap since inviter msg is short
                  // idx 2 (interesting unknown): 12s normal
                  // idx 3 (slash commands): 12s normal
                  // idx 4 (CTA): 12s normal
                  const MESSAGE_GAPS = [3000, 8000, 12000, 12000, 12000];
                  const ACTION_BEAT = 3000; // ms after message appears before panel action

                  // Build cumulative timestamps
                  const timestamps = [];
                  let cumulative = 0;
                  for (let i = 0; i < followupMessages.length; i++) {
                    cumulative += MESSAGE_GAPS[i] || 12000;
                    timestamps.push(cumulative);
                  }

                  followupMessages.forEach((msg, idx) => {
                    const timerId = setTimeout(() => {
                      const linkedText = linkifyNamesAsTokens(msg.text, msg.people || []);
                      setMessages(prev => [
                        ...prev.filter(m => m.isWelcome && m.text),
                        { role: "brain", text: linkedText, people: msg.people || [], isWelcome: true },
                      ]);

                      // Scroll new message into view
                      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

                      // After a beat, do the sequenced panel action
                      // idx 0: inviter msg → close bin
                      // idx 1: shared history → open preview card
                      // idx 2: interesting unknown → update preview card
                      // idx 3: slash commands → close preview + highlight slash row
                      // idx 4: CTA → clear highlight
                      const actionTimer = setTimeout(() => {
                        if (idx === 0 && !isMobile) {
                          setNetworkBinOpen(false);
                        } else if ((idx === 1 || idx === 2) && msg.highlight_person && !isMobile) {
                          fetchFullPerson(msg.highlight_person.id, msg.highlight_person).then(p => setActivePerson(p));
                        } else if (idx === 3) {
                          setActivePerson(null);
                          setSlashHighlighted(true);
                          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
                        } else if (idx === 4) {
                          setSlashHighlighted(false);
                        }
                      }, ACTION_BEAT);
                      revealTimersRef.current.push(actionTimer);

                      // Last message: done revealing
                      if (idx === followupMessages.length - 1) {
                        setWelcomeRevealing(false);
                      }
                    }, timestamps[idx]);

                    revealTimersRef.current.push(timerId);
                  });

                } else if (event.type === "token") {
                  // Fallback: old streaming format
                  fullText += event.text;
                  setMessages([{ role: "brain", text: fullText, people: [], streaming: true, isWelcome: true }]);

                } else if (event.type === "done" && !handledSequence) {
                  // Fallback: single message done event
                  const finalText = linkifyNamesAsTokens(fullText || event.answer || "", event.people || []);
                  setMessages([{
                    role: "brain", text: finalText, people: event.people || [],
                    streaming: false, isWelcome: true,
                  }]);
                  if (!isMobile && event.people?.length > 0) {
                    setTimeout(() => setActivePerson(event.people[0]), 600);
                  }
                }
              } catch {}
            }
          }
        } catch {
          // Fallback to static welcome if Brain call fails
          setMessages([{
            role: "brain", isWelcome: true,
            text: `Hey ${name}, welcome! I'm your network Brain — a thinking partner who knows your professional world. What are you working on these days?`,
          }]);
        }
      })();
    } else if (!user.has_vouched && user.welcome_seen) {
      // Scenario B: returning, no vouch — same welcome as C (normal Brain handles vouch nudge)
      (async () => {
        try {
          const [notifRes, feedRes] = await Promise.all([
            fetch("/api/notifications", { credentials: "include" }).then(r => r.ok ? r.json() : { total: 0 }),
            fetch("/api/feed", { credentials: "include" }).then(r => r.ok ? r.json() : { items: [] }),
          ]);

          const feedItems = feedRes.items || [];
          const hasNotifs = notifRes.total > 0;
          const hasActivity = feedItems.length > 0;

          let msg = `Hey ${name}, welcome back.`;

          if (hasActivity || hasNotifs) {
            const bits = [];
            if (hasActivity) {
              const item = feedItems[0];
              if (item.type === "vouch") bits.push(`${item.subject.name} picked up a new vouch`);
              else if (item.type === "thread") bits.push(`there's new activity in "${item.topic}"`);
              else if (item.type === "ask") bits.push(`${item.actor.name} sent you an Ask`);
            }
            if (hasNotifs) {
              const n = notifRes.total;
              bits.push(`you have ${n} unread message${n > 1 ? "s" : ""} waiting`);
            }
            if (bits.length > 0) msg += ` Your network's been active — ${bits.join(", and ")}.`;
          }

          msg += " What can I help with today?";
          setMessages([{ role: "brain", isWelcome: true, text: msg }]);
        } catch {
          setMessages([{ role: "brain", isWelcome: true, text: `Hey ${name}, welcome back. What can I help with today?` }]);
        }
      })();
    } else {
      // Scenario C: Returner with vouches — conversational welcome with woven-in activity
      (async () => {
        try {
          const [notifRes, feedRes] = await Promise.all([
            fetch("/api/notifications", { credentials: "include" }).then(r => r.ok ? r.json() : { total: 0 }),
            fetch("/api/feed", { credentials: "include" }).then(r => r.ok ? r.json() : { items: [] }),
          ]);

          const feedItems = feedRes.items || [];
          const hasNotifs = notifRes.total > 0;
          const hasActivity = feedItems.length > 0;

          // Build one flowing sentence with activity woven in
          let msg = `Hey ${name}, welcome back.`;

          if (hasActivity || hasNotifs) {
            // Gather color phrases
            const bits = [];

            // Feed activity — pick the most interesting item
            if (hasActivity) {
              const item = feedItems[0];
              if (item.type === "vouch") {
                bits.push(`${item.subject.name} picked up a new vouch`);
              } else if (item.type === "thread") {
                bits.push(`there's new activity in "${item.topic}"`);
              } else if (item.type === "ask") {
                bits.push(`${item.actor.name} sent you an Ask`);
              }
            }

            // Unread messages
            if (hasNotifs) {
              const n = notifRes.total;
              bits.push(`you have ${n} unread message${n > 1 ? "s" : ""} waiting`);
            }

            if (bits.length > 0) {
              msg += ` Your network's been active — ${bits.join(", and ")}.`;
            }
          }

          msg += " What can I help with today?";

          setMessages([{ role: "brain", isWelcome: true, text: msg }]);
        } catch {
          setMessages([{ role: "brain", isWelcome: true, text: `Hey ${name}, welcome back. What can I help with today?` }]);
        }
      })();
    }
  }, [authState]);

  // Auto-submit question from ?q= parameter (e.g. from homepage brain prompt)
  const autoAskedRef = useRef(false);
  useEffect(() => {
    if (authState !== "authenticated" || autoAskedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q?.trim()) {
      autoAskedRef.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      askQuestion(q.trim());
    }
  }, [authState]);

  // Scroll behavior: when loading starts, scroll to loading indicator;
  // when response arrives, scroll to top of latest brain response (offset for fixed header);
  // during streaming, auto-scroll to keep up if user is near the bottom
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (loading) {
      // Scrolls down to show the thinking indicator
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (prevLoadingRef.current && lastBrainRef.current) {
      // Just finished loading — scroll to the latest response with header offset
      const el = lastBrainRef.current;
      const y = el.getBoundingClientRect().top + window.scrollY - 96; // 80px header + 16px breathing room
      window.scrollTo({ top: y, behavior: "smooth" });
    } else {
      // During streaming: auto-scroll if user hasn't scrolled away
      const lastMsg = messages[messages.length - 1];
      if ((lastMsg?.streaming || lastMsg?.narrationStreaming) && isNearBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
    prevLoadingRef.current = loading;
  }, [messages, loading]);

  // ── Mobile keyboard handler: detect focus to reduce padding + scroll ──
  const [mobileKeyboardOpen, setMobileKeyboardOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) return;

    function handleFocusIn(e) {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") {
        setMobileKeyboardOpen(true);
        // Scroll content into view after keyboard animation
        setTimeout(() => {
          // Few messages? Keep first one visible. Many? Show the latest.
          const msgCount = (messages?.length || 0) + (bioMessages?.length || 0);
          if (msgCount <= 2) {
            window.scrollTo({ top: 0, behavior: "smooth" });
          } else {
            const target = lastBrainRef.current || bottomRef.current;
            target?.scrollIntoView({ behavior: "smooth", block: "end" });
          }
        }, 300);
      }
    }

    function handleFocusOut(e) {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") {
        // Delay to avoid flicker when tapping from one input to another
        setTimeout(() => {
          if (!document.activeElement || (document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT")) {
            setMobileKeyboardOpen(false);
          }
        }, 100);
      }
    }

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, [isMobile]);

  async function askQuestion(question) {
    if (!question.trim() || loading) return;

    // Reset Quick Ask if active
    if (askMode !== null) handleCancelAskMode();

    const q = question.trim();
    setInput("");
    setError(null);
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setLoading(true);

    capture("network_brain_question", { question_length: q.length });

    try {
      const res = await fetch("/api/network-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question: q,
          version: 2,
          history: messages
            .filter(m => m.role === "user" || m.role === "brain")
            .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Something went wrong");
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // ── Streaming narrative response ──
        // Add placeholder brain message that we'll update incrementally
        setMessages(prev => [...prev, {
          role: "brain",
          text: "",
          people: [],
          version: 2,
          response_type: "narrative",
          streaming: true,
        }]);
        setLoading(false); // Hide "thinking" — tokens are flowing

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const chunks = sseBuffer.split("\n\n");
          sseBuffer = chunks.pop(); // Keep incomplete chunk

          for (const chunk of chunks) {
            if (!chunk.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(chunk.slice(6));
              if (event.type === "token") {
                fullText += event.text;
                const streamText = fullText; // Capture for closure
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.streaming) {
                    updated[updated.length - 1] = { ...last, text: streamText };
                  }
                  return updated;
                });
              } else if (event.type === "done") {
                // Final event with people and metadata
                const finalText = linkifyNamesAsTokens(fullText, event.people);
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.streaming) {
                    updated[updated.length - 1] = {
                      ...last,
                      text: finalText,
                      people: event.people || [],
                      response_type: event.response_type || "narrative",
                      streaming: false,
                    };
                  }
                  return updated;
                });
                if (event.max_recipients) setMaxRecipients(event.max_recipients);
                capture("network_brain_answer", {
                  answer_length: fullText.length,
                  people_count: (event.people || []).length,
                  version: 2,
                });
              } else if (event.type === "error") {
                throw new Error(event.message || "Something went wrong");
              }
            } catch (parseErr) {
              if (parseErr.message && parseErr.message !== "Unexpected end of JSON input") throw parseErr;
            }
          }
        }
      } else {
        // ── JSON response (browse, name shortcut, or fallback) ──
        const data = await res.json();
        if (data.max_recipients) setMaxRecipients(data.max_recipients);
        const answerText = data.answer || "I couldn't generate a response. Try rephrasing your question.";
        setMessages(prev => [...prev, {
          role: "brain",
          text: linkifyNamesAsTokens(answerText, data.people),
          people: data.people || [],
          version: data.version || 2,
          response_type: data.response_type || "narrative",
        }]);

        capture("network_brain_answer", {
          answer_length: (data.answer || "").length,
          people_count: (data.people || []).length,
          version: data.version || 2,
        });
      }
    } catch (err) {
      setError(err.message);
      // If we were streaming, update the last message to show error
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.streaming) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            text: last.text || "Sorry, something went wrong. Please try again.",
            streaming: false,
            people: [],
          };
          return updated;
        }
        return [...prev, {
          role: "brain",
          text: "Sorry, something went wrong. Please try again.",
          people: [],
        }];
      });
    } finally {
      setLoading(false);
      // Refocus input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    // If in bio mode, route to bio handler
    if (bioMode) {
      handleBioSubmit(input);
      setInput("");
      return;
    }
    // If in /group mode with 2+ selected people, trigger group thread flow
    if (slashMode === "group" && slashSelectedPeople.length >= 2) {
      triggerGroupThreadForPeople(slashSelectedPeople);
      return;
    }
    // If in /compare mode with exactly 2 selected people, trigger compare
    if (slashMode === "compare" && slashSelectedPeople.length === 2) {
      handleCompare(slashSelectedPeople);
      return;
    }
    // If in slash mode but no action, clear and submit normally
    if (slashMode) {
      setSlashMode(null);
      setSlashQuery("");
      setSlashResults([]);
      setSlashSelectedPeople([]);
      return;
    }
    askQuestion(input);
  }

  // ── Slash command handlers ───────────────────────────────────────────
  function handleInputChange(val) {
    setInput(val);

    // Detect /ask and /group commands
    const askMatch = val.match(/^\/ask\s*(.*)/i);
    const groupMatch = val.match(/^\/group\s*(.*)/i);

    if (askMatch) {
      setSlashMode("ask");
      const q = askMatch[1].trim();
      setSlashQuery(q);
      fetchSlashResults(q);
    } else if (groupMatch) {
      setSlashMode("group");
      const q = groupMatch[1].trim();
      setSlashQuery(q);
      fetchSlashResults(q);
    } else if (val.match(/^\/note\s*(.*)/i)) {
      const noteMatch = val.match(/^\/note\s*(.*)/i);
      setSlashMode("note");
      const q = noteMatch[1].trim();
      setSlashQuery(q);
      fetchSlashResults(q);
    } else if (/^\/give\b/i.test(val)) {
      handleOpenGives();
      return;
    } else if (/^\/status\b/i.test(val)) {
      handleOpenStatus();
      return;
    } else if (val.match(/^\/compare\s*(.*)/i)) {
      const compareMatch = val.match(/^\/compare\s*(.*)/i);
      setSlashMode("compare");
      const q = compareMatch[1].trim();
      setSlashQuery(q);
      fetchSlashResults(q);
    } else if (/^\/bio\b/i.test(val)) {
      handleStartBio();
      return;
    } else if (/^\/vouch\b/i.test(val)) {
      setSlashMode("vouch");
      setSlashQuery("");
      setSlashResults([]);
    } else if (slashMode) {
      // No longer a slash command — clear
      setSlashMode(null);
      setSlashQuery("");
      setSlashResults([]);
      setSlashSelectedPeople([]);
    }
  }

  function fetchSlashResults(q) {
    if (slashDebounceRef.current) clearTimeout(slashDebounceRef.current);
    if (!q) {
      // Show recently mentioned people when no query
      setSlashResults(latestBrainMsg?.people?.slice(0, 6) || []);
      setSlashSearchLoading(false);
      return;
    }
    setSlashSearchLoading(true);
    slashDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/network-search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setSlashResults(data.results || []);
        }
      } catch {}
      setSlashSearchLoading(false);
    }, 200);
  }

  function handleSlashSelect(person) {
    if (slashMode === "ask") {
      triggerQuickAskForPerson(person);
    } else if (slashMode === "group") {
      setSlashSelectedPeople(prev => {
        const exists = prev.find(p => p.id === person.id);
        if (exists) return prev.filter(p => p.id !== person.id);
        return [...prev, person];
      });
      // Clear the query portion but keep /group prefix
      setInput("/group ");
      setSlashQuery("");
      fetchSlashResults("");
    } else if (slashMode === "compare") {
      setSlashSelectedPeople(prev => {
        const exists = prev.find(p => p.id === person.id);
        if (exists) return prev.filter(p => p.id !== person.id);
        if (prev.length >= 2) return prev; // Cap at 2
        return [...prev, person];
      });
      setInput("/compare ");
      setSlashQuery("");
      fetchSlashResults("");
    } else if (slashMode === "note") {
      setSlashMode(null);
      setSlashQuery("");
      setSlashResults([]);
      setInput("");
      setActivePerson({ ...person, _openNoteEdit: true });
    }
  }

  async function triggerQuickAskForPerson(person, introTarget) {
    // Check if person can be asked
    if (person.can_ask === false) {
      // Show intermediary suggestion
      const intermediary = person.vouch_path?.length >= 3
        ? person.vouch_path[person.vouch_path.length - 2]
        : null;
      if (intermediary) {
        setInput(`/ask ${intermediary.name}`);
        handleInputChange(`/ask ${intermediary.name}`);
        setAskError(`${person.name.split(" ")[0]} isn't accepting direct messages. Try reaching out through ${intermediary.name}.`);
        setTimeout(() => setAskError(null), 5000);
      } else {
        setAskError(`${person.name.split(" ")[0]} isn't accepting direct messages right now.`);
        setTimeout(() => setAskError(null), 3000);
      }
      return;
    }

    // Clear slash state
    setSlashMode(null);
    setSlashQuery("");
    setSlashResults([]);
    setSlashSelectedPeople([]);
    setInput("");

    // Get the last substantive user question for context (skip slash commands)
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user" && !m.text.startsWith("/"));
    // Also include the last brain response for richer context
    const lastBrainMsg2 = [...messages].reverse().find(m => m.role === "brain");
    const conversationContext = lastBrainMsg2?.text
      ? `${lastUserMsg?.text || ""}\n\nBrain's response: ${lastBrainMsg2.text.slice(0, 500)}`
      : (lastUserMsg?.text || "");
    const question = conversationContext;

    // Set up ask mode and trigger draft
    setSelectedPeople(new Set([person.id]));
    setAskMode(latestBrainMsgIndex >= 0 ? latestBrainMsgIndex : 0);
    setDraftingLoading(true);
    setAskError(null);

    try {
      // Check if 2nd+ degree — need context
      if (person.degree >= 2 && !person.career_overlap?.length) {
        // Fetch intermediary info
        let intermediaries = {};
        try {
          const pathRes = await fetch("/api/vouch-paths", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient_ids: [person.id] }),
          });
          if (pathRes.ok) intermediaries = await pathRes.json();
        } catch {}
        const ctx = {
          [person.id]: {
            knows_them: false,
            relationship: "",
            intermediary_context: "",
            intermediary_name: intermediaries[person.id]?.intermediary_name || null,
          },
        };
        setRecipientContext(ctx);
        setShowContextStep(true);
        setDraftingLoading(false);
        return;
      }

      // Build context if career overlap
      const ctx = person.career_overlap?.length > 0
        ? {
            [person.id]: {
              knows_them: true,
              relationship: `Worked together at ${person.career_overlap.join(", ")}`,
              intermediary_context: "",
              intermediary_name: null,
              auto_overlap: true,
            },
          }
        : {};

      const res = await fetch("/api/quick-ask/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          recipient_ids: [person.id],
          recipient_context: ctx,
          ...(introTarget ? { intro_target: { id: introTarget.id, name: introTarget.name, current_title: introTarget.current_title, current_company: introTarget.current_company } } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to draft message");

      setDrafts(data.drafts);
      setAskId(data.ask_id);
      capture("quick_ask_drafted", { recipient_count: 1, source: "slash_command" });
    } catch (err) {
      setAskError(err.message);
    } finally {
      setDraftingLoading(false);
    }
  }

  async function triggerGroupThreadForPeople(people) {
    // Clear slash state
    setSlashMode(null);
    setSlashQuery("");
    setSlashResults([]);
    setSlashSelectedPeople([]);
    setInput("");

    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    const question = lastUserMsg?.text || "";
    const ids = people.map(p => p.id);

    setSelectedPeople(new Set(ids));
    setAskMode(latestBrainMsgIndex >= 0 ? latestBrainMsgIndex : 0);
    setThreadMode(true);
    setShowContextStep(true);
    setThreadDraftLoading(false);

    // Check for 2nd+ degree people
    const needs2ndDegreeCtx = people.filter(p => p.degree >= 2 && !p.career_overlap?.length);
    let intermediaries = {};
    if (needs2ndDegreeCtx.length > 0) {
      try {
        const pathRes = await fetch("/api/vouch-paths", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient_ids: needs2ndDegreeCtx.map(p => p.id) }),
        });
        if (pathRes.ok) intermediaries = await pathRes.json();
      } catch {}
    }
    const ctx = {};
    needs2ndDegreeCtx.forEach(p => {
      ctx[p.id] = {
        knows_them: false,
        relationship: "",
        intermediary_context: "",
        intermediary_name: intermediaries[p.id]?.intermediary_name || null,
      };
    });
    setRecipientContext(ctx);
  }

  // ── Quick Ask handlers ────────────────────────────────────────────
  function handleCancelAskMode() {
    setAskMode(null);
    setSelectedPeople(new Set());
    setRecipientContext({});
    setShowContextStep(false);
    setDrafts(null);
    setAskId(null);
    setAskError(null);
    setDraftingLoading(false);
    // Reset thread state too
    setThreadMode(false);
    setThreadTopic("");
    setThreadDraft(null);
    setThreadDraftLoading(false);
  }

  // Auto-enter ask mode on first check, auto-exit when all unchecked
  function handleCheckboxToggle(personId, msgIndex) {
    setSelectedPeople(prev => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
        if (next.size === 0) {
          setAskMode(null);
          setRecipientContext({});
          setShowContextStep(false);
          setThreadMode(false);
          setThreadTopic("");
        }
      } else if (next.size < maxRecipients) {
        next.add(personId);
        if (askMode === null) {
          setAskMode(msgIndex);
          setDrafts(null);
          setAskId(null);
          setAskError(null);
          setDraftingLoading(false);
        }
      }
      return next;
    });
  }

  async function handleProceedToContext() {
    // Check if any selected people are 2nd/3rd degree
    const brainMsg = messages[askMode];
    const selected2ndPlus = (brainMsg?.people || []).filter(
      p => selectedPeople.has(p.id) && p.degree >= 2
    );
    if (selected2ndPlus.length > 0) {
      // Separate career-overlap people (auto-context) from non-overlap (need prompting)
      const overlapPeople = selected2ndPlus.filter(p => p.career_overlap && p.career_overlap.length > 0);
      const nonOverlapPeople = selected2ndPlus.filter(p => !p.career_overlap || p.career_overlap.length === 0);

      // Fetch intermediary names only for non-overlap 2nd+ degree people
      let intermediaries = {};
      if (nonOverlapPeople.length > 0) {
        try {
          const pathRes = await fetch("/api/vouch-paths", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient_ids: nonOverlapPeople.map(p => p.id) }),
          });
          if (pathRes.ok) intermediaries = await pathRes.json();
        } catch (e) { /* non-critical */ }
      }

      // Initialize context
      const ctx = {};
      // Auto-fill context for career overlap people — skip the "Do you know X?" prompt
      overlapPeople.forEach(p => {
        ctx[p.id] = {
          knows_them: true,
          relationship: `Worked together at ${p.career_overlap.join(", ")}`,
          intermediary_context: "",
          intermediary_name: null,
          auto_overlap: true,
        };
      });
      // Normal context for non-overlap people
      nonOverlapPeople.forEach(p => {
        ctx[p.id] = {
          knows_them: false,
          relationship: "",
          intermediary_context: "",
          intermediary_name: intermediaries[p.id]?.intermediary_name || null,
        };
      });

      if (nonOverlapPeople.length > 0) {
        // Some people still need context prompting
        setRecipientContext(ctx);
        setShowContextStep(true);
      } else {
        // All 2nd+ degree people have career overlap — skip context step, draft immediately
        setRecipientContext(ctx);
        handleDraftMessages(ctx);
      }
    } else {
      // All 1st degree — skip context step, but still pass career overlap context if available
      const allSelected = (brainMsg?.people || []).filter(p => selectedPeople.has(p.id));
      const overlapCtx = {};
      allSelected.forEach(p => {
        if (p.career_overlap && p.career_overlap.length > 0) {
          overlapCtx[p.id] = {
            knows_them: true,
            relationship: `Worked together at ${p.career_overlap.join(", ")}`,
            intermediary_context: "",
            intermediary_name: null,
            auto_overlap: true,
          };
        }
      });
      if (Object.keys(overlapCtx).length > 0) {
        setRecipientContext(overlapCtx);
        handleDraftMessages(overlapCtx);
      } else {
        handleDraftMessages();
      }
    }
  }

  async function handleDraftMessages(ctxOverride) {
    if (askMode === null || selectedPeople.size === 0) return;

    // The user question is in the message before the brain response
    const userMsg = messages[askMode - 1];
    const question = userMsg?.text || "";

    setDraftingLoading(true);
    setAskError(null);

    try {
      const res = await fetch("/api/quick-ask/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          recipient_ids: [...selectedPeople],
          recipient_context: ctxOverride || recipientContext,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to draft messages");

      setDrafts(data.drafts);
      setAskId(data.ask_id);
      capture("quick_ask_drafted", { recipient_count: data.drafts.length });
    } catch (err) {
      setAskError(err.message);
    } finally {
      setDraftingLoading(false);
    }
  }

  async function handleDraftThread() {
    if (askMode === null || selectedPeople.size < 2 || !threadTopic.trim()) return;
    const userMsg = messages[askMode - 1];
    const question = userMsg?.text || "";

    setThreadDraftLoading(true);
    setAskError(null);
    try {
      const res = await fetch("/api/threads/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: threadTopic.trim(),
          question,
          recipient_ids: Array.from(selectedPeople),
          recipient_context: recipientContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create thread draft");
      setThreadDraft(data);
      capture("thread_drafted", { thread_id: data.thread_id, participant_count: data.participants.length });
    } catch (err) {
      setAskError(err.message);
    } finally {
      setThreadDraftLoading(false);
    }
  }

  async function handleStartThreadMode() {
    setThreadMode(true);
    // Fetch intermediary names for 2nd+ degree people (same logic as handleProceedToContext)
    const brainMsg = messages[askMode];
    const selected2ndPlus = (brainMsg?.people || []).filter(
      p => selectedPeople.has(p.id) && p.degree >= 2
    );
    if (selected2ndPlus.length > 0) {
      let intermediaries = {};
      try {
        const pathRes = await fetch("/api/vouch-paths", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient_ids: selected2ndPlus.map(p => p.id) }),
        });
        if (pathRes.ok) intermediaries = await pathRes.json();
      } catch (e) { /* non-critical */ }
      const ctx = {};
      selected2ndPlus.forEach(p => {
        ctx[p.id] = {
          knows_them: false,
          relationship: "",
          intermediary_context: "",
          intermediary_name: intermediaries[p.id]?.intermediary_name || null,
        };
      });
      setRecipientContext(ctx);
    }
    setShowContextStep(true);
  }

  function handleAskDone() {
    setAskMode(null);
    setSelectedPeople(new Set());
    setRecipientContext({});
    setShowContextStep(false);
    setDrafts(null);
    setAskId(null);
    setAskError(null);
    setThreadMode(false);
    setThreadTopic("");
    setThreadDraft(null);
    setThreadDraftLoading(false);
  }

  // Fetch full person data from /api/person/:id and build rich profile for PersonDetailPanel
  async function fetchFullPerson(personId, fallback = {}) {
    try {
      const [res, overlapRes] = await Promise.all([
        fetch(`/api/person/${personId}`, { credentials: "include" }),
        fetch(`/api/person/${personId}/career-overlap`, { credentials: "include" }).catch(() => null),
      ]);
      if (!res.ok) return fallback;
      const data = await res.json();
      if (!data?.person) return fallback;
      const overlapData = overlapRes?.ok ? await overlapRes.json() : null;
      return {
        id: data.person.id || fallback.id,
        name: data.person.name || data.person.display_name || fallback.name,
        photo_url: data.person.photo_url || fallback.photo_url,
        current_title: data.person.current_title || fallback.current_title,
        current_company: data.person.current_company || fallback.current_company,
        location: data.person.location || fallback.location,
        linkedin_url: data.person.linkedin_url || fallback.linkedin_url,
        degree: data.degree ?? fallback.degree,
        vouch_path: data.vouch_path || fallback.vouch_path,
        ai_summary: data.ai_summary || fallback.ai_summary,
        employment_history: data.employment_history || [],
        recommendation_count: data.recommendation_count || fallback.recommendation_count || 0,
        user_overlap: overlapData?.user_overlap || null,
        gives: (data.person.gives || []).map(g => {
          const found = GIVE_TYPES.find(t => t.key === g);
          return found ? found.label : g;
        }),
        gives_free_text: data.person.gives_free_text || fallback.gives_free_text,
        can_ask: data.can_ask ?? fallback.can_ask,
        vouch_score: fallback.vouch_score,
      };
    } catch {
      return fallback;
    }
  }

  // Open/close person detail panel
  function handleOpenPerson(person) {
    setActivePerson(person);
    // Fetch full data (career overlap, gives, etc.) in background
    if (person?.id) fetchFullPerson(person.id, person).then(full => setActivePerson(full));
  }
  function handleClosePerson() {
    setActivePerson(null);
  }

  // ─── Bio interview handlers ──────────────────────────────────────
  async function handleStartBio() {
    setInput("");
    setSlashMode(null);
    setSlashQuery("");
    setSlashResults([]);

    try {
      // Check existing interview state
      const res = await fetch("/api/bio-interview", { credentials: "include" });
      if (!res.ok) {
        console.error("Bio GET failed:", res.status);
        setMessages(prev => [...prev, { role: "brain", text: "Sorry, something went wrong starting the career interview. Please try again." }]);
        return;
      }
      const data = await res.json();

      if (data.status === "active" || data.status === "paused") {
        // Resume existing interview
        const restored = (data.turns || []).map(t => ({
          role: t.role === "user" ? "user" : "bio",
          text: t.content,
        }));
        setBioMessages(restored);
        setBioStatus("active");
        setBioMode(true);
        return;
      }

      // Start new interview
      setBioMessages([]);
      setBioStatus("active");
      setBioMode(true);
      setBioLoading(true);

      const startRes = await fetch("/api/bio-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: "[start]" }),
      });
      if (!startRes.ok) {
        console.error("Bio POST failed:", startRes.status);
        setBioLoading(false);
        setBioMode(false);
        setMessages(prev => [...prev, { role: "brain", text: "Sorry, something went wrong starting the career interview. Please try again." }]);
        return;
      }
      const startData = await startRes.json();
      setBioMessages([{ role: "bio", text: startData.reply }]);
      setBioLoading(false);
    } catch (err) {
      console.error("Bio start error:", err);
      setBioLoading(false);
      setBioMode(false);
      setMessages(prev => [...prev, { role: "brain", text: "Sorry, something went wrong starting the career interview. Please try again." }]);
    }
  }

  async function handleBioSubmit(text) {
    if (!text.trim() || bioLoading) return;
    const userMsg = text.trim();

    setBioMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setBioLoading(true);

    try {
      const res = await fetch("/api/bio-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMsg }),
      });
      if (!res.ok) {
        setBioLoading(false);
        return;
      }
      const data = await res.json();
      const bioMsg = { role: "bio", text: data.reply };
      if (data.vouch_suggestion) bioMsg.vouchSuggestion = data.vouch_suggestion;
      if (data.interview_complete) bioMsg.interviewComplete = true;

      setBioMessages(prev => [...prev, bioMsg]);
      setBioLoading(false);

      if (data.interview_complete) {
        setBioStatus("completed");
      }
    } catch (err) {
      console.error("Bio submit error:", err);
      setBioLoading(false);
    }
  }

  async function handleBioPause() {
    try {
      await fetch("/api/bio-interview/pause", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    setBioMode(false);
    setBioStatus("paused");
    // Add a note to the main conversation
    setMessages(prev => [...prev, {
      role: "brain",
      text: "Career interview paused. Type /bio anytime to pick up where you left off.",
      isWelcome: true,
    }]);
  }


  async function handleOpenGives() {
    setInput("");
    setSlashMode(null);
    setSlashQuery("");
    setSlashResults([]);
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/person/${user.id}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      const p = data.person;
      setActivePerson({
        id: p.id,
        name: p.name,
        photo_url: p.photo_url,
        current_title: p.current_title,
        current_company: p.current_company,
        location: p.location,
        gives: p.gives || [],
        gives_free_text: p.gives_free_text || null,
        _isSelfGives: true,
      });
    } catch {}
  }

  async function handleStartVouch(functionId) {
    setVouchLoading(true);
    try {
      const res = await fetch("/api/start-vouch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobFunctionId: functionId }),
      });
      const data = await res.json();
      if (data.token) {
        window.location.href = `/vouch?token=${data.token}&ready=1`;
      }
    } catch {}
    setVouchLoading(false);
  }

  async function handleCompare(people) {
    // 1. Clear slash state
    setSlashMode(null);
    setSlashQuery("");
    setSlashResults([]);
    setSlashSelectedPeople([]);
    setInput("");

    const [p1, p2] = people;

    // 2. Add loading compare message to chat
    setMessages(prev => [...prev, {
      role: "compare",
      people: [p1, p2],
      profiles: [null, null],
      narration: "",
      narrationStreaming: false,
      loading: true,
    }]);

    try {
      // 3. Fetch full profiles in parallel
      const [res1, res2] = await Promise.all([
        fetch(`/api/person/${p1.id}`, { credentials: "include" }),
        fetch(`/api/person/${p2.id}`, { credentials: "include" }),
      ]);
      if (!res1.ok || !res2.ok) throw new Error("Failed to fetch profiles");
      const [data1, data2] = await Promise.all([res1.json(), res2.json()]);

      // 4. Build enriched profile objects
      const buildProfile = (data, original) => ({
        id: data.person.id,
        name: data.person.name,
        photo_url: data.person.photo_url,
        current_title: data.person.current_title,
        current_company: data.person.current_company,
        location: data.person.location,
        degree: data.degree,
        vouch_path: data.vouch_path,
        ai_summary: data.ai_summary,
        gives: (data.person.gives || []).map(g => {
          const found = GIVE_TYPES.find(t => t.key === g);
          return found ? found.label : g;
        }),
        gives_free_text: data.person.gives_free_text,
        recommendation_count: data.recommendation_count || 0,
        career_overlap_detail: original.career_overlap_detail || null,
        career_overlap: original.career_overlap || null,
        employment_history: data.employment_history || [],
      });

      const profile1 = buildProfile(data1, p1);
      const profile2 = buildProfile(data2, p2);

      // 5. Update message with profiles (card data ready)
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "compare" && last.loading) {
          updated[updated.length - 1] = { ...last, profiles: [profile1, profile2], loading: false, narrationStreaming: true };
        }
        return updated;
      });

      // 6. Stream narration from compare API
      const narrationRes = await fetch("/api/network-brain/compare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_ids: [p1.id, p2.id],
          history: messages
            .filter(m => m.role === "user" || m.role === "brain")
            .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
        }),
      });

      if (!narrationRes.ok) throw new Error("Compare narration failed");

      const reader = narrationRes.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let fullNarration = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const chunks = sseBuffer.split("\n\n");
        sseBuffer = chunks.pop();

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(chunk.slice(6));
            if (event.type === "token") {
              fullNarration += event.text;
              const streamText = fullNarration;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "compare" && last.narrationStreaming) {
                  updated[updated.length - 1] = { ...last, narration: streamText };
                }
                return updated;
              });
            } else if (event.type === "done") {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "compare") {
                  updated[updated.length - 1] = { ...last, narration: fullNarration, narrationStreaming: false };
                }
                return updated;
              });
            }
          } catch {}
        }
      }

      // Ensure streaming is marked done
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "compare" && last.narrationStreaming) {
          updated[updated.length - 1] = { ...last, narrationStreaming: false };
        }
        return updated;
      });

      capture("network_brain_compare", { person1: p1.id, person2: p2.id });
    } catch (err) {
      console.error("[Compare] Error:", err);
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "compare") {
          updated[updated.length - 1] = { ...last, loading: false, narrationStreaming: false, error: true };
        }
        return updated;
      });
    }
  }

  async function handleOpenStatus() {
    setInput("");
    setSlashMode(null);
    setSlashQuery("");
    setSlashResults([]);
    if (!user?.id) return;
    try {
      const [profileRes, statusRes] = await Promise.all([
        fetch(`/api/person/${user.id}`, { credentials: "include" }),
        fetch("/api/my-vouch-status", { credentials: "include" }),
      ]);
      if (!profileRes.ok || !statusRes.ok) return;
      const profileData = await profileRes.json();
      const statusData = await statusRes.json();
      const p = profileData.person;
      setActivePerson({
        id: p.id,
        name: p.name,
        photo_url: p.photo_url,
        current_title: p.current_title,
        current_company: p.current_company,
        _isVouchStatus: true,
        _vouchData: statusData,
      });
    } catch {}
  }

  const firstName = user?.name?.split(" ")[0] || "";

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh", background: "#000000", fontFamily: FONT,
      display: "flex", flexDirection: "column", alignItems: "center",
      overflowX: "clip",
    }}>
      <style>{`.disabled-check-tip:hover::after {
        content: "Not accepting messages";
        position: absolute; left: 50%; top: 28px; transform: translateX(-50%);
        white-space: nowrap; font-size: 11px; color: #fff; background: #374151;
        padding: 4px 8px; border-radius: 6px; z-index: 10;
        pointer-events: none; font-family: ${FONT};
      }`}</style>
      <SharedHeader user={authState === "authenticated" ? user : null} isMobile={isMobile}>
        {/* Brain-specific: avatar pill + notification bell */}
        {networkPeople.length > 0 && (
          <div
            onClick={() => setNetworkBinOpen(v => !v)}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.04)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            style={{
              display: "flex", alignItems: "center", cursor: "pointer",
              flex: 1, minWidth: 0, justifyContent: "flex-end",
              border: `1px solid ${C.border}`, borderRadius: 20,
              padding: "3px 8px 3px 4px",
              transition: "background 0.15s",
            }}
          >
            {headerAvatars.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", overflow: "hidden", flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
                {headerAvatars.map((p, i) => {
                  const sz = isMobile ? 24 : 26;
                  return (
                    <img
                      key={p.id}
                      src={p.photo_url}
                      alt=""
                      onError={e => { e.currentTarget.style.display = "none"; }}
                      style={{
                        width: sz, height: sz, borderRadius: sz * 0.26,
                        objectFit: "cover", flexShrink: 0,
                        marginLeft: i === 0 ? 0 : -8,
                        position: "relative", zIndex: headerAvatars.length - i,
                        boxShadow: "0 0 0 1.5px #fff",
                      }}
                    />
                  );
                })}
              </div>
            )}
            {!isMobile && (
              <span style={{ fontSize: 11, fontWeight: 600, color: networkBinOpen ? C.accent : C.sub, fontFamily: FONT, marginLeft: 6, flexShrink: 0 }}>{networkPeople.length}</span>
            )}
          </div>
        )}
        <button
          onClick={() => setNotifPanelOpen(true)}
          style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: 4 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {notifCounts.total > 0 && (
            <span style={{
              position: "absolute", top: 0, right: 0,
              background: C.accent, color: "#fff", fontSize: 10, fontWeight: 700,
              width: 16, height: 16, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: FONT,
            }}>
              {notifCounts.total > 9 ? "9+" : notifCounts.total}
            </span>
          )}
        </button>
        {/* User avatar + name → profile link */}
        <a
          href={`/person/${user?.id}`}
          style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", flexShrink: 0 }}
        >
          <PhotoAvatar name={user?.name} photoUrl={user?.photo_url} size={28} />
          {!isMobile && (
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT }}>{firstName}</span>
          )}
        </a>
      </SharedHeader>

      {/* Main content */}
      <div style={{
        width: "100%",
        background: "linear-gradient(180deg, #FFFFFF 0%, #FAF9F6 15%, #FAF9F6 100%)",
        padding: "0 16px 120px", margin: "52px 0 0",
        minHeight: "calc(100vh - 52px)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ maxWidth: isMobile ? 480 : 700, margin: "0 auto", width: "100%", flex: 1, display: "flex", flexDirection: "column" }}>

          {/* Checking auth */}
          {authState === "checking" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 40 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  height: 52, borderRadius: 12,
                  background: "linear-gradient(90deg, #e8e4e0 25%, #ddd8d4 50%, #e8e4e0 75%)",
                  backgroundSize: "200% 100%",
                  animation: `shimmer 1.2s ${i * 0.15}s infinite`,
                }} />
              ))}
              <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
@keyframes brainCursorBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes fadeSlideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes panelContentFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            </div>
          )}

          {/* Unauthenticated */}
          {authState === "unauthenticated" && <LoginPrompt />}

          {/* Authenticated — Brain UI */}
          {authState === "authenticated" && (
            <>

              {/* Conversation area — single-column layout */}
              <div style={{ flex: 1, paddingTop: 16, paddingBottom: mobileKeyboardOpen ? 20 : 160, maxWidth: isMobile ? 480 : 700, margin: "0 auto", width: "100%" }}>

                {/* Bio interview mode */}
                {bioMode && (
                  <>
                    {/* Bio header banner — sticky at top */}
                    <div style={{
                      position: "sticky", top: 52, zIndex: 50,
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 16px", marginBottom: 16,
                      background: "#EEF2FF", borderRadius: 12,
                      border: "1px solid #C7D2FE",
                      boxShadow: "0 2px 8px rgba(99,102,241,0.08)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 16 }}>🎙️</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: FONT }}>Career Interview</span>
                      </div>
                      <button
                        onClick={handleBioPause}
                        style={{
                          padding: "5px 14px", fontSize: 12, fontWeight: 600,
                          background: "#fff", color: C.sub, border: `1px solid ${C.border}`,
                          borderRadius: 8, fontFamily: FONT, cursor: "pointer",
                        }}
                      >
                        Pause
                      </button>
                    </div>

                    {/* Bio messages */}
                    {bioMessages.map((msg, i) => (
                      <div key={i} style={{ marginBottom: 16 }}>
                        {msg.role === "user" ? (
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <div style={{
                              background: C.userBubble, color: C.ink,
                              border: `1px solid ${C.userBubbleBorder}`,
                              padding: "10px 16px", borderRadius: "16px 16px 4px 16px",
                              fontSize: 14, lineHeight: 1.5, fontFamily: FONT,
                              maxWidth: "85%",
                            }}>
                              {msg.text}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div style={{
                              background: "#fff", color: C.ink,
                              border: `1px solid ${C.border}`,
                              padding: "12px 16px", borderRadius: "16px 16px 16px 4px",
                              fontSize: 14, lineHeight: 1.6, fontFamily: FONT,
                              maxWidth: "85%",
                            }}>
                              {msg.text}
                            </div>

                            {/* Vouch suggestion nudge */}
                            {msg.vouchSuggestion && (
                              <div
                                onClick={() => { handleBioPause(); setTimeout(() => handleInputChange("/vouch"), 100); }}
                                style={{
                                  marginTop: 8, padding: "8px 14px",
                                  background: "#FFFBEB", border: "1px solid #FDE68A",
                                  borderRadius: 10, fontSize: 13, color: "#92400E",
                                  fontFamily: FONT, cursor: "pointer",
                                  maxWidth: "85%",
                                }}
                              >
                                💡 Want to vouch for <strong>{msg.vouchSuggestion.name}</strong>?
                                {msg.vouchSuggestion.organization && ` (${msg.vouchSuggestion.organization})`}
                              </div>
                            )}

                            {/* Interview complete card */}
                            {msg.interviewComplete && (
                              <div style={{
                                marginTop: 12, padding: "14px 16px",
                                background: "#F0FDF4", border: "1px solid #86EFAC",
                                borderRadius: 12, maxWidth: "85%",
                              }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "#16A34A", fontFamily: FONT, marginBottom: 4 }}>
                                  Interview complete
                                </div>
                                <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, lineHeight: 1.5 }}>
                                  Your profile is being updated with the details you shared. This will improve how the Brain understands your background.
                                </div>
                                <button
                                  onClick={() => { setBioMode(false); }}
                                  style={{
                                    marginTop: 10, padding: "7px 16px",
                                    background: C.accent, color: "#fff", border: "none",
                                    borderRadius: 8, fontSize: 13, fontWeight: 600,
                                    fontFamily: FONT, cursor: "pointer",
                                  }}
                                >
                                  Back to Brain
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Bio loading indicator */}
                    {bioLoading && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{
                          background: "#fff", border: `1px solid ${C.border}`,
                          padding: "12px 16px", borderRadius: "16px 16px 16px 4px",
                          display: "inline-flex", gap: 4,
                        }}>
                          {[0, 1, 2].map(j => (
                            <div key={j} style={{
                              width: 6, height: 6, borderRadius: "50%",
                              background: C.sub,
                              animation: `typingDot 1.4s ease-in-out ${j * 0.2}s infinite`,
                            }} />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Normal messages (hidden when in bio mode) */}
                {!bioMode && messages.map((msg, i) => {
                  const isLastBrain = msg.role === "brain" && i === messages.length - 1;
                  const isLastCompare = msg.role === "compare" && i === messages.length - 1;
                  return (
                    <div key={i} ref={isLastBrain || isLastCompare ? lastBrainRef : undefined} style={{ marginBottom: 16 }}>
                      {msg.role === "user" ? (
                        /* User question bubble */
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <div style={{
                            background: C.userBubble, color: C.ink,
                            border: `1px solid ${C.userBubbleBorder}`,
                            padding: "10px 16px", borderRadius: "16px 16px 4px 16px",
                            fontSize: 14, lineHeight: 1.5, fontFamily: FONT,
                            maxWidth: "85%",
                          }}>
                            {msg.text}
                          </div>
                        </div>
                      ) : msg.role === "compare" ? (
                        /* Compare card */
                        <div style={{
                          background: "#FFFFFF",
                          padding: "16px 18px", borderRadius: "4px 16px 16px 16px",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                        }}>
                          {msg.loading ? (
                            /* Loading state */
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0" }}>
                              <div style={{
                                width: 8, height: 8, borderRadius: "50%",
                                background: C.accent, animation: "pulse 1.2s infinite",
                              }} />
                              <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>
                                Comparing {msg.people[0]?.name?.split(" ")[0]} and {msg.people[1]?.name?.split(" ")[0]}...
                              </span>
                            </div>
                          ) : msg.error ? (
                            <div style={{ fontSize: 13, color: C.error, fontFamily: FONT }}>
                              Failed to load comparison. Try again.
                            </div>
                          ) : (
                            <>
                              {/* Side-by-side profiles */}
                              <div style={{
                                display: "grid",
                                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                                gap: isMobile ? 16 : 20,
                              }}>
                                {msg.profiles.filter(Boolean).map((prof, pi) => {
                                  const profFirst = prof.name?.split(" ")[0] || "";
                                  return (
                                    <div key={prof.id} style={{
                                      ...(isMobile && pi === 1 ? { borderTop: `1px solid ${C.border}`, paddingTop: 16 } : {}),
                                    }}>
                                      {/* Header: photo + name + title */}
                                      <div
                                        onClick={() => handleOpenPerson(prof)}
                                        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 10 }}
                                      >
                                        <PhotoAvatar name={prof.name} photoUrl={prof.photo_url} size={40} degree={prof.degree} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: FONT }}>
                                            {prof.name}
                                          </div>
                                          {(prof.current_title || prof.current_company) && (
                                            <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.3, marginTop: 1 }}>
                                              {[prof.current_title, prof.current_company].filter(Boolean).join(" at ")}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Vouch path */}
                                      {prof.vouch_path && prof.vouch_path.length >= 2 && (
                                        <div style={{ marginBottom: 8 }}>
                                          <ConnectionPathway path={prof.vouch_path} />
                                        </div>
                                      )}

                                      {/* Shared history (adjacent to vouch path) */}
                                      {prof.career_overlap_detail?.length > 0 && (
                                        <div style={{ marginBottom: 8 }}>
                                          {prof.career_overlap_detail.map((o, oi) => (
                                            <div key={oi} style={{ fontSize: 12, color: C.ink, fontFamily: FONT, lineHeight: 1.4 }}>
                                              <span style={{ marginRight: 3 }}>⚡</span>
                                              <strong>{o.org}</strong>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* Vouches */}
                                      {prof.recommendation_count > 0 && (
                                        <div style={{ fontSize: 12, color: C.ink, fontFamily: FONT, marginBottom: 8 }}>
                                          ⭐ Vouched for by {prof.recommendation_count} {prof.recommendation_count === 1 ? "person" : "people"}
                                        </div>
                                      )}

                                      {/* Gives */}
                                      {prof.gives?.length > 0 && (
                                        <div style={{ marginBottom: 8 }}>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: FONT, marginBottom: 3 }}>
                                            Can help with
                                          </div>
                                          {prof.gives.map((g, gi) => (
                                            <div key={gi} style={{ fontSize: 12, color: C.ink, fontFamily: FONT, lineHeight: 1.4, paddingLeft: 10, position: "relative" }}>
                                              <span style={{ position: "absolute", left: 0, color: C.sub }}>·</span>
                                              {g}
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* AI summary snippet */}
                                      {prof.ai_summary && (
                                        <div style={{
                                          fontSize: 12, color: C.sub, fontFamily: FONT, lineHeight: 1.5,
                                          overflow: "hidden", display: "-webkit-box",
                                          WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                                        }}>
                                          {prof.ai_summary}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Narration */}
                              {(msg.narration || msg.narrationStreaming) && (
                                <div style={{
                                  marginTop: 16, paddingTop: 14,
                                  borderTop: `1px solid ${C.border}`,
                                }}>
                                  <div style={{ fontSize: 14, color: C.ink, fontFamily: FONT, lineHeight: 1.6 }}>
                                    {renderMarkdown(msg.narration, { people: msg.profiles || [], onOpenPerson: handleOpenPerson })}
                                    {msg.narrationStreaming && (
                                      <span style={{
                                        display: "inline-block", width: 2, height: "1em",
                                        background: C.accent, marginLeft: 2, verticalAlign: "text-bottom",
                                        animation: "brainCursorBlink 1s step-end infinite",
                                      }} />
                                    )}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        /* Brain answer */
                        <div>
                          <div style={{
                            background: "#FFFFFF",
                            padding: "16px 18px", borderRadius: "4px 16px 16px 16px",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                          }}>
                            {msg.response_type === "browse" ? (
                              /* Browse mode: brief header + compact card grid */
                              <>
                                {renderMarkdown(msg.text, { people: msg.people, onOpenPerson: handleOpenPerson })}
                                {msg.people?.length > 0 && (
                                  <div style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                    gap: 8, marginTop: 12,
                                  }}>
                                    {msg.people.map(p => (
                                      <div
                                        key={p.id}
                                        onClick={() => handleOpenPerson(p)}
                                        style={{
                                          padding: "10px",
                                          background: "#F9FAFB",
                                          border: `1px solid ${C.border}`,
                                          borderRadius: 10, cursor: "pointer",
                                          textAlign: "center", transition: "all 0.15s",
                                        }}
                                      >
                                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                                          <PhotoAvatar name={p.name} photoUrl={p.photo_url} size={40} degree={p.degree} />
                                        </div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, fontFamily: FONT, lineHeight: 1.3 }}>
                                          {p.name}
                                        </div>
                                        {(p.current_title || p.current_company) && (
                                          <div style={{
                                            fontSize: 10, color: C.sub, fontFamily: FONT,
                                            marginTop: 2, lineHeight: 1.3,
                                            overflow: "hidden", textOverflow: "ellipsis",
                                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                                          }}>
                                            {p.current_title}{p.current_title && p.current_company ? ", " : ""}{p.current_company}
                                          </div>
                                        )}
                                        {p.career_overlap?.length > 0 && (
                                          <div style={{
                                            fontSize: 9, color: C.accent, fontFamily: FONT,
                                            marginTop: 4, lineHeight: 1.3, fontWeight: 500,
                                          }}>
                                            ⚡ {p.career_overlap.slice(0, 2).join(", ")}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            ) : (
                              /* Narrative mode: inline person tokens (or streaming text) */
                              <>
                                {renderMarkdown(msg.text, { people: msg.people, onOpenPerson: handleOpenPerson })}
                                {msg.streaming && (
                                  <span style={{
                                    display: "inline-block", width: 2, height: "1em",
                                    background: C.accent, marginLeft: 2, verticalAlign: "text-bottom",
                                    animation: "brainCursorBlink 1s step-end infinite",
                                  }} />
                                )}
                              </>
                            )}
                            {showDebug && msg.version && (
                              <div style={{ textAlign: "right", marginTop: 4, fontSize: 10, color: "#9CA3AF", fontFamily: FONT }}>
                                v{msg.version}{msg.response_type === "browse" ? " browse" : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}


                {/* Loading indicator */}
                {loading && !bioMode && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0" }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: C.accent, animation: "pulse 1.2s infinite",
                    }} />
                    <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>
                      Searching your network...
                    </span>
                    <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }`}</style>
                  </div>
                )}

                {/* Typing dots during welcome reveal sequence */}
                {welcomeRevealing && messages.length > 0 && !messages[messages.length - 1]?.streaming && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 0", opacity: 0.6 }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: 6, height: 6, borderRadius: "50%", background: C.accent,
                        animation: `typingDot 1.2s ${i * 0.2}s infinite`,
                      }} />
                    ))}
                    <style>{`@keyframes typingDot { 0%, 60%, 100% { opacity: 0.2; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-4px); } }`}</style>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>

              {/* Modal overlay for QuickAskDraftPanel */}
              {drafts && (
                <div
                  onClick={handleCancelAskMode}
                  style={{
                    position: "fixed", inset: 0, zIndex: 200,
                    background: "rgba(0,0,0,0.4)",
                    display: "flex",
                    alignItems: isMobile ? "flex-end" : "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      background: "#fff",
                      borderRadius: isMobile ? "16px 16px 0 0" : 16,
                      maxWidth: 520, width: "100%",
                      maxHeight: isMobile ? "85vh" : "80vh",
                      overflow: "auto",
                      padding: "20px 16px",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                    }}
                  >
                    <QuickAskDraftPanel
                      drafts={drafts}
                      setDrafts={setDrafts}
                      askId={askId}
                      onDone={handleAskDone}
                      onCancel={handleCancelAskMode}
                    />
                  </div>
                </div>
              )}

              {/* Modal overlay for ThreadDraftPanel */}
              {threadDraft && (
                <div
                  onClick={handleCancelAskMode}
                  style={{
                    position: "fixed", inset: 0, zIndex: 200,
                    background: "rgba(0,0,0,0.4)",
                    display: "flex",
                    alignItems: isMobile ? "flex-end" : "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      background: "#fff",
                      borderRadius: isMobile ? "16px 16px 0 0" : 16,
                      maxWidth: 520, width: "100%",
                      maxHeight: isMobile ? "85vh" : "80vh",
                      overflow: "auto",
                      padding: "20px 16px",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                    }}
                  >
                    <ThreadDraftPanel
                      threadId={threadDraft.thread_id}
                      creatorToken={threadDraft.creator_token}
                      topic={threadDraft.topic}
                      draftBody={threadDraft.draft_body}
                      participants={threadDraft.participants}
                      onDone={handleAskDone}
                      onCancel={handleCancelAskMode}
                    />
                  </div>
                </div>
              )}

              {/* Drafting overlay (direct ask — no context step) */}
              {draftingLoading && !showContextStep && !drafts && (
                <div style={{
                  position: "fixed", inset: 0, zIndex: 200,
                  background: "rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: isMobile ? "flex-end" : "center",
                  justifyContent: "center",
                }}>
                  <div style={{
                    background: "#fff",
                    borderRadius: isMobile ? "16px 16px 0 0" : 16,
                    maxWidth: 400, width: "100%",
                    padding: "28px 24px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                      {/* Shimmer bars */}
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{
                          width: i === 2 ? "60%" : "100%", height: i === 0 ? 16 : 12,
                          borderRadius: 6,
                          background: "linear-gradient(90deg, #E7E5E0 25%, #D6D3CE 50%, #E7E5E0 75%)",
                          backgroundSize: "200% 100%",
                          animation: `shimmer 1.2s ${i * 0.15}s infinite`,
                        }} />
                      ))}
                      <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic", marginTop: 4 }}>
                        Drafting message for your review...
                      </div>
                      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal overlay for context step (2nd+ degree /ask or /group) */}
              {showContextStep && !drafts && !threadDraft && (
                <div
                  onClick={handleCancelAskMode}
                  style={{
                    position: "fixed", inset: 0, zIndex: 200,
                    background: "rgba(0,0,0,0.4)",
                    display: "flex",
                    alignItems: isMobile ? "flex-end" : "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      background: "#fff",
                      borderRadius: isMobile ? "16px 16px 0 0" : 16,
                      maxWidth: 520, width: "100%",
                      maxHeight: isMobile ? "85vh" : "80vh",
                      overflow: "auto",
                      padding: "20px 16px",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                    }}
                  >
                    {draftingLoading || threadDraftLoading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0" }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: C.accent, animation: "pulse 1.2s infinite",
                        }} />
                        <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>
                          {threadDraftLoading ? "Drafting thread outreach..." : "Drafting personalized messages..."}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: C.sub,
                          textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12,
                        }}>
                          {threadMode
                            ? (Object.keys(recipientContext).length > 0 ? "Context + thread topic" : "Set your thread topic")
                            : "Quick context for better drafts"}
                        </div>
                        {Object.keys(recipientContext).map(pid => {
                          const allPeople = [...(latestBrainMsg?.people || []), ...slashSelectedPeople];
                          const person = allPeople.find(p => p.id === Number(pid));
                          if (!person) return null;
                          const ctx = recipientContext[pid];
                          if (ctx.auto_overlap) return null;
                          const personFirst = (person.name || person.display_name || "").split(" ")[0];
                          const intermediaryFirst = ctx.intermediary_name?.split(" ")[0];
                          return (
                            <div key={pid} style={{ marginBottom: 14 }}>
                              {ctx.intermediary_name && (
                                <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginBottom: 8 }}>
                                  Connected to {personFirst} via <strong style={{ color: C.ink }}>{ctx.intermediary_name}</strong>
                                </div>
                              )}
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 6 }}>
                                Do you already know {personFirst}?
                              </div>
                              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                                {[{ label: "No", val: false }, { label: "Yes", val: true }].map(opt => (
                                  <button
                                    key={opt.label}
                                    onClick={() => setRecipientContext(prev => ({
                                      ...prev,
                                      [pid]: { ...prev[pid], knows_them: opt.val, relationship: opt.val ? prev[pid]?.relationship || "" : "" },
                                    }))}
                                    style={{
                                      padding: "5px 14px",
                                      background: ctx.knows_them === opt.val ? (opt.val ? C.accent : "#6B7280") : "#fff",
                                      color: ctx.knows_them === opt.val ? "#fff" : C.sub,
                                      border: `1.5px solid ${ctx.knows_them === opt.val ? (opt.val ? C.accent : "#6B7280") : C.border}`,
                                      borderRadius: 6, fontSize: 12, fontWeight: 600,
                                      fontFamily: FONT, cursor: "pointer", transition: "all 0.15s",
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                              {ctx.knows_them && (
                                <input
                                  type="text" value={ctx.relationship}
                                  onChange={e => setRecipientContext(prev => ({ ...prev, [pid]: { ...prev[pid], relationship: e.target.value } }))}
                                  placeholder={`How do you know ${personFirst}?`}
                                  style={{
                                    width: "100%", padding: "8px 10px", fontSize: 16, fontFamily: FONT,
                                    color: C.ink, background: "#fff", border: `1.5px solid ${C.border}`,
                                    borderRadius: 6, boxSizing: "border-box", WebkitAppearance: "none",
                                  }}
                                />
                              )}
                              {!ctx.knows_them && intermediaryFirst && (
                                <>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 6, marginTop: 10 }}>
                                    How do you know {intermediaryFirst}?
                                  </div>
                                  <input
                                    type="text" value={ctx.intermediary_context}
                                    onChange={e => setRecipientContext(prev => ({ ...prev, [pid]: { ...prev[pid], intermediary_context: e.target.value } }))}
                                    placeholder={`e.g., ${intermediaryFirst} and I worked together at…`}
                                    style={{
                                      width: "100%", padding: "8px 10px", fontSize: 16, fontFamily: FONT,
                                      color: C.ink, background: "#fff", border: `1.5px solid ${C.border}`,
                                      borderRadius: 6, boxSizing: "border-box", WebkitAppearance: "none",
                                    }}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                        {threadMode && (
                          <div style={{ marginBottom: 12, marginTop: Object.keys(recipientContext).length > 0 ? 8 : 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT, marginBottom: 6 }}>
                              Thread topic
                            </div>
                            <input
                              value={threadTopic}
                              onChange={e => setThreadTopic(e.target.value)}
                              placeholder="e.g., Exploring health tech opportunities"
                              style={{
                                width: "100%", padding: "8px 10px", fontSize: 16, fontFamily: FONT,
                                color: C.ink, background: "#fff", border: `1.5px solid ${C.border}`,
                                borderRadius: 6, boxSizing: "border-box", WebkitAppearance: "none",
                              }}
                            />
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          <button
                            onClick={handleCancelAskMode}
                            style={{
                              padding: "8px 14px", background: "#F5F5F4",
                              color: C.sub, border: `1px solid ${C.border}`,
                              borderRadius: 8, fontSize: 13, fontWeight: 600,
                              fontFamily: FONT, cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                          {threadMode ? (
                            <button
                              onClick={handleDraftThread}
                              disabled={!threadTopic.trim()}
                              style={{
                                padding: "8px 16px",
                                background: threadTopic.trim() ? C.accent : "#D4CAFE",
                                color: "#fff", border: "none", borderRadius: 8,
                                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                                cursor: threadTopic.trim() ? "pointer" : "not-allowed",
                              }}
                            >
                              Draft thread outreach
                            </button>
                          ) : (
                            <button
                              onClick={handleDraftMessages}
                              style={{
                                padding: "8px 16px", background: C.accent,
                                color: "#fff", border: "none", borderRadius: 8,
                                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                                cursor: "pointer",
                              }}
                            >
                              Draft email for review
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Fixed input bar */}
              <div style={{
                position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
                width: "100%",
                background: "linear-gradient(0deg, #FAF9F6 0%, #FAF9F6 80%, transparent 100%)",
                padding: isMobile ? "10px 16px 10px" : "24px 16px 24px",
              }}>
                <div style={{
                  maxWidth: isMobile ? 480 : 700, margin: "0 auto", position: "relative",
                }}>

                {/* Vouch function picker */}
                {slashMode === "vouch" && (
                  <div style={{
                    position: "absolute", bottom: "100%", left: 0, right: 0,
                    marginBottom: 8,
                    background: "#fff", borderRadius: 12,
                    border: `1.5px solid ${C.border}`,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                    maxHeight: 320, overflow: "auto",
                  }}>
                    <div style={{
                      padding: "12px 16px 8px",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.sub, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Vouch for your all-time best colleagues in:
                      </span>
                      <button
                        onClick={() => { setSlashMode(null); setSlashQuery(""); }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, fontSize: 15, color: C.sub, lineHeight: 1 }}
                      >✕</button>
                    </div>
                    {vouchFunctions.length === 0 ? (
                      <div style={{ padding: "12px 16px", fontSize: 13, color: C.sub, fontFamily: FONT, fontStyle: "italic" }}>
                        Loading functions...
                      </div>
                    ) : vouchFunctions.map(fn => {
                      const alreadyVouched = vouchedSlugs.has(fn.slug);
                      return (
                        <div
                          key={fn.id}
                          onClick={() => !vouchLoading && handleStartVouch(fn.id)}
                          style={{
                            padding: "10px 16px",
                            cursor: vouchLoading ? "wait" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            borderTop: `1px solid ${C.border}`,
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#F9FAFB"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = ""; }}
                        >
                          <div>
                            <div style={{ fontSize: 14, color: C.ink, fontFamily: FONT, fontWeight: 500 }}>
                              {fn.name}
                            </div>
                            {alreadyVouched && (
                              <div style={{ fontSize: 11, color: C.success, fontFamily: FONT, marginTop: 1 }}>
                                Update your picks
                              </div>
                            )}
                          </div>
                          {alreadyVouched && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Slash command autocomplete dropdown */}
                {slashMode && slashMode !== "vouch" && (slashResults.length > 0 || slashSelectedPeople.length > 0) && (
                  <div style={{
                    position: "absolute", bottom: "100%", left: 0, right: 0,
                    marginBottom: 8,
                    background: "#fff", borderRadius: 12,
                    border: `1.5px solid ${C.border}`,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                    maxHeight: 280, overflow: "auto",
                  }}>
                    {/* Selected people chips for /group and /compare */}
                    {(slashMode === "group" || slashMode === "compare") && slashSelectedPeople.length > 0 && (
                      <div style={{
                        display: "flex", flexWrap: "wrap", gap: 6,
                        padding: "10px 12px", borderBottom: `1px solid ${C.border}`,
                      }}>
                        {slashSelectedPeople.map(p => (
                          <span
                            key={p.id}
                            onClick={() => handleSlashSelect(p)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "4px 10px", background: C.accentLight,
                              border: `1px solid ${C.chipBorder}`, borderRadius: 16,
                              fontSize: 12, fontWeight: 600, color: C.accent,
                              fontFamily: FONT, cursor: "pointer",
                            }}
                          >
                            {p.name || p.display_name}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Header */}
                    <div style={{
                      padding: "8px 12px", fontSize: 11, fontWeight: 700,
                      color: C.sub, textTransform: "uppercase", letterSpacing: 0.5,
                      fontFamily: FONT,
                    }}>
                      {slashQuery ? "Search results" : "Recently mentioned"}
                    </div>
                    {/* Results */}
                    {slashResults.map(p => {
                      const isGroupSelected = slashSelectedPeople.some(sp => sp.id === p.id);
                      const isCompareMaxed = slashMode === "compare" && slashSelectedPeople.length >= 2 && !isGroupSelected;
                      return (
                        <div
                          key={p.id}
                          onClick={() => !isCompareMaxed && handleSlashSelect(p)}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 12px", cursor: isCompareMaxed ? "default" : "pointer",
                            background: isGroupSelected ? C.accentLight : "transparent",
                            opacity: isCompareMaxed ? 0.4 : 1,
                            transition: "background 0.1s, opacity 0.15s",
                          }}
                          onMouseEnter={e => { if (!isGroupSelected && !isCompareMaxed) e.currentTarget.style.background = "#F9FAFB"; }}
                          onMouseLeave={e => { if (!isGroupSelected && !isCompareMaxed) e.currentTarget.style.background = "transparent"; }}
                        >
                          <PhotoAvatar name={p.name || p.display_name} photoUrl={p.photo_url} size={28} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: FONT }}>
                              {p.name || p.display_name}
                            </div>
                            {(p.current_title || p.current_company) && (
                              <div style={{
                                fontSize: 11, color: C.sub, fontFamily: FONT,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>
                                {[p.current_title, p.current_company].filter(Boolean).join(" at ")}
                              </div>
                            )}
                          </div>
                          {(slashMode === "group" || slashMode === "compare") && isGroupSelected && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                    {/* /group submit button */}
                    {slashMode === "group" && slashSelectedPeople.length >= 2 && (
                      <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}` }}>
                        <button
                          onClick={() => triggerGroupThreadForPeople(slashSelectedPeople)}
                          style={{
                            width: "100%", padding: "8px 16px",
                            background: C.accent, color: "#fff", border: "none",
                            borderRadius: 8, fontSize: 13, fontWeight: 600,
                            fontFamily: FONT, cursor: "pointer",
                          }}
                        >
                          Start group thread ({slashSelectedPeople.length})
                        </button>
                      </div>
                    )}
                    {/* /compare submit button */}
                    {slashMode === "compare" && slashSelectedPeople.length === 2 && (
                      <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}` }}>
                        <button
                          onClick={() => handleCompare(slashSelectedPeople)}
                          style={{
                            width: "100%", padding: "8px 16px",
                            background: C.accent, color: "#fff", border: "none",
                            borderRadius: 8, fontSize: 13, fontWeight: 600,
                            fontFamily: FONT, cursor: "pointer",
                          }}
                        >
                          Compare
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Ask error toast */}
                {askError && (
                  <div style={{
                    position: "absolute", bottom: "100%", left: 0, right: 0,
                    marginBottom: 8, padding: "10px 14px",
                    background: "#FEF2F2", borderRadius: 10,
                    border: "1px solid #FECACA",
                    fontSize: 13, color: "#DC2626", fontFamily: FONT,
                  }}>
                    {askError}
                  </div>
                )}

                <form
                  onSubmit={handleSubmit}
                  style={{
                    display: "flex", gap: 8, alignItems: "flex-end",
                  }}
                >
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => {
                      const val = e.target.value;
                      bioMode ? setInput(val) : handleInputChange(val);
                      // Auto-grow: reset to 1 row then expand to scrollHeight
                      e.target.style.height = "auto";
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                        // Reset height after submit
                        requestAnimationFrame(() => {
                          if (inputRef.current) {
                            inputRef.current.style.height = "auto";
                            inputRef.current.style.height = "48px";
                          }
                        });
                      }
                    }}
                    placeholder={bioMode
                      ? "Share your experience..."
                      : (hasInteracted || messages.length > 0
                        ? (firstName ? `Ask about your network, ${firstName}...` : "Ask about your network...")
                        : PLACEHOLDER_PROMPTS[placeholderIndex])}
                    disabled={loading || welcomeRevealing || bioLoading}
                    autoFocus
                    rows={1}
                    style={{
                      flex: 1, padding: "14px 16px",
                      fontSize: 16, border: `1.5px solid ${C.border}`,
                      borderRadius: 14, fontFamily: FONT,
                      color: C.ink, background: "#fff",
                      WebkitAppearance: "none",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      outline: "none",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                      resize: "none",
                      overflow: "hidden",
                      lineHeight: "20px",
                      height: 48,
                      maxHeight: 120,
                    }}
                    onFocus={e => { setHasInteracted(true); e.target.style.borderColor = C.accent; e.target.style.boxShadow = "0 0 0 3px rgba(109,91,208,0.12)"; }}
                    onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; }}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading || welcomeRevealing || bioLoading}
                    style={{
                      width: 48, height: 48,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: input.trim() && !loading && !bioLoading ? C.accent : "#D4CAFE",
                      color: "#fff", border: "none", borderRadius: 14,
                      cursor: input.trim() && !loading && !bioLoading ? "pointer" : "not-allowed",
                      flexShrink: 0, transition: "background 0.15s",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                    }}
                  >
                    <SendIcon />
                  </button>
                </form>
                {/* Slash command hints — clickable to open guide (hidden in bio mode + when keyboard open) */}
                {bioMode || (isMobile && mobileKeyboardOpen) ? null : isMobile ? (
                  <div
                    onClick={() => setSlashGuideOpen(true)}
                    style={{
                      display: "flex", justifyContent: "center",
                      marginTop: 8, fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
                      color: slashHighlighted ? C.accent : "rgba(109,91,208,0.65)", letterSpacing: "0.02em",
                      fontWeight: slashHighlighted ? 600 : 500,
                      padding: "8px 16px", cursor: "pointer",
                      borderRadius: 10,
                      background: slashHighlighted ? "rgba(109,91,208,0.08)" : "transparent",
                      border: slashHighlighted ? `1.5px solid rgba(109,91,208,0.3)` : "1.5px solid transparent",
                      transition: "all 0.5s ease-in-out",
                    }}
                  >
                    <span>/ commands</span>
                  </div>
                ) : (
                  <div
                    onClick={() => setSlashGuideOpen(v => !v)}
                    style={{
                      display: "flex", justifyContent: "center", gap: 14,
                      marginTop: 8, fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
                      color: slashHighlighted ? C.accent : "rgba(109,91,208,0.65)", letterSpacing: "0.02em",
                      fontWeight: slashHighlighted ? 600 : 500,
                      padding: "8px 16px", cursor: "pointer",
                      borderRadius: 10,
                      background: slashHighlighted ? "rgba(109,91,208,0.08)" : "transparent",
                      border: slashHighlighted ? `1.5px solid rgba(109,91,208,0.3)` : "1.5px solid transparent",
                      transition: "all 0.5s ease-in-out",
                    }}
                  >
                    {["/ask", "/group", "/vouch", "/note", "/give", "/status", "/compare", "/bio"].map((cmd, i) => (
                      <span key={cmd}>
                        {i > 0 && <span style={{ color: slashHighlighted ? "rgba(109,91,208,0.4)" : "rgba(109,91,208,0.25)", marginRight: 14 }}>·</span>}
                        {cmd}
                      </span>
                    ))}
                  </div>
                )}

                {/* Slash command guide panel */}
                {slashGuideOpen && (() => {
                  const SLASH_COMMANDS = [
                    { cmd: "/ask", desc: "Send a message to someone in your network", action: () => handleInputChange("/ask ") },
                    { cmd: "/group", desc: "Start a group conversation", action: () => handleInputChange("/group ") },
                    { cmd: "/vouch", desc: "Recommend your best colleagues", action: () => handleInputChange("/vouch") },
                    { cmd: "/note", desc: "Add a private note about someone", action: () => handleInputChange("/note ") },
                    { cmd: "/give", desc: "Update what help you offer", action: () => handleInputChange("/give") },
                    { cmd: "/status", desc: "Check invite responses", action: () => handleInputChange("/status") },
                    { cmd: "/compare", desc: "Compare two people side by side", action: () => handleInputChange("/compare ") },
                    { cmd: "/bio", desc: "Tell the Brain about your career journey", action: () => handleInputChange("/bio") },
                  ];
                  const guideContent = (
                    <div style={{ padding: "16px 20px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: FONT }}>Commands</span>
                        <button onClick={() => setSlashGuideOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, fontSize: 18, color: C.sub }}>✕</button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {SLASH_COMMANDS.map(({ cmd, desc, action }) => (
                          <button
                            key={cmd}
                            onClick={() => { setSlashGuideOpen(false); action(); inputRef.current?.focus(); }}
                            style={{
                              display: "flex", alignItems: "baseline", gap: 10, padding: "10px 8px",
                              background: "none", border: "none", cursor: "pointer", textAlign: "left",
                              borderRadius: 8, transition: "background 0.15s", width: "100%",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = C.accentLight; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.accent, fontFamily: "'SF Mono', 'Fira Code', monospace", flexShrink: 0, width: 72 }}>{cmd}</span>
                            <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT }}>{desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                  if (isMobile) {
                    return (
                      <div onClick={() => setSlashGuideOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end" }}>
                        <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: "#fff", borderRadius: "16px 16px 0 0", overflow: "auto", WebkitOverflowScrolling: "touch", animation: "slideUp 0.25s ease-out" }}>
                          {guideContent}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <>
                      <div onClick={() => setSlashGuideOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 249 }} />
                      <div style={{
                        position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4, zIndex: 250,
                        background: "#fff", borderRadius: 12, border: `1.5px solid ${C.border}`,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.1)", animation: "fadeSlideDown 0.15s ease-out",
                      }}>
                        {guideContent}
                      </div>
                    </>
                  );
                })()}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Person detail panel (side drawer) */}
      {activePerson && (
        <PersonDetailPanel
          person={activePerson}
          isMobile={isMobile}
          onClose={handleClosePerson}
          noDim={welcomeRevealing}
          onAsk={(p, introTarget) => {
            handleClosePerson();
            triggerQuickAskForPerson(p, introTarget);
          }}
        />
      )}
      {/* Network Bin panel */}
      {networkBinOpen && (
        <NetworkBin
          isMobile={isMobile}
          people={networkPeople}
          onClose={() => setNetworkBinOpen(false)}
          onSelectPerson={p => {
            setNetworkBinOpen(false);
            setActivePerson(p);
            if (p?.id) fetchFullPerson(p.id, p).then(full => setActivePerson(full));
          }}
          onVouch={() => {
            setNetworkBinOpen(false);
            setSlashMode("vouch");
          }}
        />
      )}

      {/* Notifications / messages panel */}
      {notifPanelOpen && (
        <NotificationsPanel
          isMobile={isMobile}
          onClose={() => setNotifPanelOpen(false)}
          userId={user?.id}
        />
      )}

    </div>
  );
}
