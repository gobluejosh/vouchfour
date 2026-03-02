-- VouchFour Migration 015: Swap Nudge Email Templates
-- New nudge_1 = reciprocity angle (inviter is counting on your recs)
-- New nudge_2 = FOMO angle (network is growing, don't miss out — formerly nudge_1)
-- Run: psql -d vouchfour -f server/db/015-swap-nudge-templates.sql

-- ─── Update nudge_1: reciprocity / counting-on-you angle ───────────────
UPDATE email_templates
SET subject   = '{{inviterFirstName}} is counting on your recommendations',
    body_html = '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      <strong>{{inviterFullName}}</strong> vouched for you as one of the
      <strong>best {{practitionerLabel}}</strong> they''ve ever worked with. Since then,
      they''ve received <strong>{{recommendationCount}} recommendations</strong> for top
      {{practitionerLabel}} from others in their network — and they''re counting on
      yours too.
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      When you share your picks, you''ll get access to
      <strong>{{networkSize}}+ people</strong> in {{inviterFirstName}}''s cross-functional
      trusted network — a curated group built entirely on real professional vouches.
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Share Your Picks</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      It only takes a couple minutes.
    </p>',
    available_vars = 'firstName,inviterFirstName,inviterFullName,jobFunction,jobFunctionShort,practitionerLabel,vouchUrl,networkSize,recommendationCount,daysSinceInvite'
WHERE template_key = 'nudge_1';

-- ─── Update nudge_2: FOMO / network-growing angle (was nudge_1) ────────
UPDATE email_templates
SET subject   = '{{inviterFirstName}}''s network is growing — don''t miss out',
    body_html = '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
      Hi {{firstName}},
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      {{daysSinceInvite}} days ago, <strong>{{inviterFullName}}</strong> vouched for you as one of the
      <strong>best {{practitionerLabel}}</strong> they''ve ever worked with.
    </p>
    <p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
      Since then, a network of <strong>{{networkSize}}+ trusted professionals</strong> has formed
      around {{inviterFirstName}}''s vouches. When you share your picks, you''ll get to
      see who everyone else is recommending too.
    </p>
    <div style="margin:24px 0;">
      <a href="{{vouchUrl}}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#FFFFFF;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Share Your Picks</a>
    </div>
    <p style="font-size:13px;color:#78716C;line-height:1.5;margin:0;">
      It only takes a couple minutes. Don''t miss out.
    </p>',
    available_vars = 'firstName,inviterFirstName,inviterFullName,jobFunction,jobFunctionShort,practitionerLabel,vouchUrl,networkSize,recommendationCount,daysSinceInvite'
WHERE template_key = 'nudge_2';
