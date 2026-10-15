import React from 'react';

type CopilotMarkProps = {
  className?: string;
};

export default function CopilotMark({ className = 'h-7 w-7' }: CopilotMarkProps) {
  return (
    <img
      src="/brand/copilot-logo.png"
      alt=""
      className={`object-contain shrink-0 ${className}`}
    />
  );
}
