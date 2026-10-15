"""Vector-less lexical ranking over metrics, tables, columns, and gold examples."""

from __future__ import annotations

from typing import Any

from sql_agent.catalog import Catalog, GoldExample, Metric, TableCard
from sql_agent.glossary import expand_query
from sql_agent.textutil import similarity, tokenize


def _score_tokens(query_tokens: list[str], document: str) -> float:
    doc_tokens = tokenize(document)
    if not query_tokens or not doc_tokens:
        return 0.0
    doc_set = set(doc_tokens)
    score = 0.0
    for token in query_tokens:
        if token in doc_set:
            score += 3.0
            continue
        best = max((similarity(token, other) for other in doc_set), default=0.0)
        if best >= 0.84:
            score += 2.0 * best
        elif best >= 0.72:
            score += 0.8 * best
    return score


def _score_metric(metric: Metric, tokens: list[str], question: str) -> float:
    score = _score_tokens(tokens, metric.search_text())
    folded = question.casefold()
    if metric.id.casefold() in folded or metric.label.casefold() in folded:
        score += 12.0
    for alias in metric.aliases:
        if alias.casefold() in folded:
            score += 10.0
        alias_tokens = tokenize(alias)
        if alias_tokens and all(token in tokens for token in alias_tokens):
            score += 6.0
    return score


def _score_table(table: TableCard, tokens: list[str], question: str) -> float:
    score = _score_tokens(tokens, table.search_text())
    folded = question.casefold()
    short = table.name.split(".")[-1]
    if short.casefold() in folded or table.name.casefold() in folded:
        score += 8.0
    for alias in table.aliases:
        if alias.casefold() in folded:
            score += 6.0
    for column in table.columns:
        if column.name in tokens:
            score += 1.5
        for alias in column.aliases:
            if alias.casefold() in folded or alias.casefold() in tokens:
                score += 4.0
        for value in column.values:
            if value.casefold() in folded:
                score += 3.0
    return score


def _score_example(example: GoldExample, tokens: list[str], question: str) -> float:
    score = _score_tokens(tokens, example.search_text())
    folded = question.casefold()
    if example.question.casefold() in folded:
        score += 14.0
    for alias in example.aliases:
        if alias.casefold() in folded:
            score += 10.0
        alias_tokens = tokenize(alias)
        if alias_tokens and all(token in tokens for token in alias_tokens):
            score += 7.0
    return score


def search_catalog(
    question: str,
    catalog: Catalog,
    *,
    metric_limit: int = 5,
    table_limit: int = 8,
    example_limit: int = 4,
) -> dict[str, Any]:
    expansion = expand_query(question, catalog)
    tokens = expansion["tokens"]

    metrics = []
    for metric in catalog.metrics:
        score = _score_metric(metric, tokens, question)
        if score > 0:
            metrics.append(
                {
                    "id": metric.id,
                    "label": metric.label,
                    "score": round(score, 3),
                    "tables": metric.tables,
                    "description": metric.description,
                }
            )
    metrics.sort(key=lambda item: (-item["score"], item["id"]))

    tables = []
    for table in catalog.tables.values():
        score = _score_table(table, tokens, question)
        if score > 0:
            tables.append(
                {
                    "name": table.name,
                    "score": round(score, 3),
                    "purpose": table.purpose,
                    "grain": table.grain,
                    "aliases": table.aliases,
                }
            )
    tables.sort(key=lambda item: (-item["score"], item["name"]))

    examples = []
    for example in catalog.examples:
        score = _score_example(example, tokens, question)
        if score > 0:
            examples.append(
                {
                    "id": example.id,
                    "question": example.question,
                    "score": round(score, 3),
                    "tables": example.tables,
                }
            )
    examples.sort(key=lambda item: (-item["score"], item["id"]))

    return {
        "question": question,
        "expansion": expansion,
        "metrics": metrics[:metric_limit],
        "tables": tables[:table_limit],
        "examples": examples[:example_limit],
    }
