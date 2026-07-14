from __future__ import annotations

import re
from math import log


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for match in re.finditer(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]+", str(text or "")):
        value = match.group(0).casefold()
        if re.fullmatch(r"[\u4e00-\u9fff]+", value):
            tokens.extend(_cjk_tokens(value))
        else:
            tokens.append(value)
    return tokens


def _cjk_tokens(text: str) -> list[str]:
    if len(text) <= 2:
        return [text]
    tokens = [text[index : index + 2] for index in range(len(text) - 1)]
    tokens.extend(text[index : index + 3] for index in range(len(text) - 2))
    return tokens


class BM25Okapi:
    """Small in-repo BM25 implementation matching rank_bm25's scoring shape."""

    def __init__(self, corpus: list[list[str]], *, k1: float = 1.5, b: float = 0.75, epsilon: float = 0.25):
        self.k1 = k1
        self.b = b
        self.doc_len = [len(document) for document in corpus]
        self.avgdl = sum(self.doc_len) / len(corpus) if corpus else 0.0
        self.doc_freqs: list[dict[str, int]] = []
        document_counts: dict[str, int] = {}
        for document in corpus:
            frequencies: dict[str, int] = {}
            for token in document:
                frequencies[token] = frequencies.get(token, 0) + 1
            self.doc_freqs.append(frequencies)
            for token in frequencies:
                document_counts[token] = document_counts.get(token, 0) + 1
        size = len(corpus)
        raw_idf = {token: log(size - count + 0.5) - log(count + 0.5) for token, count in document_counts.items()}
        average_idf = sum(raw_idf.values()) / len(raw_idf) if raw_idf else 0.0
        self.idf = {token: (epsilon * average_idf if value < 0 else value) for token, value in raw_idf.items()}

    def get_scores(self, query: list[str]) -> list[float]:
        scores: list[float] = []
        for document_index, frequencies in enumerate(self.doc_freqs):
            score = 0.0
            document_length = self.doc_len[document_index]
            for token in query:
                frequency = frequencies.get(token, 0)
                if not frequency:
                    continue
                denominator = frequency + self.k1 * (1 - self.b + self.b * document_length / max(1e-9, self.avgdl))
                score += self.idf.get(token, 0.0) * (frequency * (self.k1 + 1)) / denominator
            scores.append(score)
        return scores
