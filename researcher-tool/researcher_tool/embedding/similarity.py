from __future__ import annotations

import math


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    dot = sum(float(a[index]) * float(b[index]) for index in range(size))
    norm_a = math.sqrt(sum(float(value) * float(value) for value in a[:size]))
    norm_b = math.sqrt(sum(float(value) * float(value) for value in b[:size]))
    if not norm_a or not norm_b:
        return 0.0
    return dot / (norm_a * norm_b)
