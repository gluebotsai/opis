'use client';

import Script from 'next/script';

/** Same as old loader — only init keys renamed + organizationId added. */
export default function WorktualAnalyticsLoader() {
  return (
    <Script
      src="https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js"
      strategy="afterInteractive"
      onReady={() => {
        window.WorktualAnalytics?.init({
          websiteId: 12345,
          websiteUrl: 'https://beta.worktual.co.uk',
          organizationId: 1,
          endpoint:
            'https://tracking.worktual.co.uk/webtracking/v1/tracking/nfs-ingestions',
          trackForms: true,
          leadFormAutoScan: true,
          leadFormHeuristicScan: true,
          leadForms: [
            {
              formId: 'contact_sales',
              root: '[class*="contact_formblock"]',
              submit: 'button[type="submit"]',
            },
            {
              formId: 'book_demo',
              root: '[class*="book_formblock"]',
              submit: 'button[type="submit"]',
            },
          ],
          autoTrack: true,
          geolocation: true,
          fetchClientIp: true,
          respectDNT: false,
          respectGPC: false,
        });
      }}
    />
  );
}

declare global {
  interface Window {
    WorktualAnalytics?: {
      init: (config: Record<string, unknown>) => unknown;
      flush: () => Promise<boolean>;
    };
  }
}
