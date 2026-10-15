export const STARTER_SUGGESTIONS = [
  'How many visitors came today?',
  'Show top 10 pages by views this week.',
  'Which country has the most sessions this month?',
];

export const EMBEDDED_WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  text: "I'm your Worktual co-worker on the Dashboard. Ask about visitor volume, bounce rate, traffic sources, page views, geography, or trends for the period shown on the right — I'll pull the numbers here. I can also help you open visitors, sessions, or behavior views.",
  suggestions: [],
};

export const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  text: 'Hello! I can help you analyze visitors, sessions, page views, traffic sources, bounce rate, geography, and more. What would you like to know?',
  suggestions: STARTER_SUGGESTIONS,
};

export const POLITE_TRY_AGAIN =
  "I wasn't able to finish that just now. Please try again in a moment — I'm happy to help with your site analytics.";

export const POLITE_CHAT_CONNECTING =
  'Connecting to co-worker — your question will send automatically in a moment.';

export const POLITE_SESSION_EXPIRED =
  'Your session has expired. Please sign in again to continue chatting about your analytics.';

export const POLITE_CHAT_AUTH_FAILED =
  'I could not connect to analytics chat with your login. Try signing out and back in, or refresh the page.';

export const POLITE_NO_DOMAIN =
  "Your account isn't linked to a site yet. Your administrator can set that up, and then I'll be glad to help.";

export function assistantMessage(text, suggestions = []) {
  return { role: 'assistant', text, suggestions };
}
