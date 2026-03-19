/**
 * REFERENCE ONLY — not imported anywhere.
 *
 * Preserved onboarding v2 "Gives" logic (mirror synthesis + confirm-gives flow).
 * This was the conversational flow where Brain:
 *   1. Synthesized what a user uniquely brings to their network (mirror)
 *   2. Suggested 3-6 expertise "gives" labels
 *   3. Let user confirm/modify
 *   4. Saved final gives to people.gives_free_text
 *
 * Removed from active code 2026-03-18 when onboarding v2 was replaced
 * with one-shot starter prompts. Kept here for future reuse.
 */

// ── Mirror synthesis prompt ──
// Used after 2-3 orientation exchanges to synthesize the user's unique value.
// Input: profileContext, careerTimeline, aiSummary, conversation history
// Output: conversational message + [[GIVES:label1|label2|...]] tag

const mirrorPrompt = `Based on the conversation below and this person's career data, synthesize what they uniquely bring to a professional network. Write this as a CONVERSATIONAL message — you are the Brain talking to this person directly.

ABOUT THIS PERSON:
{profileContext}

CAREER HISTORY:
{careerTimeline}

AI SUMMARY:
{aiSummary}

CONVERSATION (their own words about what they do and know):
{fullConversation}

Write a warm, conversational message that:
1. Opens by briefly acknowledging what they just shared in their most recent answer (1 sentence — warm, specific, not generic)
2. Transitions into a "here's what I'm taking away" mirror (2-3 sentences synthesizing what they uniquely bring, referencing specific things they said)
3. Then says something like "Based on all of this, here are some ways I think you could help others in your network:"
4. Lists 3-6 specific expertise areas as a simple bulleted list using • bullets. Each should be SPECIFIC to their experience (e.g., "Navigating M&A integration", "Scaling product teams from 10 to 50"), NOT generic categories like "advice" or "mentoring".
5. Ends by asking them to confirm: "Do these feel right? Feel free to tell me if you'd add, remove, or change any of them."
6. After your message, on a new line, output EXACTLY: [[GIVES:label1|label2|label3]] with the short labels matching your bullets, separated by pipes. This line will be stripped and not shown to the user.

RESPONSE FORMAT: Plain conversational text, with the [[GIVES:...]] tag on the last line.`

// ── Confirm gives + finalize ──
// After user confirms/modifies, two-step process:
//   Step 1: Non-streamed Claude call to determine final gives list
//   Step 2: Save to DB as semicolon-separated string

const givesPrompt = `The user was shown these suggested expertise areas ("gives"):
{originalGives as bullets}

The user responded: "{userResponse}"

Return the FINAL list. Use EXACT label text — do NOT rephrase. If user said "looks good"/"yes", keep all unchanged. If they asked to change items, apply ONLY those changes.

RESPONSE FORMAT (JSON only, no markdown fences):
{ "final_gives": ["label1", "label2", ...] }`

// ── Extraction patterns ──
// Mirror: const givesMatch = fullText.match(/\[\[GIVES:(.*?)\]\]/)
//         const givesLabels = givesMatch[1].split('|').map(s => s.trim()).filter(Boolean)
// Confirm: JSON.parse(response) → { final_gives: [...] }
// Save:    await query('UPDATE people SET gives_free_text = $1 WHERE id = $2', [finalGives.join('; '), userId])
