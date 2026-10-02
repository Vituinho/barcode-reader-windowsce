"""Bifurcated bases (BASE BIPARTIDA): one product shipped as two physical volumes, side A and side B.

The ONLY place that may tell which side a production label belongs to. The real rule (which part of the large
barcode identifies A or B) has NOT been confirmed by the business, so no rule is registered: every bifurcated
product reports "REGRA DE LADO PENDENTE", its scans keep side=None and loads containing it stay in review and
cannot be dispatched. Never infer the side from the EAN or from a guessed digit.

To enable a confirmed rule: register a decoder in RULES (name -> function(raw) -> SIDE_A | SIDE_B | None), set
items.side_rule to that name for the affected products, and switch their stock to per-side balances with
coverage = min(A, B) and dispatch consuming one A and one B per unit.
"""
from collections.abc import Callable

from app.models import Item

SIDE_A = "SIDE_A"
SIDE_B = "SIDE_B"
SIDE_RULE_PENDING = "REGRA DE LADO PENDENTE"

# Confirmed decoders only. Intentionally empty until the label format is confirmed.
RULES: dict[str, Callable[[str], str | None]] = {}


def is_bifurcated(item: Item | None) -> bool:
    return item is not None and item.product_kind == Item.KIND_BIFURCATED_BASE


def side_rule_pending(item: Item | None) -> bool:
    return is_bifurcated(item) and item.side_rule not in RULES


def decode_side(item: Item | None, raw: str) -> str | None:
    """SIDE_A / SIDE_B for a bifurcated product with a confirmed rule; None otherwise (unknown, never guessed)."""
    if not is_bifurcated(item) or item.side_rule not in RULES:
        return None
    side = RULES[item.side_rule]((raw or "").strip())
    return side if side in (SIDE_A, SIDE_B) else None
