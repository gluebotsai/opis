#!/usr/bin/env python3
"""Generate Worktual Product Compliance Pack PDF: Contact Centre x United Kingdom."""

from pathlib import Path

from fpdf import FPDF

OUT = (
    Path(__file__).resolve().parent
    / "Worktual_Product_Compliance_Contact_Centre_United_Kingdom.pdf"
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
            ascii("Worktual Product Compliance Pack | Contact Centre | United Kingdom | REF-UK-CC-001"),
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
            ascii(f"Page {self.page_no()}/{{nb}} | Template for all products x countries | Not legal advice"),
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
            self.set_fill_color(245, 245, 245)
            x = self.l_margin
            # measure
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
    pdf.h1("Product Compliance Pack")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 7, ascii("Product: Contact Centre"))
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 7, ascii("Country: United Kingdom"))
    pdf.set_x(pdf.l_margin)
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5.5,
        ascii(
            "Reference pack (REF-UK-CC-001). Use this document as the standard format "
            "to prepare compliance packs for every other Worktual product and country."
        ),
    )
    pdf.set_x(pdf.l_margin)
    pdf.ln(2)
    pdf.kv_table(
        [
            ("Document ID", "REF-UK-CC-001"),
            ("Product", "AI Contact Centre / Contact Centre Operations"),
            ("Country / Region", "United Kingdom (GB)"),
            ("Related regimes", "UK GDPR, DPA 2018, PECR (as amended), ICO guidance"),
            ("Audience", "BA, Legal/Compliance, Product, Compliance Engineering"),
            ("Version", "1.0 | 2026-09-01"),
            ("Status", "REFERENCE TEMPLATE - Legal review required before activation"),
            ("Replication rule", "One pack per Product x Country (plus Enterprise overlay if needed)"),
        ]
    )
    pdf.callout(
        "How teams should use this pack",
        "1) Keep this structure unchanged. 2) Replace country/product content. "
        "3) Attach primary sources. 4) Get Legal approval. 5) Engineering publishes "
        "approved obligations into the Compliance Knowledge Layer for runtime agent use.",
    )

    # 1 Purpose
    pdf.h2("1. Purpose")
    pdf.body(
        "This pack defines the compliance obligations that Worktual Contact Centre "
        "agents and tools must follow for United Kingdom operations. It is the source "
        "input for the Compliance Knowledge Layer so rules are not hardcoded in prompts."
    )
    pdf.bullet("Country + Product scoped (not a global dump of all laws)")
    pdf.bullet("Structured obligations mapped to Contact Centre agents and actions")
    pdf.bullet("Verification ideas for tool-based enforcement")
    pdf.bullet("Reusable template for CRM, Ticketing, Campaigns, Web Tracking, and other countries")

    # 2 How to replicate
    pdf.h2("2. Replication standard for all products and countries")
    pdf.body("Every future pack must use the same skeleton:")
    pdf.grid(
        ["Section", "Required content"],
        [
            ["Cover metadata", "Product, country, regimes, version, owner, status"],
            ["Sources", "Primary regulator/law/enterprise sources with URL and access date"],
            ["Scope", "Channels, data, agents, actions in/out of scope"],
            ["Applicability", "When the pack applies (subject location, processing location, etc.)"],
            ["Obligation inventory", "One row per rule with ID, severity, mapping, verification"],
            ["Agent mapping", "Which Worktual agents load which obligations"],
            ["Runtime scenarios", "2-3 example flows for BA/Legal validation"],
            ["Open questions", "Items only Legal can decide"],
            ["Attachments", "Original PDFs/exports"],
        ],
        [40, 140],
    )
    pdf.body(
        "Suggested ID pattern: REF-<COUNTRY>-<PRODUCT>-<NNN> "
        "Examples: REF-IN-CC-001 (India Contact Centre), REF-UK-CRM-001 (UK CRM), "
        "REF-IN-CAMP-001 (India Campaigns)."
    )

    # 3 Sources
    pdf.h2("3. Authoritative sources (UK Contact Centre)")
    pdf.grid(
        ["Source", "Publisher", "Use for", "Reference"],
        [
            [
                "Telephone marketing (PECR)",
                "ICO",
                "Live/automated marketing calls, TPS/CTPS, CLI",
                "ico.org.uk .../telephone-marketing/",
            ],
            [
                "Live marketing calls guidance",
                "ICO",
                "Screening, objections, claims/pensions special cases",
                "ico.org.uk .../guidance-on-direct-marketing-using-live-calls/",
            ],
            [
                "Choosing lawful basis for direct marketing",
                "ICO",
                "When PECR forces consent vs legitimate interests",
                "ico.org.uk .../sending-direct-marketing-choosing-your-lawful-basis/",
            ],
            [
                "Legitimate interests guidance",
                "ICO",
                "LIA; helpline recording for training example",
                "ico.org.uk .../legitimate-interests/",
            ],
            [
                "Enterprise Contact Centre Policy",
                "Enterprise",
                "Retention, disclosure script, auth, handoff SOPs",
                "Attach internal policy PDF",
            ],
        ],
        [42, 22, 55, 55],
    )
    pdf.callout(
        "BA note",
        "ICO has marked some PECR guidance as under review due to Data (Use and Access) Act changes. "
        "Always record access date and ask Legal to confirm current interpretation before activation.",
    )

    # 4 Scope
    pdf.add_page()
    pdf.h2("4. Product scope - Contact Centre")
    pdf.h3("4.1 In scope")
    pdf.kv_table(
        [
            ("Channels", "Inbound voice, outbound live/automated voice, webchat, email support, agent assist"),
            ("Data", "Identity, phone/email, recordings, transcripts, notes, dispositions, queue metrics"),
            ("Agents", "Contact Centre Super Agent, AI Support, Agent Assist, Interaction Closure, Outbound/Audience"),
            ("Actions", "Answer, record, authenticate, handoff, suppress, dial, disposition, store evidence"),
        ]
    )
    pdf.h3("4.2 Out of scope (separate packs)")
    pdf.bullet("Regulated financial advice scripts (FCA) - separate industry overlay")
    pdf.bullet("Healthcare special-category deep controls - separate industry overlay")
    pdf.bullet("India DPDP/TRAI Contact Centre pack - separate country pack")
    pdf.bullet("EU GDPR Contact Centre pack - separate country/region pack")

    pdf.h3("4.3 Applicability triggers")
    pdf.body("Load this UK Contact Centre pack when any approved trigger is true:")
    pdf.bullet("Data subject / customer is in the UK")
    pdf.bullet("Campaign targets UK telephone numbers")
    pdf.bullet("Contact centre operations are UK-established / UK-processing")
    pdf.bullet("Recording/transcript processing is governed by UK data protection law")
    pdf.body("Do not apply this pack only because the user interface language is English.")

    # 5 Obligation inventory
    pdf.h2("5. Obligation inventory")
    pdf.body(
        "Severity: Blocking = stop action; Approval = human gate; Guidance = instruct agent; "
        "Evidence = retain proof."
    )

    pdf.h3("5.1 Call recording and transparency")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "UK-CC-REC-01",
                "Tell caller recording may occur and why, early enough to understand",
                "Recording/monitoring on",
                "Blocking",
                "Disclosure played/logged before record start",
            ],
            [
                "UK-CC-REC-02",
                "Document lawful basis for recording (often LI after LIA; or consent/legal obligation)",
                "Recording enabled",
                "Blocking",
                "Lawful-basis + LIA/consent reference present",
            ],
            [
                "UK-CC-REC-03",
                "Do not reuse recordings/transcripts for new purposes (e.g. marketing) without fresh basis",
                "Secondary use",
                "Blocking",
                "Purpose check on reuse tools",
            ],
            [
                "UK-CC-REC-04",
                "Apply approved retention/deletion to recordings and transcripts",
                "Stored media",
                "Blocking",
                "Retention policy ID attached",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.h3("5.2 Outbound telephone marketing (PECR)")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "UK-CC-TEL-01",
                "Do not live-call TPS/CTPS numbers unless specific consent for your calls",
                "Live marketing call",
                "Blocking",
                "TPS/CTPS screen PASS or consent evidence",
            ],
            [
                "UK-CC-TEL-02",
                "Screen against organisation do-not-call / prior objections",
                "Any marketing call",
                "Blocking",
                "DNC/objection registry check",
            ],
            [
                "UK-CC-TEL-03",
                "Display calling line identity (do not withhold number)",
                "Marketing call",
                "Blocking",
                "CLI presentation enabled",
            ],
            [
                "UK-CC-TEL-04",
                "Identify organisation; provide address/Freephone if asked",
                "Live marketing call",
                "Mixed",
                "Script/disclosure component present",
            ],
            [
                "UK-CC-TEL-05",
                "No automated marketing calls without specific automated-call consent",
                "Automated outbound",
                "Blocking",
                "Consent scope includes automated_calls",
            ],
            [
                "UK-CC-TEL-06",
                "General or live-call consent is not enough for automated calls",
                "Automated outbound",
                "Blocking",
                "Consent type validation",
            ],
            [
                "UK-CC-TEL-07",
                "Claims-management marketing calls require specific consent",
                "Claims marketing",
                "Blocking",
                "Sector flag + consent",
            ],
            [
                "UK-CC-TEL-08",
                "Pension marketing calls only if PECR authorisation/relationship criteria met",
                "Pension marketing",
                "Approval+Block",
                "Specialist eligibility + approval",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.h3("5.3 Lawful basis and marketing rights")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "UK-CC-LB-01",
                "If PECR requires consent for the method, require consent evidence before send/call",
                "PECR-consent methods",
                "Blocking",
                "Consent evidence token",
            ],
            [
                "UK-CC-LB-02",
                "If live call allowed without consent, still document UK GDPR basis (consent or LI+LIA)",
                "Live marketing call",
                "Approval",
                "Lawful-basis field required",
            ],
            [
                "UK-CC-LB-03",
                "Stop marketing immediately on objection and suppress future marketing",
                "Objection received",
                "Blocking",
                "Objection write + suppress",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.add_page()
    pdf.h3("5.4 Inbound service / AI Contact Centre operations")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "UK-CC-SVC-01",
                "Use customer data only for the stated service purpose",
                "Support interaction",
                "Blocking",
                "Purpose tag on tools",
            ],
            [
                "UK-CC-SVC-02",
                "Authenticate before disclosing account-sensitive information",
                "Sensitive enquiry",
                "Blocking",
                "Auth step completed",
            ],
            [
                "UK-CC-SVC-03",
                "On explicit live-agent request, hand off and stop bot deflection loops",
                "Human requested",
                "Blocking",
                "Handoff tool called",
            ],
            [
                "UK-CC-SVC-04",
                "Mask/minimise sensitive data in assist suggestions per enterprise policy",
                "Agent assist/transcripts",
                "Mixed",
                "Sensitive-data scanner",
            ],
            [
                "UK-CC-SVC-05",
                "Confirm disposition accurately before final write when AI suggests outcome",
                "Interaction closure",
                "Approval",
                "Human confirm on disposition",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    pdf.h3("5.5 Evidence and audit")
    pdf.grid(
        ["ID", "Rule", "When", "Severity", "Verify"],
        [
            [
                "UK-CC-AUD-01",
                "Retain screening, consent, objection, disclosure, and approval evidence",
                "High-risk actions",
                "Blocking",
                "Evidence IDs in decision log",
            ],
            [
                "UK-CC-AUD-02",
                "Store policy-pack version used at decision time",
                "Any compliance decision",
                "Blocking",
                "decision.policySetVersion present",
            ],
        ],
        [28, 62, 30, 22, 40],
    )

    # 6 Agent mapping
    pdf.h2("6. Mapping to Worktual Contact Centre agents")
    pdf.grid(
        ["Agent / capability", "Must load", "Typical tools"],
        [
            ["Contact Centre Super Agent", "All applicable UK-CC-* for action", "Policy resolve, decision token"],
            ["AI Support Agent", "REC-01, SVC-01..03", "Disclosure, auth, purpose, handoff"],
            ["Agent Assist / Coworker", "SVC-02, SVC-04", "Auth gate, sensitive mask"],
            ["Interaction Closure", "SVC-05, LB-03", "Disposition confirm, suppress"],
            ["Audience / Outbound Campaign", "TEL-01..08, LB-01..03", "TPS/CTPS, DNC, consent, CLI"],
            ["Recording / QA workflows", "REC-01..04, AUD-*", "Disclosure, LIA, retention"],
        ],
        [50, 55, 75],
    )

    # 7 Runtime
    pdf.h2("7. Runtime decision model")
    pdf.body("For every governed Contact Centre action:")
    pdf.bullet("1. Resolve applicable packs (country + product + enterprise overlay)")
    pdf.bullet("2. Return only task-relevant obligations to the agent")
    pdf.bullet("3. Agent prepares action using guidance")
    pdf.bullet("4. Verification tools evaluate Blocking/Approval checks")
    pdf.bullet("5. Outcome: Allow / Approve / Block")
    pdf.bullet("6. Write audit evidence with policy version")

    pdf.h3("7.1 Example A - UK outbound live marketing call")
    pdf.body(
        "Campaign requests UK Contact Centre marketing rules -> Audience screens TPS/CTPS + DNC -> "
        "lawful basis/consent validated -> CLI on -> identity disclosure in script -> "
        "if customer objects, suppress and block future marketing -> audit log stored."
    )
    pdf.h3("7.2 Example B - UK inbound recorded support call")
    pdf.body(
        "Recording enabled -> disclosure played and logged -> lawful basis/LIA present -> "
        "AI Support answers with purpose limitation -> sensitive disclosure requires auth -> "
        "live-agent request triggers handoff -> retention policy applied to recording/transcript."
    )

    # 8 Verification outcomes
    pdf.h2("8. Standard verification outcomes")
    pdf.grid(
        ["Failed check", "System outcome"],
        [
            ["TPS/CTPS hit without specific consent", "Block outbound marketing call"],
            ["Automated call without automated-call consent", "Block"],
            ["Recording on without disclosure", "Block recording start or require approval"],
            ["Marketing objection present", "Block and suppress"],
            ["Sensitive disclosure without authentication", "Block"],
            ["Claims/pension special case incomplete", "Approval required"],
            ["Missing evidence for high-risk action", "Block"],
        ],
        [95, 85],
    )

    # 9 Open questions
    pdf.add_page()
    pdf.h2("9. Open questions for Legal/Compliance")
    pdf.bullet("For this tenant, is QA recording based on legitimate interests, consent, or another basis?")
    pdf.bullet("Exact IVR/agent disclosure wording and timing?")
    pdf.bullet("Retention periods for recordings, transcripts, and AI summaries?")
    pdf.bullet("Are claims-management or pension campaigns in scope?")
    pdf.bullet("Quiet hours / frequency caps beyond PECR (enterprise policy)?")
    pdf.bullet("How should webchat inherit equivalent transparency expectations?")
    pdf.bullet("Current ICO PECR guidance status after DUAA amendments?")

    # 10 Attachments
    pdf.h2("10. Attachment checklist")
    pdf.bullet("[ ] ICO Telephone marketing export (dated)")
    pdf.bullet("[ ] ICO live marketing calls guidance export (dated)")
    pdf.bullet("[ ] ICO lawful basis for direct marketing export (dated)")
    pdf.bullet("[ ] ICO legitimate interests export (dated)")
    pdf.bullet("[ ] Enterprise Contact Centre Privacy Notice")
    pdf.bullet("[ ] Enterprise Call Recording / Monitoring Policy")
    pdf.bullet("[ ] Outbound dialler TPS/CTPS SOP")
    pdf.bullet("[ ] Sample IVR disclosure script")
    pdf.bullet("[ ] Do-not-call process SOP")

    # 11 Handoff
    pdf.h2("11. Handoff to Compliance Knowledge Layer")
    pdf.body("After Legal approval, Compliance Engineering converts each obligation into:")
    pdf.bullet("Structured policy metadata (country=GB, product=contact_centre)")
    pdf.bullet("Machine-evaluable controls")
    pdf.bullet("Agent and tool mappings")
    pdf.bullet("Verification checks")
    pdf.bullet("Citations to this pack and official sources")
    pdf.bullet("Versioned publication with auditability")
    pdf.callout(
        "Activation rule",
        "Until Legal marks this pack Approved, Worktual agents must not treat these obligations as live policy.",
    )

    # 12 Next packs
    pdf.h2("12. Next packs to create using this template")
    pdf.grid(
        ["Priority", "Pack ID", "Focus"],
        [
            ["P0", "REF-IN-CC-001", "India Contact Centre (DPDP + TRAI commercial communication)"],
            ["P0", "REF-ENT-CC-001", "Enterprise overlay for Contact Centre (scripts, retention, DNC)"],
            ["P1", "REF-UK-CAMP-001", "UK Campaign Management (email/SMS/PECR)"],
            ["P1", "REF-UK-CRM-001", "UK CRM (profiling, enrichment, proposals)"],
            ["P1", "REF-UK-TICK-001", "UK Ticketing (access, retention, sensitive data)"],
            ["P2", "REF-UK-WEB-001", "UK Web Tracking (cookies/PECR, purpose limitation)"],
            ["P2", "REF-EU-CC-001", "EU Contact Centre (EU GDPR + ePrivacy)"],
        ],
        [22, 40, 120],
    )

    pdf.ln(2)
    pdf.body(
        "Document control: REF-UK-CC-001 v1.0 | Worktual Product Compliance Pack | "
        "Prepared as the standard reference for BA teams | Not legal advice."
    )

    pdf.output(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
