#!/usr/bin/env python3
"""Generate BA instruction PDF for Worktual Compliance Knowledge Layer source packs."""

from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parent / "BA_Instruction_Compliance_Source_Documents.pdf"


class PDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "I", 9)
        self.set_text_color(90, 90, 90)
        self.cell(0, 8, "Worktual Compliance Knowledge Layer - BA Source Document Instructions", align="L")
        self.ln(10)

    def footer(self) -> None:
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}  |  Internal use - not legal advice", align="C")

    def h1(self, text: str) -> None:
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(20, 20, 20)
        self.multi_cell(0, 9, text)
        self.ln(3)

    def h2(self, text: str) -> None:
        self.ln(2)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(20, 20, 20)
        self.multi_cell(0, 7, text)
        self.ln(1)

    def h3(self, text: str) -> None:
        self.ln(1)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(35, 35, 35)
        self.multi_cell(0, 6, text)
        self.ln(0.5)

    def body(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5.5, text)
        self.set_x(self.l_margin)
        self.ln(1.5)

    def bullet(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.cell(6, 5.5, "-")
        self.multi_cell(0, 5.5, text)
        self.set_x(self.l_margin)
        self.ln(0.4)

    def numbered(self, n: int, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.cell(8, 5.5, f"{n}.")
        self.multi_cell(0, 5.5, text)
        self.set_x(self.l_margin)
        self.ln(0.4)

    def callout(self, title: str, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_fill_color(245, 245, 245)
        self.set_draw_color(180, 180, 180)
        self.set_font("Helvetica", "B", 10)
        self.multi_cell(0, 5.5, title, fill=True)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.multi_cell(0, 5.5, text, fill=True)
        self.set_x(self.l_margin)
        self.ln(2)

    def table(self, headers: list[str], rows: list[list[str]], col_widths: list[int]) -> None:
        self.set_x(self.l_margin)
        usable = self.w - self.l_margin - self.r_margin
        if sum(col_widths) != usable:
            scale = usable / sum(col_widths)
            col_widths = [int(w * scale) for w in col_widths]
            col_widths[-1] = int(usable - sum(col_widths[:-1]))
        self.set_font("Helvetica", "B", 9)
        self.set_fill_color(230, 230, 230)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 7, h, border=1, fill=True)
        self.ln()
        self.set_font("Helvetica", "", 8.5)
        for row in rows:
            line_counts = []
            for i, cell in enumerate(row):
                lines = self.multi_cell(col_widths[i], 5, cell, dry_run=True, output="LINES")
                line_counts.append(max(1, len(lines)))
            row_h = max(line_counts) * 5 + 1
            if self.get_y() + row_h > self.h - 20:
                self.add_page()
                self.set_x(self.l_margin)
                self.set_font("Helvetica", "B", 9)
                self.set_fill_color(230, 230, 230)
                for i, h in enumerate(headers):
                    self.cell(col_widths[i], 7, h, border=1, fill=True)
                self.ln()
                self.set_font("Helvetica", "", 8.5)
            x_start = self.l_margin
            y_start = self.get_y()
            for i, cell in enumerate(row):
                self.set_xy(x_start + sum(col_widths[:i]), y_start)
                self.rect(x_start + sum(col_widths[:i]), y_start, col_widths[i], row_h)
                self.multi_cell(col_widths[i], 5, cell)
            self.set_xy(x_start, y_start + row_h)
        self.set_x(self.l_margin)
        self.ln(2)


def build() -> None:
    pdf = PDF(format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    pdf.h1("Worktual Compliance Knowledge Layer")
    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 7, "Business Analyst Instructions: Preparing Source Documents")
    pdf.ln(2)
    pdf.body(
        "Audience: Business Analysts supporting Legal/Compliance and Product. "
        "Goal: prepare clean, structured source packs so regulations and enterprise "
        "policies can be ingested into the Worktual Compliance Knowledge Layer without "
        "hardcoding rules into agent prompts."
    )
    pdf.callout(
        "Critical rule",
        "BAs prepare and structure sources. Legal/Compliance approve meaning. "
        "Engineering publishes machine rules. AI agents only use approved published policies.",
    )

    pdf.h2("1. Why this work matters")
    pdf.body(
        "Worktual products (CRM, AI Contact Center, Ticketing, Campaign Management, "
        "Web Tracking) must follow country, industry, and enterprise rules. Those rules "
        "change and differ by context. If they are pasted into prompts, they become "
        "unmaintainable and unsafe. Your source packs are the approved raw material for "
        "the shared Compliance Knowledge Layer."
    )
    pdf.bullet("Country / regional regulations (example: UK GDPR, PECR, India DPDP)")
    pdf.bullet("Industry requirements (example: Contact Centre call recording and outbound dialling)")
    pdf.bullet("Enterprise policies (often stricter than law)")
    pdf.bullet("Contracts / customer restrictions")

    pdf.h2("2. What you must deliver")
    pdf.body("For each scoped combination, deliver one Source Pack containing:")
    pdf.numbered(1, "Cover metadata (country, industry, products, version, owner, status).")
    pdf.numbered(2, "Authoritative source list with URLs/document IDs and access dates.")
    pdf.numbered(3, "Scope: in-scope channels, data, agents, and actions; clear out-of-scope.")
    pdf.numbered(4, "Obligation inventory table (one row per requirement).")
    pdf.numbered(5, "Mapping of obligations to Worktual products/agents/tools.")
    pdf.numbered(6, "Suggested verification checks (what the system should validate).")
    pdf.numbered(7, "Open legal questions (items BA must not decide alone).")
    pdf.numbered(8, "Attachments: original PDFs/exports of laws, regulator guidance, enterprise policies.")

    pdf.h2("3. Recommended pack naming")
    pdf.body("Use a stable ID pattern:")
    pdf.bullet("SRC-<COUNTRY>-<INDUSTRY>-<NNN>")
    pdf.bullet("Example: SRC-UK-CC-001 = United Kingdom + Contact Centre pack #001")
    pdf.body(
        "Also create separate packs when needed for enterprise-only rules, for example "
        "SRC-ENT-<TENANT>-CC-001."
    )

    pdf.h2("4. How to research efficiently")
    pdf.h3("4.1 Prefer primary sources")
    pdf.bullet("Official regulator guidance (ICO, MeitY, TRAI, etc.)")
    pdf.bullet("Primary legislation / official rules")
    pdf.bullet("Signed enterprise policies and SOPs")
    pdf.bullet("Customer contract schedules that impose extra restrictions")
    pdf.body("Avoid relying only on blogs, vendor marketing pages, or secondary summaries.")

    pdf.h3("4.2 Capture provenance every time")
    pdf.table(
        ["Field", "Example"],
        [
            ["Source title", "Telephone marketing (PECR guide)"],
            ["Publisher", "ICO"],
            ["URL / file ID", "ico.org.uk/.../telephone-marketing/"],
            ["Accessed on", "2026-09-01"],
            ["Effective / review note", "Page notes guidance may change after DUAA"],
            ["Why relevant", "Outbound live/automated marketing calls"],
        ],
        [45, 140],
    )

    pdf.h3("4.3 Split packs cleanly")
    pdf.bullet("Do not mix UK GDPR and EU GDPR in one country pack.")
    pdf.bullet("Do not bury Contact Centre rules inside a generic privacy essay.")
    pdf.bullet("Create one pack per country+industry baseline; add enterprise overlay separately.")

    pdf.add_page()
    pdf.h2("5. Obligation inventory format (mandatory)")
    pdf.body("Every requirement must be reduced to a structured row:")
    pdf.table(
        ["Column", "What to write"],
        [
            ["Obligation ID", "Stable ID, e.g. UK-CC-TEL-001"],
            ["Type", "Obligation / Prohibition / Permission / Approval / Evidence"],
            ["Obligation", "One plain-English rule, actionable"],
            ["Condition", "When it applies (channel, data, audience, purpose)"],
            ["Severity", "Blocking / Approval / Guidance"],
            ["Worktual mapping", "Product, agent, action, or tool affected"],
            ["Verification idea", "What evidence/tool can check before action"],
            ["Source citation", "Exact source + section/page"],
        ],
        [40, 145],
    )
    pdf.ln(2)
    pdf.callout(
        "Quality bar",
        "If an engineer cannot turn the row into a yes/no check or an approval gate, "
        "rewrite it. Vague text such as 'comply with GDPR' is not acceptable.",
    )

    pdf.h2("6. Severity definitions")
    pdf.bullet("Blocking: action must not proceed if check fails.")
    pdf.bullet("Approval: human review required before proceed.")
    pdf.bullet("Guidance: instruct the agent; soft control unless enterprise upgrades it.")
    pdf.bullet("Evidence: must retain proof (consent, screening, disclosure, decision).")

    pdf.h2("7. Mapping to Worktual Contact Center (focus area)")
    pdf.body("When preparing Contact Centre packs, map obligations to capabilities such as:")
    pdf.bullet("AI Support / Voicebot / Webchat containment")
    pdf.bullet("Agent Assist / coworker suggestions")
    pdf.bullet("Call recording / monitoring / QA")
    pdf.bullet("Live-agent handoff")
    pdf.bullet("Outbound campaign / dialler / suppression")
    pdf.bullet("Interaction closure / disposition")
    pdf.bullet("Transcript storage and retention")

    pdf.h2("8. What good vs bad looks like")
    pdf.h3("Bad")
    pdf.bullet("'Follow all data protection laws for calls.'")
    pdf.bullet("Copy-pasting full statute text with no agent mapping.")
    pdf.bullet("Using EU GDPR wording for a UK-only pack.")
    pdf.h3("Good")
    pdf.bullet(
        "'UK-CC-TEL-001: Do not place live marketing calls to TPS/CTPS-registered numbers "
        "unless specific consent exists. Blocking. Map to Audience/Campaign outbound. "
        "Verify TPS/CTPS screen + consent evidence. Source: ICO Telephone marketing.'"
    )

    pdf.h2("9. Required review workflow")
    pdf.numbered(1, "BA drafts source pack and attaches originals.")
    pdf.numbered(2, "Product BA validates Worktual agent/tool mapping.")
    pdf.numbered(3, "Legal/Compliance reviews interpretation and severity.")
    pdf.numbered(4, "Compliance Engineering converts approved rows into structured controls.")
    pdf.numbered(5, "Pack is versioned and published; old version remains auditable.")
    pdf.body("No AI agent may use an unapproved draft as active policy.")

    pdf.h2("10. Delivery checklist (before handoff)")
    pdf.bullet("Cover metadata complete and versioned")
    pdf.bullet("Country and industry explicitly stated")
    pdf.bullet("Primary sources listed with dates")
    pdf.bullet("Obligation table filled (no vague rows)")
    pdf.bullet("Worktual product/agent mapping completed")
    pdf.bullet("Verification ideas included for Blocking/Approval rows")
    pdf.bullet("Open questions listed for Legal")
    pdf.bullet("Original source files attached")
    pdf.bullet("Conflicts with other packs flagged")
    pdf.bullet("Status set to Draft / Legal Review / Approved")

    pdf.add_page()
    pdf.h2("11. Sample pack provided with this instruction")
    pdf.body(
        "A completed sample is included for BA patterning:\n"
        "SAMPLE_UK_Contact_Centre_Compliance_Source.md\n\n"
        "Scope of sample:\n"
        "- Country: United Kingdom\n"
        "- Industry: Contact Centre / Customer Service Operations\n"
        "- Focus: recording transparency, lawful basis documentation, PECR telephone "
        "marketing (TPS/CTPS, CLI, automated-call consent), service-desk handoff, audit evidence.\n\n"
        "Primary public sources used in the sample include ICO telephone marketing guidance, "
        "ICO direct-marketing lawful basis guidance, and ICO legitimate interests guidance "
        "(including call-recording training example). Enterprise policy attachments are shown "
        "as placeholders."
    )
    pdf.callout(
        "How to use the sample",
        "Clone the structure for other countries/industries. Replace UK/ICO rows with the "
        "correct authority sources. Do not copy UK obligations into an India or EU pack.",
    )

    pdf.h2("12. Suggested first BA backlog")
    pdf.table(
        ["Priority", "Pack to prepare"],
        [
            ["P0", "UK + Contact Centre (use sample as baseline)"],
            ["P0", "Enterprise Contact Centre overlay (recording script, retention, DNC SOP)"],
            ["P1", "India + Contact Centre (DPDP + TRAI commercial communication)"],
            ["P1", "UK + Campaign Management (email/SMS/PECR)"],
            ["P2", "Country packs for CRM support and Ticketing retention"],
        ],
        [25, 160],
    )

    pdf.ln(4)
    pdf.h2("13. Contacts and ownership")
    pdf.table(
        ["Role", "Responsibility"],
        [
            ["Business Analyst", "Research, structure, map, attach sources"],
            ["Legal / Compliance", "Approve interpretation and severity"],
            ["Product Owner (Contact Center)", "Confirm agent/action coverage"],
            ["Compliance Engineering", "Publish to Knowledge Layer + verification tools"],
        ],
        [55, 130],
    )

    pdf.ln(4)
    pdf.body(
        "Document control: Instruction v1.0 | Generated for Worktual BA enablement | "
        "Not legal advice. Always confirm with Legal/Compliance before production use."
    )

    pdf.output(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
