-- VouchFour Migration 019: Voucher nudge improvements
-- 1. Adds {{networkCtaHtml}} slot — code-generated CTA linking to talent page
-- 2. Gmail compose URL detection handled in code (no template change needed)
-- 3. Softer button labels ("Draft a note to X →") handled in code
-- Run: psql -d vouchfour -f server/db/019-voucher-nudge-improvements.sql

UPDATE email_templates
SET body_html = '{{networkCtaHtml}}
    <div style="margin:0 0 24px;">
      {{inviteeStatusHtml}}
    </div>',
    available_vars = 'firstName,fullName,pendingCount,totalCount,completedCount,networkSize,inviteeStatusHtml,networkCtaHtml,talentUrl'
WHERE template_key = 'voucher_nudge';
