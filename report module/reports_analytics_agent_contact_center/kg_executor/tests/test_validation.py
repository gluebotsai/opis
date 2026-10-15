from __future__ import annotations

import glob
import re
import unittest
from pathlib import Path
import yaml

from kg_executor.validate_cypher_tool import inspect_cypher, validate_cypher
from kg_executor.core.cypher_guard import guard_cypher, CypherGuardError
from kg_executor.core.run_cypher import run_cypher, load_kg_templates


class TestKGValidation(unittest.TestCase):
    def setUp(self):
        self.root_dir = Path(__file__).resolve().parents[2]
        self.kg_dir = Path(__file__).resolve().parents[1] / "kg"
        self.skills_dir = Path(__file__).resolve().parents[1] / "skills"

    def test_templates_validation(self):
        templates_path = self.kg_dir / "templates.yml"
        self.assertTrue(templates_path.exists(), f"Missing templates.yml at {templates_path}")
        with open(templates_path) as f:
            data = yaml.safe_load(f)
        templates = data.get("templates", {})
        self.assertGreater(len(templates), 0)

        for name, item in templates.items():
            cypher = item.get("cypher", "")
            result = validate_cypher(cypher)
            self.assertTrue(
                result["is_valid"],
                f"Template '{name}' failed validation: {result.get('error')}"
            )

    def test_examples_validation(self):
        examples_path = self.kg_dir / "examples" / "cypher.yml"
        self.assertTrue(examples_path.exists(), f"Missing cypher.yml at {examples_path}")
        with open(examples_path) as f:
            data = yaml.safe_load(f)
        examples = data.get("examples", [])
        self.assertGreater(len(examples), 0)

        for idx, item in enumerate(examples):
            cypher = item.get("cypher", "")
            example_id = item.get("id", f"example_{idx}")
            result = validate_cypher(cypher)
            self.assertTrue(
                result["is_valid"],
                f"Example '{example_id}' failed validation: {result.get('error')}"
            )

    def test_skill_markdown_queries(self):
        skill_files = list(self.skills_dir.glob("*.md"))
        self.assertGreater(len(skill_files), 0, "No skill files found in skills/")

        cypher_block_re = re.compile(r"```(?:cypher|neo4j)?\s*\n(MATCH[\s\S]*?)```")
        tested_queries = 0

        for sf in skill_files:
            content = sf.read_text(encoding="utf-8")
            queries = cypher_block_re.findall(content)
            for q in queries:
                q_clean = q.strip()
                if not q_clean:
                    continue
                tested_queries += 1
                result = validate_cypher(q_clean)
                self.assertTrue(
                    result["is_valid"],
                    f"Query in skill file '{sf.name}' failed validation: {result.get('error')}\nQuery:\n{q_clean}"
                )

        self.assertGreater(tested_queries, 0, "No Cypher queries found in skills/*.md")

    def test_security_guardrails(self):
        # 1. Prohibit mutations
        mutation_query = "CREATE (c:Conversation {id: '123'}) RETURN c LIMIT 10"
        res = validate_cypher(mutation_query)
        self.assertFalse(res["is_valid"])

        # 2. Prohibit foreign product domain (Ticket)
        ticket_query = "MATCH (t:Ticket) RETURN t.id LIMIT 10"
        res = validate_cypher(ticket_query)
        self.assertFalse(res["is_valid"])

        # 3. Prohibit variable length hops
        hop_query = "MATCH (c:Conversation)-[:ROUTED_TO*1..3]->(q:ContactCentreQueue) RETURN count(c) LIMIT 10"
        res = validate_cypher(hop_query)
        self.assertFalse(res["is_valid"])

        # 4. Prohibit APOC calls
        apoc_query = "CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'RETURN n', {})"
        res = validate_cypher(apoc_query)
        self.assertFalse(res["is_valid"])

    def test_dynamic_parameter_binding(self):
        res = run_cypher(
            template_name="abandonment_and_disconnect_analysis",
            organization_id=1001,
            user_id=42,
            role="admin",
            queue_ids=[101, 102],
            params={"channel": "call"}
        )
        self.assertEqual(res.get("status"), "compiled")
        self.assertIn("cypher", res)
        # Verify no hardcoded demo orgs or demo queue IDs
        self.assertNotIn("1029", res["cypher"])
        self.assertNotIn("support_queue_1", res["cypher"])

    def test_skills_loader(self):
        from kg_executor.skills import catalog, load_skill, compose_with_skill, SKILL_FILE_MAP
        skills_list = catalog()
        self.assertEqual(len(skills_list), len(SKILL_FILE_MAP))
        for skill_name in SKILL_FILE_MAP:
            body = load_skill(skill_name)
            self.assertGreater(len(body), 50, f"Skill {skill_name} body empty")
            composed = compose_with_skill("Base prompt", skill_name)
            self.assertIn("## attached skill", composed)


if __name__ == "__main__":
    unittest.main()

