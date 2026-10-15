import { useState } from 'react';

export default function CopyId({ value, label = 'ID', className = '' }) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  return (
    <button
      type="button"
      className={`copy-id-btn${className ? ` ${className}` : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
