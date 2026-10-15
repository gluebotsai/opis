Domain ownership (pick exactly one when Super action is analytics):

| domain | Use when the user wants |
|--------|-------------------------|
| site_kpi | A single headline number or rate: visitors, sessions, page views, bounce, clicks, conversions, duration, new/returning |
| breakdown | Split by country, city, device, browser, traffic source, campaign — "by X" |
| ranking | **Which / top / most / least**: products, pages, visitors — ordered list or single winner (limit 1) |
| drilldown | Visitor or session timeline when they name visitor_id or session |

Put their exact intent into "objective" in English:
- For **product** questions (visited, viewed, popular, least popular): say **product catalog / PDP**, not site pages.
- For **most vs least**: objective must include the words **most** or **least** (or top/bottom) so the Executor sets sort_direction.
- Include dashboard period when the UI pill applies.
- Distinguish visitors vs sessions vs page views vs **products**.

Do not put metric ids in objective — the Executor chooses ids from the ontology slice.
