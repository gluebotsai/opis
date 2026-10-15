import sys
import json
import re
import httpx
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import reports_analytics_agent_CRM_B2B.core.run_sql as sql_mod
import reports_analytics_agent_CRM_B2B.core.examples as ex_mod
import reports_analytics_agent_CRM_B2B.core.facts as facts_mod
import reports_analytics_agent_CRM_B2B.core.grounding as ground_mod

from reports_analytics_agent_CRM_B2B.core.prompt_load import load_agent_prompt

domain_prompt = load_agent_prompt(ROOT / 'reports_analytics_agent_CRM_B2B' / 'domain' / 'agent.md')
sql_prompt = load_agent_prompt(ROOT / 'reports_analytics_agent_CRM_B2B' / 'sql_executor' / 'agent.md')
ex_list = ex_mod.load_examples('reports_analytics_agent_CRM_B2B/product/examples/sql.yml')

query = 'how many deals are there for sales rep 1017'
print(f'User Query: {query}')

# 1. Domain Planning
client = httpx.Client(base_url='http://173.234.75.166:8011/v1', timeout=60.0)
plan_resp = client.post('/chat/completions', json={
    'model': 'worktual-gemma',
    'messages': [
        {'role': 'system', 'content': domain_prompt},
        {'role': 'user', 'content': f'Identity: role=admin, org_id=1003, user_id=1017\n\nQuestion: {query}'}
    ],
    'temperature': 0.1
})
raw_plan = plan_resp.json()['choices'][0]['message']['content']
print('\n--- Domain Plan Raw ---')
print(raw_plan)

# 2. Pick SQL Examples
chosen_ex = ex_mod.pick_examples(query, ex_list, top_k=4)
few_shot_txt = ex_mod.format_examples_for_prompt(chosen_ex)

# 3. SQL Executor
task_sql_prompt = f'{sql_prompt}\n\n## Few-Shot SQL Examples\n{few_shot_txt}'
sql_resp = client.post('/chat/completions', json={
    'model': 'worktual-gemma',
    'messages': [
        {'role': 'system', 'content': task_sql_prompt},
        {'role': 'user', 'content': f'Task Goal: Find all deals owned by sales rep 1017\ntime_params: overall / all-time (unbounded, no date filter)\nscope: org\nanswer_type: list'}
    ],
    'temperature': 0.1
})
raw_sql = sql_resp.json()['choices'][0]['message']['content']
print('\n--- SQL Executor Output ---')
print(raw_sql)

# 4. Extract SQL and Execute
match = re.search(r'```sql\s*(.*?)\s*```', raw_sql, re.DOTALL)
sql_to_run = match.group(1) if match else raw_sql.strip()

print('\n--- Executing Guarded SQL ---')
exec_res = sql_mod.run_sql(sql_to_run, organization_id=1003, user_id=1017, role='admin')
print('Status:', exec_res.get('status'))
print('Rows retrieved count:', len(exec_res.get('rows', [])))
for r in exec_res.get('rows', []):
    print(' ', r)

# 5. Assemble Facts
fact = facts_mod.assemble_facts(exec_res, task_goal=query, answer_type='list')
print('\n--- Assembled Fact ---')
print(fact)

# 6. Domain Synthesis
synthesis_prompt = f"You are the Lead Analyst briefing the CEO.\n\nOriginal Question: {query}\nFacts gathered:\n{fact}\n\nInstructions:\n- Lead with the exact primary number in the very first sentence.\n- Present the deals roster in a clean Markdown table with headers.\n- Explain business context concisely."
syn_resp = client.post('/chat/completions', json={
    'model': 'worktual-gemma',
    'messages': [
        {'role': 'system', 'content': 'Executive briefing synthesis.'},
        {'role': 'user', 'content': synthesis_prompt}
    ],
    'temperature': 0.1
})
final_briefing = syn_resp.json()['choices'][0]['message']['content']
print('\n--- Final Executive Briefing ---')
print(final_briefing)
