"""Applicator — write all downstream artifacts after approval gate."""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from ontology_steward.models import ApplyGate, Proposal, ProposalDecision, StewardContext
from ontology_steward.tools.registry_io import add_promotion, add_stop_key
from ontology_steward.tools.slice_writer import check_slice_scope


class Applicator:
    def __init__(self, pipeline_root: Path, semantic_root: Path, push_meili: bool = False):
        self.pipeline_root = pipeline_root
        self.semantic_root = semantic_root
        self.push_meili = push_meili

    def apply(self, ctx: StewardContext, proposal: Proposal, force: bool = False) -> dict[str, Any]:
        if proposal.gate == ApplyGate.HUMAN and not force:
            return self._queue(proposal)

        steps: list[str] = []
        errors: list[str] = []

        stop_key = (proposal.cdc or {}).get("stop_dynamic_key")
        if stop_key:
            add_stop_key(proposal.org, proposal.table, stop_key)
            steps.append("stop_keys")

        self._write_org_overlay(proposal)
        steps.append("org_overlay")

        if proposal.decision == ProposalDecision.NEW_CLASS:
            self._write_slice_module(proposal)
            steps.append("slice_module")
            self._register_catalog_module(proposal)
            steps.append("catalog")
            add_promotion(
                proposal.class_id or "",
                proposal.org,
                proposal.industry,
                proposal.graph_label or "",
            )
            steps.append("promotion")

        if proposal.shopify_category_gid or proposal.term_id:
            self._write_taxonomy_term(proposal)
            steps.append("taxonomy")

        mig = self._write_migration_artifact(proposal)
        if mig:
            steps.append("migration_cypher")

        self._clear_loader_cache(proposal.org)
        steps.append("cache_clear")

        val = self._run_validate()
        steps.append("validate")
        if not val.get("ok"):
            errors.append(val.get("stderr") or val.get("error") or "validate failed")

        meili = self._rebuild_meili(dry_run=not self.push_meili)
        steps.append("meili_build")
        if not meili.get("ok"):
            errors.append(meili.get("stderr") or meili.get("error") or "meili build failed")

        if self.push_meili:
            push = self._push_meili()
            steps.append("meili_push")
            if not push.get("ok"):
                errors.append(push.get("error") or "meili push failed")

        if proposal.decision == ProposalDecision.NEW_CLASS and proposal.class_id:
            scope = check_slice_scope(
                self.semantic_root,
                proposal.org,
                proposal.class_id,
                proposal.industry or "generic",
            )
            steps.append("slice_scope")
            if not scope.get("included"):
                errors.append(f"slice missing {proposal.class_id} after apply")

        self._write_proposal_record(proposal, "approved")
        steps.append("proposal_archived")

        ctx.log("applicator", "applied", steps=steps, proposal=proposal.to_dict())
        return {"ok": not errors, "steps": steps, "errors": errors}

    def _clear_loader_cache(self, org: str) -> None:
        try:
            from src.config_loader import ConfigLoader

            loader = ConfigLoader(self.pipeline_root / "config")
            loader.clear_cache(f"org{org}")
        except Exception:
            pass

    def _queue(self, proposal: Proposal) -> dict[str, Any]:
        path = self._write_proposal_record(proposal, "pending")
        return {"ok": True, "queued": str(path)}

    def _write_proposal_record(self, proposal: Proposal, status: str) -> Path:
        proposals_dir = self.pipeline_root / "ontology_steward" / "proposals" / status
        proposals_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = proposals_dir / f"{proposal.org}_{proposal.field}_{ts}.yml"
        doc = proposal.to_dict()
        doc["status"] = status
        doc["applied_at"] = ts
        path.write_text(yaml.safe_dump(doc, sort_keys=False), encoding="utf-8")
        return path

    def _write_org_overlay(self, proposal: Proposal) -> None:
        org_path = self.pipeline_root / "config" / "mappings" / f"org{proposal.org}.yaml"
        if not org_path.exists():
            base = {
                "database": f"org{proposal.org}",
                "organization_id": str(proposal.org),
                "products": ["platform"],
                "extends": {},
            }
        else:
            base = yaml.safe_load(org_path.read_text(encoding="utf-8")) or {}

        extends = base.setdefault("extends", {})
        tbl_ext = extends.setdefault(proposal.table, {})

        stop_key = (proposal.cdc or {}).get("stop_dynamic_key")
        if stop_key:
            cf = tbl_ext.setdefault("custom_fields", {})
            bl = list(cf.get("blocklist") or [])
            if stop_key not in bl:
                bl.append(stop_key)
            cf["blocklist"] = bl

        mode = (proposal.cdc or {}).get("mode")
        if mode == "property" and proposal.class_id:
            props = tbl_ext.setdefault("custom_properties", [])
            props.append({"name": proposal.field, "type": "string"})
        elif mode == "node" and proposal.graph_label:
            promote = tbl_ext.setdefault("promote_property_to_node", {})
            promote[proposal.field] = {
                "label": proposal.graph_label,
                "key": "uid",
                "name_from": proposal.field,
                "edge": (proposal.relation or {}).get("type", "RELATED_TO"),
            }
        elif mode == "taxonomy_term" and proposal.shopify_category_gid:
            props = tbl_ext.setdefault("custom_properties", [])
            props.append({"name": f"{proposal.field}_shopify_gid", "type": "string"})
            if proposal.google_product_category:
                props.append({"name": f"{proposal.field}_google_id", "type": "string"})
        elif mode == "shopify_attribute" and proposal.shopify_attributes:
            props = tbl_ext.setdefault("custom_properties", [])
            for attr in proposal.shopify_attributes:
                props.append(
                    {
                        "name": f"{proposal.field}_{attr.get('name', 'attr').lower()}",
                        "type": "string",
                    }
                )

        org_path.write_text(yaml.safe_dump(base, sort_keys=False), encoding="utf-8")

    def _write_slice_module(self, proposal: Proposal) -> None:
        if not proposal.class_id:
            return
        slug = proposal.class_id.replace("wt:", "")
        module_path = self.semantic_root / "ontology" / "modules" / f"{slug}.yml"
        if module_path.exists():
            return
        module_path.write_text(
            yaml.safe_dump(
                {
                    "id": proposal.class_id,
                    "label": proposal.graph_label,
                    "description": proposal.rationale or f"Steward-minted {proposal.class_id}",
                    "classes": [
                        {
                            "id": proposal.class_id,
                            "label": proposal.graph_label,
                            "description": proposal.rationale,
                        }
                    ],
                    "relations": [],
                    "actions": [],
                    "metric_ids": [],
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        sem_path = self.semantic_root / "tenants" / f"org{proposal.org}" / "semantic.yaml"
        if sem_path.exists():
            sem = yaml.safe_load(sem_path.read_text(encoding="utf-8")) or {}
            extras = list(sem.get("extra_modules") or [])
            if slug not in extras:
                extras.append(slug)
            sem["extra_modules"] = extras
            sem_path.write_text(yaml.safe_dump(sem, sort_keys=False), encoding="utf-8")

        noun_path = self.semantic_root / "ontology" / "noun_map.yml"
        if noun_path.exists():
            nouns = yaml.safe_load(noun_path.read_text(encoding="utf-8")) or {}
            if proposal.graph_label and proposal.graph_label not in nouns:
                nouns[proposal.graph_label] = proposal.class_id
                noun_path.write_text(yaml.safe_dump(nouns, sort_keys=False), encoding="utf-8")

        types_path = self.pipeline_root / "ontology_steward" / "registry" / "types.yml"
        doc = yaml.safe_load(types_path.read_text(encoding="utf-8")) or {}
        types = list(doc.get("types") or [])
        if not any(t.get("class_id") == proposal.class_id for t in types):
            types.append(
                {
                    "class_id": proposal.class_id,
                    "graph_label": proposal.graph_label,
                    "pack": proposal.industry,
                    "status": "tenant_only",
                    "definition": proposal.rationale,
                }
            )
        doc["types"] = types
        types_path.write_text(yaml.safe_dump(doc, sort_keys=False), encoding="utf-8")

    def _register_catalog_module(self, proposal: Proposal) -> None:
        if not proposal.class_id:
            return
        slug = proposal.class_id.replace("wt:", "")
        catalog_path = self.semantic_root / "ontology" / "catalog.yml"
        if not catalog_path.exists():
            return
        doc = yaml.safe_load(catalog_path.read_text(encoding="utf-8")) or {}
        modules = doc.setdefault("modules", {})
        if slug in modules:
            return
        modules[slug] = {
            "file": f"modules/{slug}.yml",
            "layer": "domain",
            "usecase": proposal.rationale or f"Steward-minted {proposal.class_id}",
            "depends_on": ["core"],
            "select_when": f"Org {proposal.org} extra_modules includes {slug}",
        }
        catalog_path.write_text(yaml.safe_dump(doc, sort_keys=False), encoding="utf-8")

    def _write_taxonomy_term(self, proposal: Proposal) -> None:
        tax_path = self.semantic_root / "ontology" / "taxonomy.yml"
        doc: dict[str, Any] = {}
        if tax_path.exists():
            doc = yaml.safe_load(tax_path.read_text(encoding="utf-8")) or {}
        terms = list(doc.get("terms") or [])
        term_id = proposal.term_id or proposal.shopify_category_gid
        if not term_id:
            return
        if not any(t.get("id") == term_id for t in terms):
            terms.append(
                {
                    "id": term_id,
                    "label": proposal.field,
                    "class_id": proposal.class_id or "wt:Offering",
                    "google_product_category": proposal.google_product_category,
                }
            )
        doc["terms"] = terms
        tax_path.write_text(yaml.safe_dump(doc, sort_keys=False), encoding="utf-8")

    def _write_migration_artifact(self, proposal: Proposal) -> Path | None:
        if not (proposal.cdc or {}).get("stop_dynamic_key"):
            return None
        mig_dir = self.pipeline_root / "ontology_steward" / "proposals" / "migrations"
        mig_dir.mkdir(parents=True, exist_ok=True)
        path = mig_dir / f"{proposal.org}_{proposal.field}.cypher"
        path.write_text(self.migration_cypher(proposal), encoding="utf-8")
        return path

    def _run_validate(self) -> dict[str, Any]:
        try:
            proc = subprocess.run(
                [
                    sys.executable,
                    str(self.pipeline_root / "main.py"),
                    "validate",
                    "--config",
                    str(self.pipeline_root / "config"),
                ],
                cwd=str(self.pipeline_root),
                capture_output=True,
                text=True,
                timeout=120,
            )
            return {"ok": proc.returncode == 0, "stdout": proc.stdout, "stderr": proc.stderr}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _rebuild_meili(self, dry_run: bool = True) -> dict[str, Any]:
        script = self.pipeline_root / "scripts" / "build_meilisearch_ontology.py"
        if not script.exists():
            return {"ok": True, "skipped": True}
        try:
            args = [sys.executable, str(script)]
            if dry_run:
                args.append("--dry-run")
            proc = subprocess.run(
                args,
                cwd=str(self.pipeline_root),
                capture_output=True,
                text=True,
                timeout=120,
            )
            return {"ok": proc.returncode == 0, "stdout": proc.stdout, "stderr": proc.stderr}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _push_meili(self) -> dict[str, Any]:
        url = os.environ.get("MEILI_URL")
        key = os.environ.get("MEILI_KEY")
        index = os.environ.get("MEILI_INDEX", "graph_onto")
        if not url or not key:
            return {"ok": True, "skipped": True, "reason": "MEILI_URL/MEILI_KEY not set"}
        script = self.pipeline_root / "scripts" / "push_to_meilisearch.py"
        if not script.exists():
            return {"ok": True, "skipped": True}
        try:
            proc = subprocess.run(
                [sys.executable, str(script), "--url", url, "--key", key, "--index", index],
                cwd=str(self.pipeline_root),
                capture_output=True,
                text=True,
                timeout=120,
            )
            return {"ok": proc.returncode == 0, "stdout": proc.stdout, "stderr": proc.stderr}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def migration_cypher(self, proposal: Proposal, custom_prefix: str = "custom_") -> str:
        """Documented one-shot: move custom_* off Contact to new node."""
        key = proposal.field
        label = proposal.graph_label or "Extension"
        return f"""
// Migrate org {proposal.org}: {key}
MATCH (c:Contact)
WHERE c.{custom_prefix}{key} IS NOT NULL
MERGE (n:{label} {{uid: c.cdp_id + '-{key}'}})
SET n.value = c.{custom_prefix}{key}
MERGE (c)-[:{(proposal.relation or {}).get('type', 'RELATED_TO')}]->(n)
REMOVE c.{custom_prefix}{key}
""".strip()
