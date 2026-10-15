#!/usr/bin/env python3
"""Generate Worktual Product Compliance Pack PDF: Contact Centre x India (BA sample)."""

from pathlib import Path

from fpdf import FPDF

OUT = (
    Path(__file__).resolve().parent
    / "Worktual_Product_Compliance_Contact_Centre_India.pdf"
)


def ascii(text: str) -> str:
    repl = {
        "\u2014": "-",
        "\u2013": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2022": "-",
        "\u00a0": " ",
    }
    for a, b in repl.items():
        text = text.replace(a, b)
    return text


class PDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.set_x(self.l_margin)
        self.cell(
            0,
            6,
            ascii("Worktual Product Compliance Pack | Contact Centre | India | REF-IN-CC-001"),
            align="L",
        )
        self.ln(8)

    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(
            0,
            8,
            ascii(f"Page {self.page_no()}/{{nb}} | BA sample template | Not legal advice | Legal review required"),
            align="C",
        )

    def h1(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(15, 15, 15)
        self.multi_cell(0, 8, ascii(text))
        self.ln(2)

    def h2(self, text: str) -> None:
        self.ln(2)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 12)
        self.set_text_color(20, 20, 20)
        self.multi_cell(0, 6.5, ascii(text))
        self.ln(1)

    def h3(self, text: str) -> None:
        self.ln(1)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10.5)
        self.set_text_color(35, 35, 35)
        self.multi_cell(0, 5.5, ascii(text))
        self.ln(0.5)

    def body(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(25, 25, 25)
        self.multi_cell(0, 5, ascii(text))
        self.set_x(self.l_margin)
        self.ln(1.2)

    def bullet(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(25, 25, 25)
        self.cell(5, 5, "-")
        self.multi_cell(0, 5, ascii(text))
        self.set_x(self.l_margin)
        self.ln(0.3)

    def callout(self, title: str, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_fill_color(240, 240, 240)
        self.set_font("Helvetica", "B", 9.5)
        self.multi_cell(0, 5, ascii(title), fill=True)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 9.5)
        self.multi_cell(0, 5, ascii(text), fill=True)
        self.set_x(self.l_margin)
        self.ln(2)

    def kv_table(self, rows: list[tuple[str, str]], w1: float = 55, w2: float = 125) -> None:
        self.set_x(self.l_margin)
        for k, v in rows:
            y = self.get_y()
            if y > self.h - 25:
                self.add_page()
            self.set_font("Helvetica", "B", 8.5)
            x = self.l_margin
            k_lines = self.multi_cell(w1, 4.5, ascii(k), dry_run=True, output="LINES")
            v_lines = self.multi_cell(w2, 4.5, ascii(v), dry_run=True, output="LINES")
            h = max(len(k_lines), len(v_lines)) * 4.5 + 1
            self.set_xy(x, y)
            self.rect(x, y, w1, h)
            self.rect(x + w1, y, w2, h)
            self.set_xy(x, y)
            self.set_font("Helvetica", "B", 8.5)
            self.multi_cell(w1, 4.5, ascii(k))
            self.set_xy(x + w1, y)
            self.set_font("Helvetica", "", 8.5)
            self.multi_cell(w2, 4.5, ascii(v))
            self.set_xy(x, y + h)
        self.ln(2)

    def grid(self, headers: list[str], rows: list[list[str]], widths: list[float]) -> None:
        usable = self.w - self.l_margin - self.r_margin
        scale = usable / sum(widths)
        widths = [w * scale for w in widths]

        def header_row() -> None:
            self.set_x(self.l_margin)
            self.set_font("Helvetica", "B", 7.5)
            self.set_fill_color(225, 225, 225)
            for i, h in enumerate(headers):
                self.cell(widths[i], 6, ascii(h), border=1, fill=True)
            self.ln()

        header_row()
        self.set_font("Helvetica", "", 7.2)
        for row in rows:
            counts = []
            for i, cell in enumerate(row):
                lines = self.multi_cell(widths[i], 3.8, ascii(cell), dry_run=True, output="LINES")
                counts.append(max(1, len(lines)))
            rh = max(counts) * 3.8 + 1.2
            if self.get_y() + rh > self.h - 18:
                self.add_page()
                header_row()
                self.set_font("Helvetica", "", 7.2)
            x0 = self.l_margin
            y0 = self.get_y()
            for i, cell in enumerate(row):
                self.set_xy(x0 + sum(widths[:i]), y0)
                self.rect(x0 + sum(widths[:i]), y0, widths[i], rh)
                self.multi_cell(widths[i], 3.8, ascii(cell))
            self.set_xy(x0, y0 + rh)
        self.set_x(self.l_margin)
        self.ln(2)


def build() -> None:
    pdf = PDF(format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()

    # Cover
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(80, 80, 80)
    pdf.multi_cell(0, 6, ascii("WORKTUAL COMPLIANCE KNOWLEDGE LAYER"))
    pdf.set_x(pdf.l_margin)
    pdf.ln(2)
    pdf.h1("Product Compliance Pack (BA SAMPLE)")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 7, ascii("Product: Contact Centre / CCaaS"))
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 7, ascii("Country: India"))
    pdf.set_x(pdf.l_margin)
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5.5,
        ascii(
            "Sample pack (REF-IN-CC-001) for BA teams. Use this exact structure when converting "
            "research workbooks into Worktual Knowledge Layer source packs. "
            "Do not mix other countries or product spokes into this file."
        ),
    )
    pdf.set_x(pdf.l_margin)
    pdf.ln(2)

    pdf.kv_table(
        [
            ("Document ID", "REF-IN-CC-001"),
            ("Product", "AI Contact Centre / CCaaS"),
            ("Country / Region", "India (IN)"),
            ("Primary regimes", "DPDP Act 2023 + Rules (as notified/commenced); TRAI TCCCPR 2018 and commercial communication controls; IT Act where applicable"),
            ("Audience", "BA, Legal/Compliance, Product, Compliance Engineering"),
            ("Version", "1.0 | 2026-09-01"),
            ("Status", "SAMPLE FOR BA PATTERNING - Legal review mandatory before activation"),
            ("Replication rule", "One pack = one Product x one Country (+ optional enterprise overlay)"),
        ]
    )

    pdf.callout(
        "BA instruction",
        "Keep section order unchanged. Replace only India/Contact Centre content when cloning "
        "for other packs (example: REF-IN-CRM-001, REF-UK-CC-001). Every obligation needs ID, "
        "condition, severity, Worktual agent mapping, verification check, and primary source.",
    )

    pdf.h2("1. Purpose")
    pdf.body(
        "This pack defines India Contact Centre obligations for Worktual agents and tools so "
        "rules are retrieved from the Compliance Knowledge Layer at runtime instead of being "
        "hardcoded in prompts."
    )
    pdf.bullet("Separate TRAI communication rules from DPDP personal-data processing rules")
    pdf.bullet("Map each obligation to Contact Centre agents and verification tools")
    pdf.bullet("Provide ALLOW / REVIEW / BLOCK outcomes for runtime enforcement")
    pdf.bullet("Serve as the BA template for all other Product x Country packs")

    pdf.h2("2. Important India principle for Contact Centre")
    pdf.callout(
        "Two frameworks, two jobs",
        "TRAI commercial-communication rules govern whether/how a call or SMS may be placed "
        "(registration, preference/DND, consent category, timing). "
        "DPDP governs processing of personal data created by the interaction "
        "(recording, transcript, identity, retention, purpose limitation, rights). "
        "Both may apply to the same call. Do not collapse them into one generic 'consent' row.",
    )

    pdf.h2("3. Authoritative sources (attach originals)")
    pdf.grid(
        ["Source", "Publisher", "Use for", "Reference"],
        [
            [
                "Digital Personal Data Protection Act, 2023",
                "MeitY / India Code",
                "Notice, consent, purpose, retention, rights, fiduciary duties",
                "meity.gov.in / India Code",
            ],
            [
                "DPDP Rules (as notified / commenced)",
                "MeitY",
                "Operational notice/consent/security/retention detail",
                "MeitY notifications",
            ],
            [
                "TCCCPR 2018 (+ amendments)",
                "TRAI",
                "Commercial calls/SMS, preference, headers/templates, UCC controls",
                "trai.gov.in",
            ],
            [
                "DND / preference / scrubbing process",
                "TRAI / TSP / DLT ecosystem",
                "Outbound list scrubbing evidence",
                "Operator/DLT process docs",
            ],
            [
                "Enterprise Contact Centre Policy",
                "Tenant / Enterprise",
                "IVR disclosure script, retention, auth, handoff SOP",
                "Attach internal PDF",
            ],
        ],
        [42, 28, 55, 45],
    )
    pdf.body(
        "BA must record access date and commencement note. DPDP obligations should be tagged "
        "with effective/commencement status confirmed by Legal."
    )

    pdf.h2("4. Scope - Contact Centre India")
    pdf.h3("4.1 In scope")
    pdf.kv_table(
        [
            ("Channels", "Inbound voice, outbound live/automated voice, SMS linked to CC journeys, webchat, email support, agent assist"),
            ("Data", "Identity, phone/email, recordings, transcripts, notes, dispositions, consent logs, DND scrub logs"),
            ("Agents", "Contact Centre Super Agent, AI Support, Agent Assist, Interaction Closure, Outbound/Audience"),
            ("Actions", "Answer, record, authenticate, handoff, suppress/opt-out, dial, disposition, store evidence"),
        ]
    )
    pdf.h3("4.2 Out of scope (separate packs)")
    pdf.bullet("Banking collections deep overlay (RBI FPC) - industry overlay pack")
    pdf.bullet("Insurance advice / IRDAI deep overlay - industry overlay pack")
    pdf.bullet("UK/EU Contact Centre packs - separate country packs")
    pdf.bullet("Campaign email-only PECR-style packs for other countries")

    pdf.h3("4.3 Applicability triggers")
    pdf.bullet("Customer / data principal is in India")
    pdf.bullet("Outbound campaign targets Indian telephone numbers")
    pdf.bullet("Contact centre processing digital personal data under DPDP")
    pdf.bullet("Commercial communication subject to TRAI preference/UCC framework")
    pdf.body("Do not apply India rules only because the agent language is English or Hindi.")

    # Obligations
    pdf.add_page()
    pdf.h2("5. Obligation inventory (required format)")
    pdf.body(
        "Severity: Blocking = stop action; Approval = human gate; Guidance = instruct agent; "
        "Evidence = retain proof."
    )

    pdf.h3("5.1 Recording, notice and DPDP processing")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "IN-CC-REC-01",
                "Provide clear notice of recording purpose before/at start of recording",
                "Call recording on",
                "Blocking",
                "Disclosure played/logged with purpose code",
            ],
            [
                "IN-CC-REC-02",
                "Capture purpose-specific consent/affirmation for recording where consent is the basis; do not bundle unrelated purposes",
                "Recording / transcript processing",
                "Blocking",
                "Consent record: purpose, timestamp, channel, actor",
            ],
            [
                "IN-CC-REC-03",
                "Do not reuse recording/transcript for a new purpose (e.g. model training/marketing) without valid basis and notice",
                "Secondary use",
                "Blocking",
                "Purpose check on reuse tools",
            ],
            [
                "IN-CC-REC-04",
                "Retain recordings only for stated purpose period; delete/anonymise when purpose ends (enterprise schedule)",
                "Stored media",
                "Blocking",
                "Retention policy ID + deletion job evidence",
            ],
            [
                "IN-CC-REC-05",
                "Support data principal rights workflows (access/correction/erasure as applicable) for interaction data",
                "Rights request",
                "Approval",
                "Rights-request ticket + completion evidence",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.h3("5.2 Outbound commercial communication (TRAI)")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "IN-CC-TEL-01",
                "Classify communication (service/transactional vs promotional) before dial/SMS",
                "Outbound CC campaign",
                "Blocking",
                "Category field required",
            ],
            [
                "IN-CC-TEL-02",
                "Scrub destination numbers against current DND/preference and enterprise suppression lists before promotional/commercial dial",
                "Outbound promotional/commercial",
                "Blocking",
                "Scrub result PASS + timestamp",
            ],
            [
                "IN-CC-TEL-03",
                "Do not place promotional calls/SMS without recorded prior consent/preference evidence",
                "Promotional outreach",
                "Blocking",
                "Consent/preference reference present",
            ],
            [
                "IN-CC-TEL-04",
                "Enforce permitted calling-hour window for commercial calls (enterprise may be stricter than 09:00-21:00 local)",
                "Outbound commercial call",
                "Blocking",
                "Local-time window check",
            ],
            [
                "IN-CC-TEL-05",
                "For SMS/content templates in commercial journeys, ensure required entity/header/template registration evidence exists",
                "Commercial SMS linked to CC",
                "Blocking",
                "DLT/header/template IDs present",
            ],
            [
                "IN-CC-TEL-06",
                "Honour opt-out / preference change immediately and propagate to linked channels",
                "Opt-out received",
                "Blocking",
                "Suppression write + cross-channel sync",
            ],
            [
                "IN-CC-TEL-07",
                "Log outbound attempt with category, consent/scrub refs, CLI/header, and outcome for audit",
                "Any commercial outbound",
                "Evidence",
                "Audit record completeness check",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.h3("5.3 Inbound service / AI Contact Centre operations")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "IN-CC-SVC-01",
                "Use customer data only for stated service purpose",
                "Support interaction",
                "Blocking",
                "Purpose tag on tools",
            ],
            [
                "IN-CC-SVC-02",
                "Authenticate before disclosing account-sensitive information",
                "Sensitive enquiry",
                "Blocking",
                "Auth step completed",
            ],
            [
                "IN-CC-SVC-03",
                "On explicit live-agent request, hand off and stop bot deflection loops",
                "Human requested",
                "Blocking",
                "Handoff tool called",
            ],
            [
                "IN-CC-SVC-04",
                "Disclose AI nature at interaction start where enterprise/policy requires, and whenever asked",
                "Bot/voice AI interaction",
                "Mixed",
                "AI-disclosure event logged",
            ],
            [
                "IN-CC-SVC-05",
                "Mask payment secrets (OTP/PIN/CVV) and pause recording where PCI/enterprise policy requires",
                "Payment capture on call",
                "Blocking",
                "Pause/mask control active",
            ],
            [
                "IN-CC-SVC-06",
                "Do not make regulated decisions autonomously (credit decline, KYC determination, claims adjudication)",
                "High-risk request",
                "Blocking",
                "Decision-type classifier + human route",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.h3("5.4 Evidence and audit")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "IN-CC-AUD-01",
                "Retain scrub, consent, disclosure, auth, approval, and opt-out evidence for high-risk actions",
                "High-risk actions",
                "Blocking",
                "Evidence IDs in decision log",
            ],
            [
                "IN-CC-AUD-02",
                "Store policy-pack version used at decision time",
                "Any compliance decision",
                "Blocking",
                "decision.policySetVersion present",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.add_page()
    pdf.h2("6. Mapping to Worktual Contact Centre agents")
    pdf.grid(
        ["Agent / capability", "Must load", "Typical tools"],
        [
            ["Contact Centre Super Agent", "All applicable IN-CC-* for action", "Policy resolve, decision token"],
            ["AI Support Agent", "REC-01..03, SVC-01..04", "Disclosure, purpose, auth, handoff"],
            ["Agent Assist / Coworker", "SVC-02, SVC-05", "Auth gate, PCI mask/pause"],
            ["Interaction Closure", "SVC-06, TEL-06", "Disposition confirm, suppress"],
            ["Audience / Outbound Campaign", "TEL-01..07, AUD-*", "Category, DND scrub, consent, window, DLT"],
            ["Recording / QA workflows", "REC-01..05, AUD-*", "Notice, consent, retention, rights"],
        ],
        [50, 55, 75],
    )

    pdf.h2("7. Runtime decision model")
    pdf.bullet("1. Resolve packs: country=IN + product=contact_centre + enterprise overlay")
    pdf.bullet("2. Return only task-relevant obligations")
    pdf.bullet("3. Agent prepares action using guidance")
    pdf.bullet("4. Verification tools evaluate Blocking/Approval checks")
    pdf.bullet("5. Outcome: Allow / Approve / Block")
    pdf.bullet("6. Write audit evidence with policy version")

    pdf.h3("7.1 Example A - India promotional outbound call")
    pdf.body(
        "Campaign classifies call as promotional -> scrub DND/preference + enterprise DNC -> "
        "validate prior consent -> enforce calling-hour window -> dial with compliant identity -> "
        "if customer opts out, suppress across channels -> store scrub/consent/outcome evidence."
    )
    pdf.h3("7.2 Example B - India inbound recorded support call")
    pdf.body(
        "Recording enabled -> purpose notice played -> consent/affirmation captured if required -> "
        "AI Support serves with purpose limitation -> sensitive disclosure requires auth -> "
        "payment capture pauses recording/masks secrets -> live-agent request triggers handoff -> "
        "retention schedule applied to recording/transcript."
    )

    pdf.h2("8. Standard verification outcomes")
    pdf.grid(
        ["Failed check", "System outcome"],
        [
            ["Promotional dial without scrub PASS", "Block outbound call"],
            ["Promotional dial without consent/preference evidence", "Block"],
            ["Outside permitted calling hours", "Block or schedule later"],
            ["Recording on without purpose disclosure", "Block recording start or require approval"],
            ["Secondary use of transcript without basis", "Block"],
            ["Opt-out present", "Block and suppress"],
            ["Sensitive disclosure without authentication", "Block"],
            ["Missing evidence for high-risk action", "Block"],
        ],
        [95, 85],
    )

    pdf.h2("9. Open questions for Legal/Compliance")
    pdf.bullet("Which DPDP Act/Rules provisions are in force for this tenant go-live date?")
    pdf.bullet("Is recording based on consent, legitimate use, or contract for service calls?")
    pdf.bullet("Exact IVR disclosure wording and language variants (EN/HI/others)?")
    pdf.bullet("Enterprise calling-hour window and frequency caps?")
    pdf.bullet("Which commercial categories require DLT header/template evidence in this deployment?")
    pdf.bullet("Retention periods for recordings, transcripts, AI summaries, scrub logs?")
    pdf.bullet("Are BFSI/insurance overlays required for this tenant?")

    pdf.h2("10. Attachment checklist")
    pdf.bullet("[ ] DPDP Act text / Legal summary with commencement notes")
    pdf.bullet("[ ] DPDP Rules notification (as applicable) with access date")
    pdf.bullet("[ ] TRAI TCCCPR 2018 (+ amendments) extract")
    pdf.bullet("[ ] DND/preference scrub SOP + sample evidence")
    pdf.bullet("[ ] DLT/entity/header/template registration evidence (if SMS in scope)")
    pdf.bullet("[ ] Enterprise Contact Centre Privacy / Recording Policy")
    pdf.bullet("[ ] Sample IVR disclosure + opt-out scripts")
    pdf.bullet("[ ] Retention and deletion SOP")

    pdf.h2("11. Handoff to Compliance Knowledge Layer")
    pdf.body("After Legal approval, Compliance Engineering converts each obligation into:")
    pdf.bullet("Structured metadata (country=IN, product=contact_centre)")
    pdf.bullet("Machine-evaluable controls")
    pdf.bullet("Agent/tool mappings")
    pdf.bullet("Verification checks")
    pdf.bullet("Citations to this pack and official sources")
    pdf.bullet("Versioned publication with auditability")
    pdf.callout(
        "Activation rule",
        "Until Legal marks this pack Approved, Worktual agents must not treat these obligations as live policy.",
    )

    pdf.h2("12. What BA must change vs the previous mega workbook")
    pdf.bullet("Split into Product x Country packs (this format), not one all-country PDF")
    pdf.bullet("Remove non-India laws from India sections (no TCPA/HIPAA/CCPA leakage)")
    pdf.bullet("Add stable obligation IDs and verification checks")
    pdf.bullet("Map every Blocking rule to a Worktual agent/tool")
    pdf.bullet("Attach primary sources with access dates")
    pdf.bullet("Add Legal approval block and enterprise overlay pack")

    pdf.ln(2)
    pdf.body(
        "Document control: REF-IN-CC-001 v1.0 | Worktual Product Compliance Pack (BA Sample) | "
        "Not legal advice. Confirm commencement and interpretation with Legal before production use."
    )

    pdf.output(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
