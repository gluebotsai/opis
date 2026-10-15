/**
 * Replace logo / hero / footer images on proposal or quote documents.
 */

import {
  parseBlueprintAssets,
  type BlueprintAsset,
} from "@/lib/document-blueprint";
import { getProposal, updateProposal } from "@/dao/sales/proposal-service";
import { getQuote, updateQuote } from "@/dao/sales/quote-service";

async function loadImageBase64(input: {
  imageUrl?: string | null;
  dataBase64?: string | null;
  mime?: string | null;
}): Promise<{ dataBase64: string; mime: string }> {
  const rawB64 = input.dataBase64?.trim() || "";
  if (rawB64) {
    const mime =
      input.mime?.trim() ||
      (rawB64.startsWith("/9j/") ? "image/jpeg" : "image/png");
    return { dataBase64: rawB64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""), mime };
  }
  const url = input.imageUrl?.trim() || "";
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("Provide imageUrl (https) or dataBase64 for the new image.");
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Could not fetch image (${res.status}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 2_500_000) {
    throw new Error("Image is too large (max ~2.5MB).");
  }
  const mime =
    input.mime?.trim() ||
    res.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  if (!mime.startsWith("image/")) {
    throw new Error("URL must point to an image file.");
  }
  return { dataBase64: buf.toString("base64"), mime };
}

function mergeAsset(
  assets: BlueprintAsset[],
  assetId: string,
  kind: "logo" | "image",
  next: { dataBase64: string; mime: string },
): BlueprintAsset[] {
  const id = assetId.trim() || "logo";
  const out = assets.filter((a) => a.id !== id);
  out.push({
    id,
    kind: id === "logo" || id === "footer" ? (id as "logo" | "image") : kind,
    mime: next.mime,
    dataBase64: next.dataBase64,
  });
  return out;
}

export async function updateProposalDocumentAssetCommand(
  proposalId: string,
  input: {
    assetId?: string;
    imageUrl?: string;
    dataBase64?: string;
    mime?: string;
    kind?: "logo" | "image";
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string; status?: number }> {
  try {
    const existing = await getProposal(proposalId);
    if (!existing) {
      return { ok: false, error: "Proposal not found.", status: 404 };
    }
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft proposals can change logo or images.",
        status: 400,
      };
    }
    const loaded = await loadImageBase64(input);
    const assets = mergeAsset(
      parseBlueprintAssets(existing.assets),
      input.assetId?.trim() || "logo",
      input.kind === "image" ? "image" : "logo",
      loaded,
    );
    await updateProposal(proposalId, { assets });
    return { ok: true, id: proposalId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update image.",
    };
  }
}

export async function updateQuoteDocumentAssetCommand(
  quoteId: string,
  input: {
    assetId?: string;
    imageUrl?: string;
    dataBase64?: string;
    mime?: string;
    kind?: "logo" | "image";
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string; status?: number }> {
  try {
    const existing = await getQuote(quoteId);
    if (!existing) {
      return { ok: false, error: "Quote not found.", status: 404 };
    }
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Only draft quotes can change logo or images.",
        status: 400,
      };
    }
    const loaded = await loadImageBase64(input);
    const assets = mergeAsset(
      parseBlueprintAssets(existing.assets),
      input.assetId?.trim() || "logo",
      input.kind === "image" ? "image" : "logo",
      loaded,
    );
    await updateQuote(quoteId, { assets });
    return { ok: true, id: quoteId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update image.",
    };
  }
}
