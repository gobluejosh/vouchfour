// ─── Deterministic avatar styling ────────────────────────────────────────────
// Generates a unique gradient background from a person's name.
// Used across all components for consistent avatar rendering.

const GRADIENT_PAIRS = [
  ["#F97316", "#EF4444"], // orange → red
  ["#06B6D4", "#3B82F6"], // cyan → blue
  ["#8B5CF6", "#EC4899"], // violet → pink
  ["#10B981", "#06B6D4"], // emerald → cyan
  ["#F59E0B", "#F97316"], // amber → orange
  ["#6366F1", "#8B5CF6"], // indigo → violet
  ["#14B8A6", "#10B981"], // teal → emerald
  ["#E11D48", "#F97316"], // rose → orange
  ["#3B82F6", "#6366F1"], // blue → indigo
  ["#84CC16", "#10B981"], // lime → emerald
];

function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Returns the CSS background gradient string for a given name.
 * Deterministic — same name always produces the same gradient.
 */
export function gradientForName(name) {
  const h = hashName(name);
  const pair = GRADIENT_PAIRS[h % GRADIENT_PAIRS.length];
  const angle = (h % 6) * 60 + 15;
  return `linear-gradient(${angle}deg, ${pair[0]}, ${pair[1]})`;
}

/**
 * Returns the initials for a given name (max 2 characters).
 */
export function initialsForName(name) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
