import callIcon from "@/assets/channels/call.svg?raw";
import emailIcon from "@/assets/channels/email.svg?raw";
import facebookIcon from "@/assets/channels/facebook.svg?raw";
import instagramIcon from "@/assets/channels/instagram.svg?raw";
import smsIcon from "@/assets/channels/sms.svg?raw";
import videoIcon from "@/assets/channels/video.svg?raw";
import voicemailIcon from "@/assets/channels/voicemail.svg?raw";
import chatIcon from "@/assets/channels/web-chat.svg?raw";
import whatsappIcon from "@/assets/channels/whatsapp.svg?raw";
import type { WorkspaceChannel } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

type WorkspaceChannelIconProps = {
  channel: WorkspaceChannel | string;
  className?: string;
};

const CHANNEL_ICON_SVG: Record<WorkspaceChannel, string> = {
  chat: chatIcon,
  email: emailIcon,
  whatsapp: whatsappIcon,
  voice: callIcon,
  instagram: instagramIcon,
  facebook: facebookIcon,
};

const EXTRA_ICON_SVG: Record<string, string> = {
  sms: smsIcon,
  video: videoIcon,
  voicemail: voicemailIcon,
};

const CHANNEL_ALIASES: Record<string, WorkspaceChannel> = {
  chat: "chat",
  webchat: "chat",
  "web chat": "chat",
  email: "email",
  whatsapp: "whatsapp",
  voice: "voice",
  call: "voice",
  calls: "voice",
  instagram: "instagram",
  facebook: "facebook",
};

function channelIconSvg(channel: string): string {
  const key = channel.trim().toLowerCase();
  const extra = EXTRA_ICON_SVG[key];
  if (extra) return extra;
  const mapped = CHANNEL_ALIASES[key] ?? "chat";
  return CHANNEL_ICON_SVG[mapped];
}

export function WorkspaceChannelIcon({ channel, className }: WorkspaceChannelIconProps) {
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 overflow-hidden rounded-[4px] [&_svg]:block [&_svg]:size-full",
        className,
      )}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: channelIconSvg(channel) }}
    />
  );
}
