import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { Expand, Shrink } from "lucide-react";
import { DocumentBlueprintView, toReadablePlainText, formatSectionBodyHtml } from "@/components/documents/DocumentBlueprintView";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { CoworkerChatFab } from "@/components/coworker/CoworkerChatFab";
import { CoworkerChatShell } from "@/components/coworker/CoworkerChatShell";
import { CoworkerWorkspace } from "@/components/coworker/CoworkerWorkspace";
import type {
  CoworkerMessage,
  PanelExpand,
} from "@/components/coworker/types";
import { quoteNavigationAmbiguous } from "@/lib/coworker/nav-routing";
import { patchTemplateLogo } from "@/lib/template-logo-patch";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { BackLink } from "@/components/ui/BackLink";
import { TemplateSampleUploadDropzone } from "@/components/configuration/TemplateSampleUploadDropzone";
import {
  PAGE_H1_CLASS,
  SECTION_H2_CLASS,
  TONE_SUCCESS,
  chipClass,
} from "@/lib/ui-tones";

const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;
const MAX_LOGO_BYTES = 2_500_000;
const SAMPLE_ACCEPT_PDF_DOCX =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LOGO_ACCEPT =
  "image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg";
function isQuoteDocument(documentLabel: string): boolean {
  return documentLabel === "quote" || documentLabel === "quotation";
}

function sampleAcceptForDocument(_documentLabel: string): string {
  return SAMPLE_ACCEPT_PDF_DOCX;
}

function sampleUploadHint(_documentLabel: string): string {
  return "PDF or Word (.docx)";
}

/** Sample merge values so template previews never show raw {{tokens}}. */
function documentPreviewTokens(documentLabel: string): Record<string, string> {
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const base = {
    customerName: "Acme Corp",
    companyName: "Acme Corp",
    dealTitle: "Acme expansion",
    date: today,
    dueDate: today,
    vendorName: "Worktual",
    sellerAddress:
      "TS No 125 (North Phase), SIDCO Thiruvika Industrial Estate, Chennai",
    currency: "INR",
    subtotal: "78,000.00",
    taxAmount: "14,040.00",
    discountPct: "0",
    total: "92,040.00",
    validUntil: today,
    paymentTerms: "Net 30",
    billingAddress: "Customer billing address, City, India",
    taxId: "33AADCW3870A1ZO",
    productScope: "AI Contact Centre",
  };
  if (documentLabel === "invoice") {
    return {
      ...base,
      documentTitle: "Invoice",
      invoiceNumber: "WIPL-2026-201",
    };
  }
  if (isQuoteDocument(documentLabel)) {
    return {
      ...base,
      invoiceNumber: "INV-1001",
      quoteNumber: "Q-1001",
      currency: "USD",
      subtotal: "10,000.00",
      taxAmount: "0.00",
      total: "10,000.00",
    };
  }
  return {
    ...base,
    invoiceNumber: "INV-1001",
    quoteNumber: "Q-1001",
    currency: "USD",
    subtotal: "10,000.00",
    taxAmount: "0.00",
    total: "10,000.00",
  };
}

const SAMPLE_CLONE_BRIEF =
  "Clone this uploaded sample as an exact visual template. Preserve layout, logo, colors, tables, letterhead, and bank/footer details. Keep merge tokens only for dynamic fields (invoice number, dates, customer, amounts). Do not invent sample line rows.";

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type TemplateListItem = {
  id: string;
  name: string;
  isDefault: boolean;
  updatedAt?: string;
  sections?: TemplateSectionEdit[];
  blueprint?: {
    version: number;
    html: string;
    css: string;
    mode?: string;
    chrome?: boolean;
    theme?: Record<string, string>;
    slots?: Array<{ key: string; label: string }>;
  } | null;
  assets?: Array<{
    id: string;
    kind: "logo" | "image";
    mime: string;
    dataBase64: string;
  }>;
};

export type TemplateSectionEdit = {
  id: string;
  key?: string;
  title: string;
  body: string;
  sortOrder?: number;
};

type GenerateInput = {
  brief: string;
  sampleText: string;
  sampleFileBase64?: string;
  sampleFilename?: string;
  existingSections: TemplateSectionEdit[];
};

type GenerateResult =
  | {
      ok: true;
      sections: TemplateSectionEdit[];
      warnings?: string[];
      blueprint?: {
        version: number;
        html: string;
        css: string;
        mode?: string;
        chrome?: boolean;
        theme?: Record<string, string>;
        slots?: Array<{ key: string; label: string }>;
      };
      assets?: Array<{
        id: string;
        kind: "logo" | "image";
        mime: string;
        dataBase64: string;
      }>;
    }
  | { ok: false; error: string };

type CreateResult =
  | {
      ok: true;
      id: string;
      template: TemplateListItem & { sections: TemplateSectionEdit[] };
    }
  | { ok: false; error: string };

type SaveResult = { ok: true } | { ok: false; error: string };

type View = "list" | "detail" | "create";

type ChatStep = "idle" | "awaiting_name" | "awaiting_description" | "done";

type ChatMsg = {
  id: string;
  role: "assistant" | "user" | "error";
  text: ReactNode;
};

/** Visible turn + flow step updated together (UI shows only the latest turn). */
type ChatState = {
  messages: ChatMsg[];
  currentStep: ChatStep;
  createName: string;
  createSections: TemplateSectionEdit[];
  createBlueprint?: NonNullable<
    Extract<GenerateResult, { ok: true }>["blueprint"]
  >;
  createAssets?: Extract<GenerateResult, { ok: true }>["assets"];
};

const INITIAL_CHAT: ChatState = {
  messages: [],
  currentStep: "idle",
  createName: "",
  createSections: [],
  createBlueprint: undefined,
  createAssets: undefined,
};

type ChatAssistInput = {
  message: string;
  currentStep: ChatStep;
  turnHint: string;
  createName?: string;
  templateNames?: string[];
  hasSample?: boolean;
  skipEdit?: boolean;
  templateContext?: {
    templateId?: string;
    templateName?: string;
    blueprint?: TemplateListItem["blueprint"];
    assets?: TemplateListItem["assets"];
    sections?: TemplateSectionEdit[];
  };
};

type ChatAssistEdits = {
  sections?: TemplateSectionEdit[];
  blueprint?: TemplateListItem["blueprint"];
  assets?: TemplateListItem["assets"];
  rename?: string;
  makeActive?: boolean;
  applied?: string[];
};

type ChatAssistResult =
  | {
      ok: true;
      text: string;
      edits?: ChatAssistEdits;
      nextStep?: ChatStep;
      createName?: string;
      confirmActive?: boolean;
      startCreate?: boolean;
      triggerGenerateStandard?: boolean;
      requestLogoUpload?: boolean;
      navigateHref?: string;
      applyLogoAllPages?: boolean;
    }
  | { ok: false; error: string };

type Props = {
  title: string;
  documentLabel: string;
  purpose: string;
  usedWhen: string;
  templates: TemplateListItem[];
  loading: boolean;
  error: string | null;
  message: string | null;
  onClearMessage?: () => void;
  onReload: () => Promise<void>;
  /** Conversational replies via AI chat agent. */
  chatAssist: (input: ChatAssistInput) => Promise<ChatAssistResult>;
  generate: (input: GenerateInput) => Promise<GenerateResult>;
  createTemplate: (input: {
    name: string;
    makeActive: boolean;
    sections: TemplateSectionEdit[];
    blueprint?: Extract<GenerateResult, { ok: true }>["blueprint"];
    assets?: Extract<GenerateResult, { ok: true }>["assets"];
  }) => Promise<CreateResult>;
  saveTemplate: (input: {
    id: string;
    name: string;
    sections: TemplateSectionEdit[];
    blueprint?: Extract<GenerateResult, { ok: true }>["blueprint"] | null;
    assets?: Extract<GenerateResult, { ok: true }>["assets"];
  }) => Promise<SaveResult>;
  uploadLogo?: (input: {
    id: string;
    dataBase64: string;
    mime: string;
  }) => Promise<SaveResult>;
  setActive: (id: string) => Promise<SaveResult>;
  deleteTemplate?: (id: string) => Promise<SaveResult>;
  sectionBodyRows?: number;
  /** Left chat pane title (defaults to title). */
  agentTitle?: string;
};

let msgSeq = 0;
function nextId() {
  msgSeq += 1;
  return `chat-${msgSeq}`;
}

function reactNodeToString(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  return "";
}

function formatUpdated(iso?: string) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/**
 * Template list/detail + conversational chat (responses live in the chat panel).
 */
export function DocumentTemplateWorkspace({
  title,
  documentLabel,
  purpose,
  usedWhen,
  templates,
  loading,
  error,
  message,
  onClearMessage,
  onReload,
  chatAssist,
  generate,
  createTemplate,
  saveTemplate,
  uploadLogo,
  setActive,
  deleteTemplate,
  sectionBodyRows = 6,
  agentTitle,
}: Props) {
  const navigate = useNavigate();
  const openFileAttachRef = useRef<(() => void) | null>(null);
  const [booted, setBooted] = useState(false);
  const [chat, setChat] = useState<ChatState>(INITIAL_CHAT);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [view, setView] = useState<View>("list");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expand, setExpand] = useState<PanelExpand>("default");
  const [mobileTab, setMobileTab] = useState<"chat" | "draft">("chat");

  const [name, setName] = useState("");
  const [sections, setSections] = useState<TemplateSectionEdit[]>([]);
  const [detailBlueprint, setDetailBlueprint] = useState<
    TemplateListItem["blueprint"]
  >(null);
  const [detailAssets, setDetailAssets] = useState<TemplateListItem["assets"]>(
    undefined,
  );
  const [editing, setEditing] = useState(false);

  const [composer, setComposer] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const sampleFileRef = useRef(sampleFile);
  sampleFileRef.current = sampleFile;
  const [workspaceUploadFile, setWorkspaceUploadFile] = useState<File | null>(
    null,
  );
  const [workspaceUploadName, setWorkspaceUploadName] = useState("");
  const [workspaceUploadError, setWorkspaceUploadError] = useState<string | null>(
    null,
  );
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);

  const openTemplate = templates.find((t) => t.id === openId) ?? null;
  const { messages, currentStep } = chat;

  const appendMessages = (
    additions: Array<{ role: ChatMsg["role"]; text: ReactNode }>,
    patch?: Partial<Omit<ChatState, "messages">>,
  ) => {
    setChat((prev) => ({
      ...prev,
      ...patch,
      messages: [
        ...prev.messages,
        ...additions.map((m) => ({
          id: nextId(),
          role: m.role,
          text: m.text,
        })),
      ],
    }));
  };

  const commitTurn = (
    additions: Array<{ role: ChatMsg["role"]; text: ReactNode }>,
    patch?: Partial<Omit<ChatState, "messages">>,
  ) => {
    appendMessages(additions, patch);
  };

  const fail = (text: string) =>
    commitTurn([
      {
        role: "error",
        text: (text ?? "").trim() || "Something went wrong. Try again.",
      },
    ]);

  const toggleExpand = (side: "chat" | "draft") => {
    setExpand((prev) => {
      if (side === "chat") return prev === "chat" ? "default" : "chat";
      return prev === "draft" ? "default" : "draft";
    });
    if (side === "draft") {
      setMobileTab((tab) => (expand === "draft" ? tab : "draft"));
    }
  };

  const restartChat = () => {
    setChat(INITIAL_CHAT);
    chatRef.current = INITIAL_CHAT;
    setComposer("");
    clearSampleFile();
    setView("list");
    setOpenId(null);
    setEditing(false);
    setExpand("default");
    setMobileTab("chat");
    void askAgent(
      "hello",
      "Greet briefly and ask how you can help with templates. Do not tell them to type create.",
      undefined,
      "idle",
    );
  };

  /** Ask the Python template-chat agent; applies structured flow + edits from the response. */
  const askAgent = async (
    userMessage: string,
    turnHint: string,
    patch?: Partial<Omit<ChatState, "messages">>,
    stepForAgent?: ChatStep,
  ) => {
    setBusy(true);
    const step =
      stepForAgent ?? patch?.currentStep ?? chatRef.current.currentStep;
    const createName =
      patch?.createName !== undefined
        ? patch.createName
        : chatRef.current.createName;
    try {
      const result = await chatAssist({
        message: userMessage,
        currentStep: step,
        turnHint,
        createName: createName || undefined,
        templateNames: templates.map((t) => t.name),
        hasSample: Boolean(sampleFileRef.current),
        templateContext: buildTemplateContext(),
      });
      setBusy(false);
      if (!result.ok) {
        appendMessages(
          [
            {
              role: "error",
              text:
                (result.error ?? "").trim() ||
                "Assistant unavailable. Try again.",
            },
          ],
          patch,
        );
        return;
      }
      await applyChatEdits(result.edits);

      const flowPatch: Partial<Omit<ChatState, "messages">> = {
        ...patch,
        ...(result.nextStep ? { currentStep: result.nextStep } : {}),
        ...(result.createName ? { createName: result.createName } : {}),
      };
      if (result.startCreate) {
        setView("create");
        flowPatch.currentStep = result.nextStep ?? "awaiting_name";
      }
      commitTurn([{ role: "assistant", text: result.text }], flowPatch);

      if (typeof result.confirmActive === "boolean") {
        await finishCreate(userMessage, result.confirmActive);
        return;
      }
      if (result.triggerGenerateStandard) {
        await buildFromDescription(userMessage, "", true);
      }
      if (result.navigateHref?.startsWith("/")) {
        const ambiguous = quoteNavigationAmbiguous(userMessage);
        if (
          !ambiguous ||
          !result.navigateHref.startsWith("/sales/quotes")
        ) {
          navigate(result.navigateHref);
        }
      }
    } catch (err) {
      setBusy(false);
      appendMessages(
        [
          {
            role: "error",
            text:
              err instanceof Error ? err.message : "Assistant unavailable.",
          },
        ],
        patch,
      );
    }
  };

  useEffect(() => {
    if (booted || loading) return;
    setBooted(true);
    void askAgent(
      "hello",
      "Greet briefly and ask how you can help with templates. Do not tell them to type create.",
      undefined,
      "idle",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, loading, documentLabel]);

  useEffect(() => {
    if (!message) return;
    setWorkspaceStatus(null);
  }, [message]);

  useEffect(() => {
    if (view !== "detail" || !openId || editing) return;
    const t = templates.find((x) => x.id === openId);
    if (!t) return;
    setName(t.name);
    setSections(t.sections ?? []);
    setDetailBlueprint(t.blueprint ?? null);
    setDetailAssets(t.assets);
  }, [view, openId, templates, editing]);

  const buildTemplateContext = (): ChatAssistInput["templateContext"] => {
    if (view === "detail" && openTemplate) {
      return {
        templateId: openTemplate.id,
        templateName: name || openTemplate.name,
        blueprint: detailBlueprint ?? openTemplate.blueprint ?? null,
        assets: detailAssets ?? openTemplate.assets,
        sections,
      };
    }
    if (
      (view === "create" || chatRef.current.currentStep === "done") &&
      chatRef.current.createBlueprint
    ) {
      return {
        templateName: chatRef.current.createName,
        blueprint: chatRef.current.createBlueprint,
        assets: chatRef.current.createAssets,
        sections: chatRef.current.createSections,
      };
    }
    return undefined;
  };

  const applyChatEdits = async (edits: ChatAssistEdits | undefined) => {
    if (!edits) return;
    if (edits.sections) setSections(edits.sections);
    if (edits.rename?.trim()) setName(edits.rename.trim());

    if (view === "detail" && openId && openTemplate) {
      const nextBlueprint =
        edits.blueprint !== undefined
          ? edits.blueprint
          : detailBlueprint ?? openTemplate.blueprint ?? null;
      const nextAssets = edits.assets ?? detailAssets ?? openTemplate.assets;
      const nextSections = edits.sections ?? sections;
      const nextName = edits.rename?.trim() || name;
      if (edits.blueprint !== undefined) setDetailBlueprint(edits.blueprint);
      if (edits.assets) setDetailAssets(edits.assets);
      if (
        edits.applied?.length ||
        edits.sections ||
        edits.blueprint !== undefined ||
        edits.assets
      ) {
        setBusy(true);
        const result = await saveTemplate({
          id: openId,
          name: nextName,
          sections: nextSections,
          blueprint: nextBlueprint ?? undefined,
          assets: nextAssets,
        });
        setBusy(false);
        if (!result.ok) {
          fail(result.error);
          return;
        }
        await onReload();
      }
      if (edits.makeActive) {
        await onSetActive(openId);
      }
      return;
    }

    if (chatRef.current.createBlueprint || view === "create") {
      setChat((prev) => ({
        ...prev,
        createSections: edits.sections ?? prev.createSections,
        createBlueprint:
          edits.blueprint !== undefined && edits.blueprint
            ? {
                version: edits.blueprint.version,
                html: edits.blueprint.html,
                css: edits.blueprint.css,
                mode: edits.blueprint.mode,
                chrome: edits.blueprint.chrome,
                theme: edits.blueprint.theme,
                slots: edits.blueprint.slots,
              }
            : prev.createBlueprint,
        createAssets: edits.assets ?? prev.createAssets,
        createName: edits.rename?.trim() || prev.createName,
      }));
    }
  };

  const clearSampleFile = () => {
    sampleFileRef.current = null;
    setSampleFile(null);
  };

  const chatPlaceholder =
    currentStep === "awaiting_name"
      ? "Template name…"
      : currentStep === "awaiting_description"
        ? sampleFile
          ? "Send to analyze sample…"
          : "Type standard or attach sample (clip icon)…"
        : currentStep === "done"
          ? chat.createBlueprint
            ? "Edit the clone or yes/no…"
            : "Yes or no…"
          : "Ask about templates…";

  const chatFooterHint = sampleFile
    ? `Attached: ${sampleFile.name} — press Enter to analyze`
    : isQuoteDocument(documentLabel)
      ? "Clip icon: PDF/DOCX sample or logo image"
      : "Clip icon: PDF/DOCX sample or logo image";

  const openDetail = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setOpenId(id);
    setName(t.name);
    setSections(t.sections ?? []);
    setEditing(false);
    setView("detail");
  };

  const cancelCreateFlow = () => {
    setView("list");
    setOpenId(null);
    setEditing(false);
    clearSampleFile();
    setComposer("");
    const idle = {
      currentStep: "idle" as const,
      createName: "",
      createSections: [] as TemplateSectionEdit[],
      createBlueprint: undefined,
      createAssets: undefined,
    };
    chatRef.current = { ...chatRef.current, ...idle };
    setChat((prev) => ({ ...prev, ...idle }));
    setWorkspaceStatus(null);
  };

  const backToList = () => {
    if (
      currentStep === "awaiting_name" ||
      currentStep === "awaiting_description" ||
      currentStep === "done"
    ) {
      cancelCreateFlow();
      return;
    }
    setView("list");
    setOpenId(null);
    setEditing(false);
    clearSampleFile();
  };

  const onPickSampleFile = (file: File | null) => {
    if (!file) {
      clearSampleFile();
      return;
    }
    if (file.size > MAX_SAMPLE_BYTES) {
      fail("Sample file must be 8 MB or smaller.");
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      fail("Upload a PDF or Word (.docx) sample.");
      return;
    }
    sampleFileRef.current = file;
    setSampleFile(file);
    const step = chatRef.current.currentStep;
    if (step === "idle") {
      setView("create");
      void askAgent(
        `Attached sample: ${file.name}`,
        `User attached sample “${file.name}”. Acknowledge and ask what to name this ${documentLabel} template.`,
        { currentStep: "awaiting_name", createName: "", createSections: [] },
        "awaiting_name",
      );
      return;
    }
    if (step === "awaiting_name") {
      void askAgent(
        `Attached sample: ${file.name}`,
        `User attached sample “${file.name}” while naming. Confirm it’s attached and ask them to type a template name.`,
        undefined,
        "awaiting_name",
      );
      return;
    }
    if (step === "awaiting_description") {
      // Sample is enough — analyze immediately; don't ask for a layout essay.
      // Pass `file` explicitly so generate never races a stale sampleFileRef.
      void buildFromDescription(
        `Attached sample: ${file.name}`,
        SAMPLE_CLONE_BRIEF,
        false,
        file,
      );
      return;
    }
  };

  const isLogoImageFile = (file: File) => {
    if (file.type.startsWith("image/")) return true;
    return /\.(png|jpe?g|webp|svg)$/i.test(file.name);
  };

  const logoMimeForFile = (file: File) => {
    if (file.type.startsWith("image/")) return file.type;
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".png")) return "image/png";
    return "image/jpeg";
  };

  const applyLogoImage = async (file: File) => {
    if (file.size > MAX_LOGO_BYTES) {
      fail("Logo image must be 2.5 MB or smaller.");
      return;
    }
    if (!isLogoImageFile(file)) {
      fail("Upload a PNG, JPEG, WebP, or SVG logo.");
      return;
    }
    const mime = logoMimeForFile(file);
    const dataBase64 = await fileToBase64(file);

    if (view === "create" && chatRef.current.createBlueprint) {
      const logo = { mime, dataBase64 };
      const patched = patchTemplateLogo(
        chatRef.current.createBlueprint,
        chatRef.current.createAssets,
        logo,
      );
      chatRef.current = {
        ...chatRef.current,
        createBlueprint: patched.blueprint,
        createAssets: patched.assets,
      };
      setChat((prev) => ({
        ...prev,
        createBlueprint: patched.blueprint,
        createAssets: patched.assets,
      }));
      return;
    }

    if (view === "detail" && openId && openTemplate?.blueprint && uploadLogo) {
      setBusy(true);
      const result = await uploadLogo({ id: openId, dataBase64, mime });
      setBusy(false);
      if (!result.ok) {
        fail(result.error);
        return;
      }
      await onReload();
      return;
    }

    fail(
      "Open a template with a layout preview, then use the clip icon in chat to upload a logo image (PNG, JPEG, WebP, or SVG).",
    );
  };

  const onPickUploadFile = (file: File | null) => {
    if (!file) return;
    if (isLogoImageFile(file)) {
      void applyLogoImage(file);
      return;
    }
    onPickSampleFile(file);
  };

  const onSaveDetail = async () => {
    if (!openId || !openTemplate) return;
    setBusy(true);
    const result = await saveTemplate({
      id: openId,
      name,
      sections,
      blueprint: detailBlueprint ?? openTemplate.blueprint ?? undefined,
      assets: detailAssets ?? openTemplate.assets,
    });
    setBusy(false);
    if (!result.ok) {
      setWorkspaceStatus(result.error);
      return;
    }
    setEditing(false);
    setWorkspaceStatus(null);
    await onReload();
  };

  const onSetActive = async (id: string) => {
    setBusy(true);
    const result = await setActive(id);
    setBusy(false);
    if (!result.ok) {
      setWorkspaceStatus(result.error);
      return;
    }
    setWorkspaceStatus(null);
    await onReload();
  };

  const buildFromDescription = async (
    userBubble: string,
    brief: string,
    useStandard: boolean,
    sampleOverride?: File,
    opts?: { silentChat?: boolean },
  ) => {
    const silentChat = opts?.silentChat === true;
    const sample = sampleOverride ?? sampleFileRef.current;
    if (sampleOverride) {
      sampleFileRef.current = sampleOverride;
      setSampleFile(sampleOverride);
    }
    if (useStandard && !sample) {
      await askAgent(
        userBubble,
        "User chose the standard section skeleton. Confirm briefly and ask whether this should become the Active template (yes or no).",
        { currentStep: "done", createSections: [] },
        "done",
      );
      return;
    }
    if (!sample && brief.trim().length < 8) {
      const msg =
        "Describe the template (a sentence or two), upload a sample, or type “standard”.";
      if (silentChat) {
        setWorkspaceUploadError(msg);
        return;
      }
      fail(msg);
      return;
    }

    setBusy(true);
    if (!silentChat) {
      setChat((prev) => ({ ...prev, messages: [] }));
    }
    let sampleFileBase64: string | undefined;
    let sampleFilename: string | undefined;
    if (sample) {
      try {
        sampleFileBase64 = await fileToBase64(sample);
        sampleFilename = sample.name;
      } catch {
        setBusy(false);
        const msg = "Could not read the sample file. Try another file.";
        if (silentChat) {
          setWorkspaceUploadError(msg);
          return;
        }
        fail(msg);
        return;
      }
    }
    const result = await generate({
      brief: brief.trim() || SAMPLE_CLONE_BRIEF,
      sampleText: "",
      sampleFileBase64,
      sampleFilename,
      existingSections: [],
    });
    setBusy(false);
    clearSampleFile();
    if (!result.ok) {
      if (silentChat) {
        setWorkspaceUploadError(result.error);
        return;
      }
      fail(result.error);
      return;
    }

    // Sample uploads must produce an exact page-clone — never show AI-redesigned drafts.
    const isPageClone = result.blueprint?.mode === "page-clone";
    const isSpreadsheetLayout =
      result.blueprint?.mode === "spreadsheet-layout";
    if (sampleFilename && !isPageClone && !isSpreadsheetLayout) {
      const cloneErr =
        "Could not create an exact visual clone from this sample. Check that the PDF/DOCX opens normally and is not password-protected, then retry.";
      if (silentChat) {
        setWorkspaceUploadError(cloneErr);
        return;
      }
      fail(cloneErr);
      return;
    }

    setWorkspaceUploadError(null);
    setView("create");
    const flowPatch = {
      currentStep: "done" as const,
      createName: chatRef.current.createName,
      createSections: result.sections,
      createBlueprint: result.blueprint,
      createAssets: result.assets,
    };
    chatRef.current = { ...chatRef.current, ...flowPatch };
    if (silentChat) {
      setChat((prev) => ({ ...prev, ...flowPatch }));
      return;
    }

    const warningLine = (result.warnings ?? [])
      .filter((w) => {
        const low = w.toLowerCase();
        return !(
          low.includes("venv pypdf") ||
          (low.includes("system python") && low.includes("extracted via"))
        );
      })
      .join(" · ");
    const draftHint = isPageClone
      ? "Review the exact page clone in the workspace — layout is locked to your uploaded sample."
      : isSpreadsheetLayout
        ? "Review the spreadsheet column layout in the workspace."
        : result.blueprint
          ? "Review the draft preview in the workspace."
          : "";
    const draftText = [
      warningLine || null,
      `Draft ready (${result.sections.length} sections).`,
      draftHint,
      "Should this become the Active template? Reply yes or no.",
    ]
      .filter(Boolean)
      .join(" ");
    commitTurn([{ role: "assistant", text: draftText }], flowPatch);
  };

  const runWorkspaceUploadLearn = async () => {
    const file = workspaceUploadFile;
    const templateName = workspaceUploadName.trim();
    setWorkspaceUploadError(null);
    if (!file) {
      setWorkspaceUploadError("Choose a sample file in the upload area first.");
      return;
    }
    if (file.size > MAX_SAMPLE_BYTES) {
      setWorkspaceUploadError("Sample file must be 8 MB or smaller.");
      return;
    }
    if (templateName.length < 2) {
      setWorkspaceUploadError("Enter a template name (at least 2 characters).");
      return;
    }
    chatRef.current = {
      ...chatRef.current,
      currentStep: "awaiting_description",
      createName: templateName,
    };
    setChat((prev) => ({
      ...prev,
      currentStep: "awaiting_description",
      createName: templateName,
    }));
    setWorkspaceUploadFile(null);
    setWorkspaceUploadName("");
    await buildFromDescription(
      `Learn template “${templateName}” from ${file.name}`,
      SAMPLE_CLONE_BRIEF,
      false,
      file,
      { silentChat: true },
    );
  };

  const finishCreate = async (_userBubble: string, makeActive: boolean) => {
    const { createName, createSections, createBlueprint, createAssets } =
      chatRef.current;
    setBusy(true);
    const result = await createTemplate({
      name: createName,
      makeActive,
      sections: createSections,
      blueprint: createBlueprint,
      assets: createAssets,
    });
    setBusy(false);
    if (!result.ok) {
      setWorkspaceStatus(result.error);
      return;
    }
    setWorkspaceStatus(
      makeActive
        ? "Template saved and set active."
        : "Template saved.",
    );
    clearSampleFile();
    setComposer("");
    const idle = {
      currentStep: "idle" as const,
      createName: "",
      createSections: [] as TemplateSectionEdit[],
      createBlueprint: undefined,
      createAssets: undefined,
    };
    chatRef.current = { ...chatRef.current, ...idle };
    setChat((prev) => ({ ...prev, ...idle }));
    await onReload();
    setOpenId(result.id);
    setName(result.template.name);
    setSections(result.template.sections ?? []);
    setEditing(false);
    setView("detail");
  };

  const handleChatSend = async () => {
    const text = composer.trim();
    const step = chatRef.current.currentStep;
    const sample = sampleFileRef.current;

    if (text) {
      appendMessages([{ role: "user", text }]);
    }

    try {
      // Strict step machine — never re-classify a mid-flow message as a new command.
      if (step === "awaiting_name") {
        if (text.length < 2) {
          fail("Type a template name (at least 2 characters), then send.");
          return;
        }
        setComposer("");
        setView("create");
        // Name + sample → analyze PDF immediately (no description questions).
        if (sample) {
          chatRef.current = {
            ...chatRef.current,
            currentStep: "awaiting_description",
            createName: text,
          };
          setChat((prev) => ({
            ...prev,
            currentStep: "awaiting_description",
            createName: text,
          }));
          await buildFromDescription(text, SAMPLE_CLONE_BRIEF, false);
          return;
        }
        await askAgent(
          text,
          `They named the template “${text}”. Confirm the name and ask them to upload a sample PDF or Word (.docx), or say “standard” for the default skeleton. Do not ask them to describe layout fields.`,
          { currentStep: "awaiting_description", createName: text },
          "awaiting_description",
        );
        return;
      }

      if (step === "awaiting_description") {
        const wantsStandard = /^(standard|skip|default)\b/i.test(text);
        if (!text && !sample) {
          fail("Upload a sample (+), or type “standard”.");
          return;
        }
        const userBubble = text
          ? text
          : sample
            ? `Build from ${sample.name}`
            : "Build from my sample";
        setComposer("");
        await buildFromDescription(
          userBubble,
          wantsStandard && !sample
            ? ""
            : sample
              ? SAMPLE_CLONE_BRIEF
              : text || SAMPLE_CLONE_BRIEF,
          wantsStandard && !sample,
        );
        return;
      }

      if (step === "done") {
        if (/^(yes|y|active|make\s+active)\b/i.test(text)) {
          setComposer("");
          await finishCreate(text || "yes", true);
          return;
        }
        if (/^(no|n|skip|not\s+active|inactive)\b/i.test(text)) {
          setComposer("");
          await finishCreate(text || "no", false);
          return;
        }
        if (!text) {
          fail(
            "Use Save & set active / Save (inactive) in the workspace, or reply yes/no in chat.",
          );
          return;
        }
        setComposer("");
        const lastAssistant = [...chatRef.current.messages]
          .reverse()
          .find((m) => m.role === "assistant");
        const hint = lastAssistant
          ? `Previous assistant message: "${lastAssistant.text}". User replied: "${text}".`
          : "";
        await askAgent(text, hint, undefined, "done");
        return;
      }

      // idle — conversational: answer the user; only enter create-flow on clear intent
      if (!text && !sample) {
        return;
      }

      if (sample && !text) {
        setComposer("");
        setView("create");
        await askAgent(
          "I attached a sample",
          `They attached a sample for a new ${documentLabel} template. Ask what to name it.`,
          { currentStep: "awaiting_name", createName: "", createSections: [] },
          "awaiting_name",
        );
        return;
      }

      setComposer("");
      const lower = text.toLowerCase();

      const wantsLogo =
        /\b(logo|brand(?:ing)?|wordmark)\b/i.test(text) &&
        /\b(change|replace|update|new|upload|swap|use)\b/i.test(text);

      if (wantsLogo) {
        await askAgent(
          text,
          "They want to change the template logo. Tell them to use the clip icon in chat and choose a PNG, JPEG, WebP, or SVG image.",
          undefined,
          "idle",
        );
        return;
      }

      const wantsCreate =
        /^(create|new|add)(\s|$)/i.test(text) ||
        /\b(create|make|add|build|start)\b.+\b(template|one)\b/i.test(text) ||
        lower.includes("new template") ||
        lower === "create template" ||
        lower === "make a template";

      if (wantsCreate) {
        setView("create");
        await askAgent(
          text,
          `They want to create a new ${documentLabel} template. Ask what to call it — conversationally, no command instructions.`,
          { currentStep: "awaiting_name", createName: "", createSections: [] },
          "awaiting_name",
        );
        return;
      }

      const exact = templates.find((t) => t.name.toLowerCase() === lower);
      if (exact) {
        setOpenId(exact.id);
        setName(exact.name);
        setSections(exact.sections ?? []);
        setEditing(false);
        setView("detail");
        await askAgent(
          text,
          `They opened “${exact.name}”${exact.isDefault ? " (Active)" : ""}. Confirm briefly that it’s open.`,
          undefined,
          "idle",
        );
        return;
      }

      // Pure conversational reply — answer or apply edits when a template is open.
      const editContext = buildTemplateContext();
      await askAgent(
        text,
        editContext
          ? ""
          : "Answer their message directly and conversationally. Do not tell them to type create or list commands unless they asked how to create a template.",
        undefined,
        "idle",
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };

  const updateSection = (idx: number, patch: Partial<TemplateSectionEdit>) => {
    const next = sections.slice();
    next[idx] = { ...next[idx], ...patch };
    setSections(next);
  };

  const coworkerMessages: CoworkerMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    text:
      typeof m.text === "string"
        ? m.text
        : reactNodeToString(m.text) || "…",
  }));

  const pageFull = expand === "draft";
  const shellTitle = agentTitle ?? title;

  const workspaceBody = (
    <ConfigurationShell>
      <div className="flex min-h-0 min-w-0 flex-col">
        {view === "list" ? (
          <div className="shrink-0 border-b border-border-default bg-surface px-4 py-4 sm:px-6 sm:py-5">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className={PAGE_H1_CLASS}>{title}</h1>
                <p className="mt-1 text-sm text-text-caption">{purpose}</p>
                <p className="mt-0.5 text-xs text-text-caption">{usedWhen}</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="crm-fade-in min-w-0 w-full px-3 py-4 sm:px-5 sm:py-5">
      {workspaceStatus || message ? (
        <p
          className="mb-4 rounded-lg border border-border-default bg-subtle px-3 py-2 text-sm text-text-secondary"
          role="status"
        >
          {workspaceStatus || message}
          <button
            type="button"
            className="ml-3 text-xs font-medium text-text-caption underline"
            onClick={() => {
              setWorkspaceStatus(null);
              onClearMessage?.();
            }}
          >
            Dismiss
          </button>
        </p>
      ) : null}
      {view === "list" ? (
        <>
          <p className="text-sm text-text-secondary">
            Only <strong>one</strong> template is{" "}
            <span className={chipClass(TONE_SUCCESS)}>Active</span> for new{" "}
            {documentLabel}s. Upload a sample below or use the assistant in
            chat.
          </p>

          <div className="mt-6 rounded-2xl border border-border-default bg-surface p-5">
            <h2 className={SECTION_H2_CLASS}>Upload a design sample</h2>
            <p className="mt-1 text-xs text-text-caption">
              Learn layout from one file (same idea as Proposal patterns).
              Admin only. After learning, use Save & set active in the
              workspace (or Make active on the template later).
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <TemplateSampleUploadDropzone
                title="Template file"
                hint={sampleUploadHint(documentLabel)}
                accept={sampleAcceptForDocument(documentLabel)}
                file={workspaceUploadFile}
                disabled={busy}
                onFile={setWorkspaceUploadFile}
              />
              <div className="flex flex-col justify-end gap-3">
                <div>
                  <label
                    htmlFor="workspace-template-name"
                    className="text-xs font-medium text-text-secondary"
                  >
                    Template name
                  </label>
                  <Input
                    id="workspace-template-name"
                    className="mt-1"
                    value={workspaceUploadName}
                    onChange={(e) => setWorkspaceUploadName(e.target.value)}
                    placeholder={`e.g. Standard ${documentLabel}`}
                    disabled={busy}
                  />
                </div>
                <Button
                  type="button"
                  disabled={busy || !workspaceUploadFile}
                  onClick={() => void runWorkspaceUploadLearn()}
                >
                  {busy ? "Learning…" : "Learn template from sample"}
                </Button>
                {workspaceUploadError ? (
                  <p className="text-sm text-text-danger" role="alert">
                    {workspaceUploadError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h2 className={SECTION_H2_CLASS}>Your templates</h2>
            <p className="mt-1 text-xs text-text-caption">
              Click to open, or ask the assistant in chat.
            </p>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-text-caption">Loading…</p>
          ) : error ? (
            <p className="mt-4 text-sm text-text-danger" role="alert">
              {error}
            </p>
          ) : templates.length === 0 ? (
            <p className="mt-4 text-sm text-text-caption">
              No templates yet — ask the assistant to help you create one.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {templates.map((t) => {
                const updated = formatUpdated(t.updatedAt);
                const count = t.sections?.length;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        openDetail(t.id);
                      }}
                      className="flex w-full items-start justify-between gap-3 rounded-xl border border-border-default bg-surface px-4 py-3 text-left transition hover:border-border-strong hover:bg-subtle/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">
                          {t.name}
                        </p>
                        <p className="mt-0.5 text-xs text-text-caption">
                          {count != null
                            ? `${count} section${count === 1 ? "" : "s"}`
                            : "Open to view"}
                          {updated ? ` · Updated ${updated}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {t.isDefault ? (
                          <span className={chipClass(TONE_SUCCESS)}>Active</span>
                        ) : (
                          <span className="text-xs text-text-caption">
                            Inactive
                          </span>
                        )}
                        <span className="text-xs font-medium text-brand">
                          Open →
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {view === "detail" && openTemplate ? (
        <>
          <BackLink onClick={backToList}>All templates</BackLink>

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className={PAGE_H1_CLASS}>{openTemplate.name}</h1>
              <p className="mt-1 text-sm text-text-caption">
                {openTemplate.isDefault ? (
                  <>
                    <span className={chipClass(TONE_SUCCESS)}>Active</span>
                    <span className="ml-2">
                      Used for new {documentLabel}s on deals
                    </span>
                  </>
                ) : (
                  "Not active — new documents still use your Active template"
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!openTemplate.isDefault ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy}
                  onClick={() => void onSetActive(openTemplate.id)}
                >
                  Set active
                </Button>
              ) : null}
              <Button
                type="button"
                variant={editing ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => {
                  if (editing) {
                    setName(openTemplate.name);
                    setSections(openTemplate.sections ?? []);
                  }
                  setEditing((v) => !v);
                }}
              >
                {editing ? "Cancel edit" : "Edit"}
              </Button>
              {deleteTemplate && templates.length > 1 ? (
                <ConfirmDeleteButton
                  name={openTemplate.name}
                  entityLabel="template"
                  consequence={
                    openTemplate.isDefault
                      ? "Another template will become Active. Existing proposals keep their content."
                      : "Existing proposals keep their content; only this template is removed."
                  }
                  disabled={busy}
                  onConfirm={async () => {
                    setBusy(true);
                    try {
                      const result = await deleteTemplate(openTemplate.id);
                      if (!result.ok) return result;
                      setEditing(false);
                      setOpenId(null);
                      setView("list");
                      await onReload();
                      return { ok: true as const };
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              ) : null}
            </div>
          </div>

          {!editing ? (
            <div className="mt-6 space-y-4">
              {(detailBlueprint ?? openTemplate.blueprint) ? (
                <div className="overflow-hidden rounded-xl border border-border-default bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <DocumentBlueprintView
                    blueprint={detailBlueprint ?? openTemplate.blueprint!}
                    assets={detailAssets ?? openTemplate.assets}
                    sections={sections}
                    tokens={documentPreviewTokens(documentLabel)}
                    className="bg-white p-2 sm:p-4"
                  />
                </div>
              ) : (
                sections.map((section, idx) => (
                  <article
                    key={section.id}
                    className="rounded-xl border border-border-default bg-surface p-4"
                  >
                    <p className="text-xs font-medium text-text-caption">
                      Section {idx + 1}
                    </p>
                    <h3 className="mt-1 text-sm font-semibold text-text-primary">
                      {toReadablePlainText(section.title || "Untitled")}
                    </h3>
                    <RichStructuredContent
                      className="mt-2"
                      html={formatSectionBodyHtml(section.body)}
                      variant="document"
                    />
                  </article>
                ))
              )}
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <Input
                label="Template name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {sections.map((section, idx) => (
                <div
                  key={section.id}
                  className="rounded-xl border border-border-default p-4"
                >
                  <p className="mb-2 text-xs font-medium text-text-caption">
                    Section {idx + 1}
                  </p>
                  <Input
                    label="Heading"
                    value={section.title}
                    onChange={(e) =>
                      updateSection(idx, { title: e.target.value })
                    }
                  />
                  <div className="mt-3">
                    <Textarea
                      label="Content"
                      rows={sectionBodyRows}
                      value={section.body}
                      onChange={(e) =>
                        updateSection(idx, { body: e.target.value })
                      }
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void onSaveDetail()}
              >
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </>
      ) : null}

      {view === "create" ? (
        <div className="mt-2">
          <BackLink onClick={backToList}>All templates</BackLink>
          <h1 className={`mt-4 ${PAGE_H1_CLASS}`}>
            {chat.createName
              ? chat.createName
              : `Creating a ${documentLabel} template`}
          </h1>
          <p className="mt-1 text-sm text-text-caption">
            {currentStep === "done"
              ? "Review the draft, then save. Use Save & set active so new documents use this design."
              : chat.createBlueprint?.mode === "page-clone"
                ? "Exact clone of your sample — edit text or logo in chat, then save below."
                : chat.createBlueprint
                  ? "Draft ready — save below or continue in chat."
                  : sampleFile
                    ? "Sample attached — name the template (if needed), then we’ll analyze the PDF automatically."
                    : "Continue with the assistant in chat — replies appear on the left."}
          </p>
          {chat.createBlueprint ? (
            <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
              <DocumentBlueprintView
                blueprint={chat.createBlueprint}
                assets={chat.createAssets}
                sections={chat.createSections}
                tokens={documentPreviewTokens(documentLabel)}
                className="bg-white p-2 sm:p-4"
              />
            </div>
          ) : null}
          {currentStep === "done" && chat.createName.trim().length >= 2 ? (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void finishCreate("Save & set active", true)}
              >
                {busy ? "Saving…" : "Save & set active"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void finishCreate("Save (inactive)", false)}
              >
                Save (inactive)
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
        </div>
      </div>
    </ConfigurationShell>
  );

  return (
    <div
      role="region"
      aria-label={`${shellTitle} — agent and workspace`}
      className="flex h-full min-h-0 flex-col bg-[#f3f4f6]"
    >
      <div
        className={
          pageFull ? "min-h-0 flex-1 p-0" : "min-h-0 flex-1 p-2"
        }
      >
        <CoworkerWorkspace
          expand={expand}
          balance="agent"
          workspaceFullCollapse
          mobileTab={mobileTab}
          onMobileTab={setMobileTab}
          draftTabLabel="Workspace"
          collapsedChat={
            <CoworkerChatFab
              onExpand={() => {
                setExpand("default");
                setMobileTab("chat");
              }}
              sending={busy}
            />
          }
          chat={
            <CoworkerChatShell
              title="Template assistant"
              messages={coworkerMessages}
              input={composer}
              onInputChange={setComposer}
              onSend={() => void handleChatSend()}
              onRestart={restartChat}
              sending={busy}
              placeholder={chatPlaceholder}
              footerHint={chatFooterHint}
              onExpand={() => toggleExpand("chat")}
              expanded={expand === "chat"}
              expandLabel={
                expand === "chat" ? "Restore layout" : "Expand chat"
              }
              widePanel={expand === "chat"}
              onMinimize={() => {
                toggleExpand("draft");
              }}
              fileAttachOpenRef={openFileAttachRef}
              fileAttach={{
                accept: `${sampleAcceptForDocument(documentLabel)},${LOGO_ACCEPT}`,
                onFile: onPickUploadFile,
                ariaLabel: "Attach sample document or logo image",
                title: isQuoteDocument(documentLabel)
                  ? "PDF/DOCX sample or logo (PNG, JPEG, WebP, SVG)"
                  : "PDF/DOCX sample or logo (PNG, JPEG, WebP, SVG)",
                disabled: busy,
              }}
            />
          }
          draft={
            <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-neutral-200/80 px-3">
                <p className="min-w-0 truncate text-sm font-semibold text-neutral-900">
                  Workspace
                </p>
                <button
                  type="button"
                  onClick={() => toggleExpand("draft")}
                  className="hidden size-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-800 hover:bg-neutral-100 lg:inline-flex"
                  aria-label={
                    expand === "draft" ? "Restore layout" : "Expand workspace"
                  }
                  title={
                    expand === "draft" ? "Restore layout" : "Expand workspace"
                  }
                >
                  {expand === "draft" ? (
                    <Shrink className="size-3.5" strokeWidth={1.75} />
                  ) : (
                    <Expand className="size-3.5" strokeWidth={1.75} />
                  )}
                </button>
              </div>
              <div className="@container scrollbar-hover min-h-0 flex-1 overflow-auto">
                {workspaceBody}
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
