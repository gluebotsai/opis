"""Pydantic schemas for proposal extract/generate (Gemini JSON schema)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ClientInfo(StrictModel):
    name: str = ""
    industry: str = ""
    website: str = ""
    lead_source: str = ""


class RequestedSolution(StrictModel):
    name: str = ""
    details: str = ""
    quantities: dict[str, Any] = Field(default_factory=dict)


class BrdExtraction(StrictModel):
    client: ClientInfo = Field(default_factory=ClientInfo)
    project_title: str = ""
    overview: str = ""
    objectives: list[str] = Field(default_factory=list)
    pain_points: list[str] = Field(default_factory=list)
    requested_solutions: list[RequestedSolution] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    integrations: list[str] = Field(default_factory=list)
    quantities: dict[str, Any] = Field(default_factory=dict)
    workflows: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)


class CoverMetaRow(StrictModel):
    label: str = ""
    value: str = ""


class CoverBlock(StrictModel):
    brand: str = ""
    title: str = ""
    prepared_for: str = ""
    date: str = ""
    subtitle: str = ""
    product_tags: list[str] = Field(default_factory=list)
    tag_layout: Literal["vertical", "horizontal", "centered_wrap"] = "centered_wrap"
    brand_align: Literal["left", "center", "right"] = "center"
    cover_align: Literal["left", "center", "right"] = "center"
    meta_rows: list[CoverMetaRow] = Field(default_factory=list)


class LayoutExtraction(StrictModel):
    cover_align: Literal["left", "center", "right"] = "center"
    brand_align: Literal["left", "center", "right"] = "center"
    title_align: Literal["left", "center", "right"] = "left"
    date_align: Literal["left", "center", "right"] = "left"
    prepared_align: Literal["left", "center", "right"] = "left"
    tags_layout: Literal["vertical", "horizontal", "centered_wrap"] = "centered_wrap"
    tags_align: Literal["left", "center", "right"] = "center"
    heading_align: Literal["left", "center"] = "left"
    body_align: Literal["left", "justify", "center"] = "left"
    has_cover_meta_table: bool = False
    brand_font_pt: float = 0
    title_font_pt: float = 0
    prepared_font_pt: float = 0
    date_font_pt: float = 0
    heading_font_pt: float = 0
    body_font_pt: float = 0
    table_font_pt: float = 0
    space_after_brand_pt: float = 0
    space_after_title_pt: float = 0
    space_after_prepared_pt: float = 0
    space_after_date_pt: float = 0
    space_after_tags_pt: float = 0
    space_before_heading_pt: float = 0
    space_after_heading_pt: float = 0
    body_line_gap_pt: float = 0
    list_indent_pt: float = 0
    paragraph_gap_pt: float = 0


class ContentBlock(StrictModel):
    kind: Literal["prose", "bullets", "table", "note"] = "prose"
    text: str = ""
    items: list[str] = Field(default_factory=list)
    table_id: str = ""


class ProposalSection(StrictModel):
    id: str = ""
    heading: str = ""
    kind: Literal["prose", "bullets", "table", "mixed"] = "prose"
    blocks: list[ContentBlock] = Field(default_factory=list)


class ProposalTable(StrictModel):
    id: str = ""
    title: str = ""
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    emphasize_last_col: bool = False


class ProposalInstance(StrictModel):
    cover: CoverBlock = Field(default_factory=CoverBlock)
    sections: list[ProposalSection] = Field(default_factory=list)
    tables: list[ProposalTable] = Field(default_factory=list)
    boilerplate: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    slots: dict[str, str] = Field(default_factory=dict)


class TemplateSection(StrictModel):
    id: str = ""
    heading_pattern: str = ""
    kind: Literal["prose", "bullets", "table", "mixed"] = "prose"
    required: bool = True
    table_id: str = ""


class TemplateTableType(StrictModel):
    id: str = ""
    title_pattern: str = ""
    headers: list[str] = Field(default_factory=list)
    emphasize_last_col: bool = False


class TenantContentTemplate(StrictModel):
    sections: list[TemplateSection] = Field(default_factory=list)
    table_types: list[TemplateTableType] = Field(default_factory=list)
    boilerplate: list[str] = Field(default_factory=list)
    slots: list[str] = Field(default_factory=list)
    commercial_flags: dict[str, bool] = Field(default_factory=dict)


class PriceLine(StrictModel):
    sku_name: str = ""
    qty: str = ""
    unit_price: str = ""
    requested_amount: str = ""
    recommended_amount: str = ""
    notes: str = ""


class GeneratedProposalContent(StrictModel):
    cover: CoverBlock = Field(default_factory=CoverBlock)
    sections: list[ProposalSection] = Field(default_factory=list)
    tables: list[ProposalTable] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    price_lines: list[PriceLine] = Field(default_factory=list)
    kb_queries_used: list[str] = Field(default_factory=list)


class ContentSectionSpec(StrictModel):
    key: str = ""
    purpose: str = ""
    targetWordRange: list[int] = Field(default_factory=list)
    tone: str = ""
    specificityExpectation: str = "high"


class SectionTableRow(StrictModel):
    cells: list[str] = Field(default_factory=list)


class SectionDraft(StrictModel):
    """One generated proposal section (orchestrator output)."""

    key: str = ""
    heading: str = ""
    body: str = ""
    kind: Literal["prose", "bullets", "table", "mixed"] = "prose"
    tableRows: list[SectionTableRow] = Field(default_factory=list)


class TemplateFillSection(StrictModel):
    key: str = ""
    title: str = ""
    body: str = ""
    tableRows: list[SectionTableRow] = Field(default_factory=list)


class TemplateFillResult(StrictModel):
    sections: list[TemplateFillSection] = Field(default_factory=list)


class OutlineLeaf(StrictModel):
    key: str = ""
    title: str = ""
    purpose: str = ""
    kind: Literal["prose", "bullets", "table", "mixed"] = "prose"


class ProposalOutline(StrictModel):
    sections: list[OutlineLeaf] = Field(default_factory=list)


class LengthCoefficients(StrictModel):
    intercept: float = 4
    perThousandWords: float = 1.2
    perComplexityPoint: float = 3


class LengthModelSpec(StrictModel):
    type: str = "linear"
    basis: str = "requirementWordCount + requirementComplexityScore"
    coefficients: LengthCoefficients = Field(default_factory=LengthCoefficients)
    fallback: str = "proportional: pages = requirementWordCount / 400"


class ContentExemplar(StrictModel):
    sectionKey: str = ""
    requirementTheme: str = ""
    redactedSnippet: str = ""
    sourceCaseStudyId: str = ""


class ContentVariance(StrictModel):
    sectionKey: str = ""
    wordMin: int = 0
    wordMax: int = 0
    wordMean: int = 0
    toneSpread: str = ""


class ContentPlaybookSynthesis(StrictModel):
    """Gemini-constrained synthesize payload. sectionSpecs is a list (maps break schema)."""

    sectionSpecs: list[ContentSectionSpec] = Field(default_factory=list)
    lengthModel: LengthModelSpec = Field(default_factory=LengthModelSpec)
    exemplarBank: list[ContentExemplar] = Field(default_factory=list)
    varianceLog: list[ContentVariance] = Field(default_factory=list)


class GeneratedDocumentTitle(StrictModel):
    """Cover H1 + chips for THIS draft. Never a gold document-type phrase."""

    title: str = ""
    product_tags: list[str] = Field(default_factory=list)


class DealPlanLine(StrictModel):
    productName: str = ""
    sku: str = ""
    productId: str = ""
    quantity: float = 0
    notes: str = ""


class DealPlan(StrictModel):
    lines: list[DealPlanLine] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


class DealBrief(StrictModel):
    summary: str = ""
    closedFacts: list[str] = Field(default_factory=list)
    audience: str = ""
