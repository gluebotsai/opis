Rewrite the latest user message as one **standalone** analytics question.

Use conversation history when the user says things like "what about…", "and clicks?", "same period", or refers to the previous metric without repeating it.

Rules:
- Keep the same intent (visitors vs sessions vs page views vs online now vs bounce).
- **Online / online now / who is online** → realtime; do not add "this month" or "30 days".
- When a dashboard period pill is provided (today | week | month | overall), use that window unless the user explicitly asked for a different range in this message.
- One clear English question; no metric ids or SQL.
- Keep **most** vs **least** / **top** vs **bottom** wording from the user (do not swap them).
- "Product visited/viewed" = ecommerce product (PDP), not website page URLs.

Output JSON only: { "standalone": "..." }
