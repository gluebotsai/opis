import { htmlToPlainText } from "@/lib/email-body";

export type OutboundEmailValidationResult =
  | { ok: true }
  | { ok: false; error: string };

const PLACEHOLDER_BODY_PATTERNS: RegExp[] = [
  /^this is the (?:email )?body(?: content)?\.?$/i,
  /^body content\.?$/i,
  /^email body\.?$/i,
  /^message body\.?$/i,
  /^sample (?:email )?(?:body|message|text)\.?$/i,
  /^test(?:ing)?(?: email| message)?\.?$/i,
  /^placeholder(?: text| content| body)?\.?$/i,
  /^lorem ipsum\b/i,
  /^enter (?:your )?(?:message|body|text) here\.?$/i,
  /^type (?:your )?(?:message|body) here\.?$/i,
  /^\[(?:your )?(?:message|body|email|content)\]$/i,
  /^\{\{(?:body|message|content)\}\}$/i,
  /^\(no message body\)\.?$/i,
  /^your message here\.?$/i,
  /^write (?:your )?message here\.?$/i,
];

function plainBodyForCheck(body: string): string {
  return htmlToPlainText(body).replace(/\s+/g, " ").trim();
}

export function validateOutboundEmailContent(args: {
  subject: string;
  body: string;
}): OutboundEmailValidationResult {
  const subject = args.subject.trim();
  const plainBody = plainBodyForCheck(args.body);

  if (!plainBody) {
    return {
      ok: false,
      error:
        "Message body is empty. Write your email content before sending.",
    };
  }

  for (const pattern of PLACEHOLDER_BODY_PATTERNS) {
    if (pattern.test(plainBody)) {
      return {
        ok: false,
        error:
          "Message looks like placeholder text. Replace it with your actual email before sending.",
      };
    }
  }

  if (/^introduction\.?$/i.test(subject) && plainBody.length < 120) {
    if (
      /body|content|placeholder|sample|test|lorem/i.test(plainBody) &&
      plainBody.split(/\s+/).length <= 8
    ) {
      return {
        ok: false,
        error:
          "Subject and body look like API example text. Write a real introduction before sending.",
      };
    }
  }

  return { ok: true };
}
