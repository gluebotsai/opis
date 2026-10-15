export type SipDialogLeg = "customer" | "consult";

export type SipDialogIdentity = {
  callId: string;
  localTag: string | null;
  remoteTag: string | null;
};

export type SipDialogMessage = SipDialogIdentity & {
  method: string;
};

type RegisteredDialog = SipDialogIdentity & {
  leg: SipDialogLeg;
};

function headerValue(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

function tagFromHeader(value: string | null): string | null {
  return value?.match(/(?:^|;)\s*tag=([^;>\s]+)/i)?.[1]?.trim() || null;
}

export function parseSipDialogMessage(raw: string): SipDialogMessage | null {
  const method = raw.split(/\r\n|\n/, 1)[0]?.trim().split(/\s+/, 1)[0]?.toUpperCase();
  const callId = headerValue(raw, "Call-ID") ?? headerValue(raw, "i");
  if (!method || !callId) return null;
  return {
    method,
    callId,
    localTag: tagFromHeader(headerValue(raw, "To") ?? headerValue(raw, "t")),
    remoteTag: tagFromHeader(headerValue(raw, "From") ?? headerValue(raw, "f")),
  };
}

function tagsMatch(dialog: RegisteredDialog, message: SipDialogMessage): boolean {
  const known = [dialog.localTag, dialog.remoteTag].filter(Boolean);
  const received = [message.localTag, message.remoteTag].filter(Boolean);
  if (known.length === 0 || received.length === 0) return true;
  return received.every((tag) => known.includes(tag));
}

export class SipDialogRegistry {
  private readonly dialogs = new Map<string, RegisteredDialog[]>();

  register(identity: SipDialogIdentity, leg: SipDialogLeg): void {
    const callId = identity.callId.trim();
    if (!callId) return;
    const next: RegisteredDialog = { ...identity, callId, leg };
    const existing = this.dialogs.get(callId) ?? [];
    this.dialogs.set(callId, [
      ...existing.filter(
        (dialog) =>
          dialog.leg !== leg ||
          dialog.localTag !== identity.localTag ||
          dialog.remoteTag !== identity.remoteTag,
      ),
      next,
    ]);
  }

  unregisterLeg(leg: SipDialogLeg): void {
    for (const [callId, dialogs] of this.dialogs) {
      const remaining = dialogs.filter((dialog) => dialog.leg !== leg);
      if (remaining.length > 0) this.dialogs.set(callId, remaining);
      else this.dialogs.delete(callId);
    }
  }

  resolve(raw: string): { leg: SipDialogLeg; message: SipDialogMessage } | null {
    const message = parseSipDialogMessage(raw);
    if (!message) return null;
    const dialog = (this.dialogs.get(message.callId) ?? []).find((candidate) =>
      tagsMatch(candidate, message),
    );
    return dialog ? { leg: dialog.leg, message } : null;
  }

  clear(): void {
    this.dialogs.clear();
  }
}
