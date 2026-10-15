"""Rewrite exact name equality to ILIKE '%…%' (sqlglot AST, not regex)."""

from __future__ import annotations

from sqlglot import exp, parse_one
from sqlglot.errors import ParseError

NAME_COLUMNS = frozenset(
    {
        "title",
        "name",
        "subject",
        "full_name",
        "contact_name",
        "company_name",
        "owner_name",
        "host_name",
        "product_name",
        "deal_title",
        "quote_number",
        "invoice_number",
        "domain",
    }
)


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _column_ident(node: exp.Expression | None) -> str | None:
    cur = node
    while isinstance(cur, (exp.Lower, exp.Upper, exp.Trim)):
        cur = cur.this
    if isinstance(cur, exp.Column) and cur.name:
        return str(cur.name).lower()
    return None


def _string_literal(node: exp.Expression | None) -> str | None:
    if isinstance(node, exp.Literal) and node.is_string:
        return str(node.this)
    return None


def _ilike(column: exp.Expression, pattern: str) -> exp.ILike:
    return exp.ILike(
        this=column,
        expression=exp.Literal.string(pattern),
        escape=exp.Literal.string("\\"),
    )


def _rewrite_node(node: exp.Expression) -> exp.Expression:
    if isinstance(node, exp.EQ):
        ident = _column_ident(node.left)
        lit = _string_literal(node.right)
        if ident is None:
            ident = _column_ident(node.right)
            lit = _string_literal(node.left)
        if ident in NAME_COLUMNS and lit is not None and lit != "":
            col = node.left if _column_ident(node.left) == ident else node.right
            if isinstance(col, (exp.Lower, exp.Upper, exp.Trim)):
                col = col.this
            return _ilike(col, f"%{escape_like(lit)}%")
        return node

    if isinstance(node, (exp.Like, exp.ILike)):
        ident = _column_ident(node.this)
        lit = _string_literal(node.expression)
        if ident in NAME_COLUMNS and lit is not None and lit != "" and "%" not in lit and "_" not in lit:
            col = node.this
            if isinstance(col, (exp.Lower, exp.Upper, exp.Trim)):
                col = col.this
            return _ilike(col, f"%{escape_like(lit)}%")
        return node

    return node


def rewrite_name_predicates(sql: str) -> str:
    """Turn title/name equality (and bare LIKE) into ILIKE '%value%'."""
    text = (sql or "").strip()
    if not text:
        return sql
    ended_semi = text.endswith(";")
    core = text[:-1].rstrip() if ended_semi else text
    try:
        tree = parse_one(core, dialect="postgres")
    except ParseError:
        return sql
    if tree is None:
        return sql
    rewritten = tree.transform(_rewrite_node)
    out = rewritten.sql(dialect="postgres")
    if ended_semi:
        out += ";"
    return out
