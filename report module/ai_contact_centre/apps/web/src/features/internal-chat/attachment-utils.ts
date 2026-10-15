import type { InternalChatAttachment } from "@/features/internal-chat/types";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExtension(name: string): string {
  const parts = name.split(".");
  if (parts.length < 2) return "FILE";
  return (parts.pop() ?? "FILE").toUpperCase();
}

export function fileAccentClass(extension: string): string {
  switch (extension) {
    case "PDF":
      return "bg-red-500";
    case "DOC":
    case "DOCX":
      return "bg-blue-600";
    case "XLS":
    case "XLSX":
    case "CSV":
      return "bg-emerald-600";
    case "PPT":
    case "PPTX":
      return "bg-orange-500";
    case "PNG":
    case "JPG":
    case "JPEG":
    case "GIF":
    case "WEBP":
      return "bg-violet-500";
    case "ZIP":
    case "RAR":
      return "bg-amber-600";
    default:
      return "bg-neutral-500";
  }
}

export function attachmentPreviewLabel(attachment: InternalChatAttachment): string {
  return `📎 ${attachment.name}`;
}

export function attachmentsPreviewLabel(attachments: InternalChatAttachment[]): string {
  if (attachments.length === 0) return "";
  if (attachments.length === 1) {
    const attachment = attachments[0]!;
    if (isImageAttachment(attachment)) return "Photo";
    return attachmentPreviewLabel(attachment);
  }
  const imageCount = attachments.filter(isImageAttachment).length;
  if (imageCount === attachments.length) return `📷 ${attachments.length} photos`;
  return `📎 ${attachments.length} files`;
}

export function fileToAttachment(file: File): InternalChatAttachment {
  const attachment: InternalChatAttachment = {
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type,
  };
  if (isImageFile(file)) {
    attachment.previewUrl = URL.createObjectURL(file);
  }
  return attachment;
}

export function isImageAttachment(attachment: InternalChatAttachment): boolean {
  if (attachment.mimeType?.startsWith("image/")) return true;
  const ext = fileExtension(attachment.name);
  return ["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"].includes(ext);
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return isImageAttachment({ name: file.name, sizeBytes: file.size, mimeType: file.type });
}
