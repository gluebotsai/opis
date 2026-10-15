/**
 * Lightweight unit checks (run: npx tsx src/lib/email-body-quote.test.ts)
 */
import {
  extractHtmlDocument,
  prepareActivityEmailPreview,
  prepareEmailBodyForDisplay,
  readingPaneEmailParts,
  splitQuotedEmailHistory,
} from "./email-body";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sivajiReply = `Hi Sivaji,

Thank you for your question. Worktual offers an AI Native CRM platform designed to help businesses accelerate growth.

Best regards,
Worktual.
On Sat, 08 Aug 2026, 15:38, Sivaji R wrote: > which specific tool you provide to help my company in the sense of increase company growth`;

const split = splitQuotedEmailHistory(sivajiReply);
assert(split.quoted != null, "quote detected");
assert(
  /Sivaji R wrote/i.test(split.quoted ?? ""),
  "quoted block keeps attribution",
);
assert(
  !/which specific tool/i.test(split.main),
  "main reply does not include previous mail",
);
assert(/Worktual offers an AI Native CRM/i.test(split.main), "main keeps new reply");

const gmailHtml = `<div dir="ltr">Hi Sivaji,<br>Thanks for asking.<br>Best regards,<br>Worktual.</div>
<div class="gmail_quote"><div>On Sat, 8 Aug 2026 Sivaji R wrote:</div>
<blockquote>which specific tool you provide</blockquote></div>`;
const htmlSplit = splitQuotedEmailHistory(gmailHtml);
assert(htmlSplit.quoted != null, "html gmail_quote detected");
assert(
  !/which specific tool/i.test(htmlSplit.main),
  "html main does not include previous mail",
);

const noQuote = "Just a short note with no history.";
const plain = splitQuotedEmailHistory(noQuote);
assert(plain.quoted == null, "no false quote");
assert(plain.main.includes("short note"), "plain body unchanged");

const encodedGmail = `&lt;div dir="ltr"&gt;Hi Divya,&lt;br&gt;Thanks for the reply.&lt;/div&gt;
&lt;div class="gmail_quote"&gt;&lt;blockquote&gt;previous&lt;/blockquote&gt;&lt;/div&gt;`;
const prepared = prepareEmailBodyForDisplay(encodedGmail, "Re: welcome");
assert(prepared.mode === "html", "encoded HTML becomes html mode");
assert(
  !/&lt;div/i.test(prepared.content),
  "display content is decoded, not entity-escaped",
);
assert(/Hi Divya/i.test(prepared.content), "decoded body keeps message text");

const syncedTemplate = `From: Worktual <hello@worktual.com>
To: ashi@example.com
Cc: —

<!DOCTYPE html><html><body><img src="https://cdn.example/logo.png" alt="logo"><p>Following up</p></body></html>`;
const template = prepareEmailBodyForDisplay(syncedTemplate, "Following up");
assert(template.mode === "html", "synced HTML template stays html");

const offerHtml = `<!DOCTYPE html><html><body><table><tr><td><img src="https://cdn.example/logo.png" alt="WORKTUAL"><h1>Exclusive App Offer: 20% Off All Products</h1><p>Hi Ashika,</p><blockquote>App-exclusive benefit</blockquote></td></tr></table></body></html>`;
const pane = readingPaneEmailParts(offerHtml);
assert(pane.quoted == null, "designed html is not split into a quote");
assert(/<!DOCTYPE html>/i.test(pane.main), "inbox pane keeps the html document");
assert(/<img\b/i.test(pane.main), "inbox pane keeps the template image");
assert(/<blockquote\b/i.test(pane.main), "a template blockquote is not treated as reply history");
const displayed = prepareEmailBodyForDisplay(pane.main, "Exclusive App Offer");
assert(displayed.mode === "html", "inbox display uses the html iframe path");
assert(/Exclusive App Offer/i.test(displayed.content), "inbox html keeps the offer heading");

const paneReply = readingPaneEmailParts(sivajiReply);
assert(paneReply.quoted != null, "plain inbox replies still collapse quoted history");
assert(!/which specific tool/i.test(paneReply.main), "plain inbox main excludes the quote");
assert(!/^From:/i.test(template.content), "sync header is not part of the template");
assert(/<img\b/i.test(template.content), "template image tag is kept");
assert(
  extractHtmlDocument(syncedTemplate).startsWith("<!DOCTYPE html>"),
  "document starts at the doctype",
);

const activity = prepareActivityEmailPreview(gmailHtml, "Re: welcome");
assert(/Thanks for asking/i.test(activity.main), "activity main is latest reply");
assert(
  !/which specific tool/i.test(activity.main),
  "activity main excludes quoted history",
);
assert(activity.quoted != null, "activity keeps quoted separately");
assert(
  !/</.test(activity.main),
  "activity main is plain text without tags",
);

const mashed = `On Tue, 11 Aug 2026, 11:34, Divya Prasath wrote: > Great i am interested to buy your crm solution can u send the proposal and quotation > On Tue, 11 Aug 2026 at 11:12, Divya Prasath R S <divyaprasathrs@gmail.com> wrote: > > Tuesday, August 11, 2026 works for me`;
const mashedPreview = prepareActivityEmailPreview(mashed, "Re: welcome");
assert(
  /interested to buy your crm/i.test(mashedPreview.main),
  "mashed quote-only body peels first reply as main",
);
assert(
  !/No message body was logged/i.test(mashedPreview.main),
  "mashed body is not treated as empty",
);
assert(
  !/works for me/i.test(mashedPreview.main),
  "mashed main excludes older nested reply",
);
assert(mashedPreview.quoted != null, "mashed keeps older messages collapsed");

const nestedHtml = `<div dir="ltr">I am really disappointed i didn't receive any proposal or quotation</div>
<div class="gmail_quote"><div>On Tue, 11 Aug 2026 at 11:34, Divya Prasath R S wrote:</div>
<blockquote>Great i am interested<br>
<div class="gmail_quote"><blockquote>earlier meeting times</blockquote></div>
</blockquote></div>`;
const nestedPreview = prepareActivityEmailPreview(nestedHtml, "Re: welcome");
assert(
  /disappointed/i.test(nestedPreview.main),
  "nested html keeps latest reply as main",
);
assert(
  !/earlier meeting times/i.test(nestedPreview.main),
  "nested html main excludes deep history",
);
assert(
  !/</.test(nestedPreview.main),
  "nested html activity preview is plain text",
);

const onlyQuoteHtml = `<div class="gmail_quote"><div>On Tue, 11 Aug 2026, 11:34, Divya Prasath wrote:</div>
<blockquote>Great i am interested to buy your crm solution</blockquote></div>`;
const onlyQuote = prepareActivityEmailPreview(onlyQuoteHtml, "Re: welcome");
assert(
  /interested to buy/i.test(onlyQuote.main),
  "quote-only html peels message body, not attribution",
);
assert(
  !/^On\b/i.test(onlyQuote.main.trim()),
  "quote-only main is not attribution-only",
);

console.log("email-body-quote.test.ts ok");
