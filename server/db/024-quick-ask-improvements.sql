-- 024: Quick Ask improvements
-- 1. Add knows_recipient flag to suppress vouch chain in email
-- 2. Update email template: remove mailto, use reply-on-site CTA, make connection section conditional

ALTER TABLE quick_ask_recipients ADD COLUMN IF NOT EXISTS knows_recipient BOOLEAN DEFAULT false;

-- Update the quick_ask email template
UPDATE email_templates SET body_html = '<p style="font-size:16px;color:#1C1917;line-height:1.6;margin:0 0 8px;">
  Hi {{recipientFirstName}},
</p>
<p style="font-size:15px;color:#44403C;line-height:1.6;margin:0 0 16px;">
  <strong>{{senderName}}</strong> is reaching out through VouchFour — a professional network built on trusted recommendations from highly regarded colleagues.
</p>
{{connectionSection}}
<div style="margin:16px 0;padding:16px 20px;background:#FFFFFF;border:1.5px solid #E7E5E0;border-radius:12px;">
  <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
    Message from {{senderFirstName}}
  </div>
  <div style="font-size:15px;color:#1C1917;line-height:1.6;">
    {{messageBody}}
  </div>
</div>
<div style="margin:20px 0;">
  <a href="{{replyUrl}}" style="display:inline-block;padding:10px 24px;background:#4F46E5;color:#FFFFFF;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Reply to {{senderFirstName}} on VouchFour</a>
</div>'
WHERE template_key = 'quick_ask';
