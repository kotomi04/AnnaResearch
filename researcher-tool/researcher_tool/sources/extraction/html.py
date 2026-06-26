from __future__ import annotations

import re
import urllib.error
import urllib.request
import gzip
import zlib
from dataclasses import dataclass
from math import log
from pathlib import Path
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from .models import ExtractedPage
from .utils import is_http_url, normalize_whitespace, truncate_text

EXCLUDED_TAGS = {
    "script",
    "style",
    "meta",
    "link",
    "noscript",
    "iframe",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "nav",
    "footer",
    "header",
    "aside",
    "menu",
    "svg",
}
NEGATIVE_ATTR_EXACT_TOKENS = {"nav", "navigation", "footer", "header", "sidebar", "ads", "social", "share", "cookie"}
NEGATIVE_ATTR_CONTAINS = ("comment", "promo", "advert", "recommend", "related")
NEGATIVE_TEXT_PATTERN = re.compile(r"advert|sponsored|subscribe|copyright|privacy|terms|login|register|广告|登录|注册|版权|隐私|推荐|评论|分享|收藏|点赞", re.I)
KEEP_ATTRS = {"href", "src", "alt", "title"}
BLOCK_TAGS = {
    "article",
    "main",
    "section",
    "div",
    "p",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "table",
    "thead",
    "tbody",
    "tr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
}
INLINE_TAGS = {"a", "abbr", "b", "code", "em", "i", "mark", "small", "span", "strong", "time"}
EMPTY_KEEP_TAGS = {"br", "hr", "img"}
MIN_WORD_THRESHOLD = 3


@dataclass(frozen=True)
class MarkdownBlock:
    index: int
    text: str
    is_heading: bool = False


@dataclass(frozen=True)
class MarkdownGenerationResult:
    raw_markdown: str
    fit_markdown: str
    references_markdown: str = ""


class BM25Okapi:
    """Small in-repo BM25Okapi implementation matching rank_bm25's scoring shape."""

    def __init__(self, corpus: list[list[str]], *, k1: float = 1.5, b: float = 0.75, epsilon: float = 0.25):
        self.corpus = corpus
        self.k1 = k1
        self.b = b
        self.epsilon = epsilon
        self.corpus_size = len(corpus)
        self.doc_len = [len(document) for document in corpus]
        self.avgdl = sum(self.doc_len) / self.corpus_size if self.corpus_size else 0.0
        self.doc_freqs: list[dict[str, int]] = []
        self.idf: dict[str, float] = {}
        self.average_idf = 0.0
        self._initialize()

    def _initialize(self) -> None:
        nd: dict[str, int] = {}
        for document in self.corpus:
            frequencies: dict[str, int] = {}
            for token in document:
                frequencies[token] = frequencies.get(token, 0) + 1
            self.doc_freqs.append(frequencies)
            for token in frequencies:
                nd[token] = nd.get(token, 0) + 1

        idf_sum = 0.0
        negative_tokens: list[str] = []
        for token, freq in nd.items():
            idf = log(self.corpus_size - freq + 0.5) - log(freq + 0.5)
            self.idf[token] = idf
            idf_sum += idf
            if idf < 0:
                negative_tokens.append(token)

        self.average_idf = idf_sum / len(self.idf) if self.idf else 0.0
        eps = self.epsilon * self.average_idf
        for token in negative_tokens:
            self.idf[token] = eps

    def get_scores(self, query: list[str]) -> list[float]:
        scores: list[float] = []
        for index, frequencies in enumerate(self.doc_freqs):
            doc_len = self.doc_len[index]
            score = 0.0
            for token in query:
                q_freq = frequencies.get(token, 0)
                if not q_freq:
                    continue
                denominator = q_freq + self.k1 * (1 - self.b + self.b * doc_len / max(1e-9, self.avgdl))
                score += self.idf.get(token, 0.0) * (q_freq * (self.k1 + 1)) / denominator
            scores.append(score)
        return scores


class HtmlExtractionError(RuntimeError):
    """Raised when HTML extraction fails."""


def extract_html(
    source: str,
    *,
    timeout: float = 20.0,
    max_chars_per_page: int = 12000,
    user_agent: str = "AnnaResearcher/0.1",
    query: str = "",
    excluded_tags: list[str] | None = None,
    excluded_selector: str = "",
) -> ExtractedPage:
    """Extract readable text from a local or remote HTML document."""
    clean_source = str(source or "").strip()
    if not clean_source:
        return ExtractedPage(url="", content_type="html", status="failed", error="empty_source")

    try:
        html = _load_html(clean_source, timeout=timeout, user_agent=user_agent)
        title, content = extract_html_content(
            html,
            max_chars_per_page=max_chars_per_page,
            query=query,
            excluded_tags=excluded_tags,
            excluded_selector=excluded_selector,
            base_url=clean_source if is_http_url(clean_source) else "",
        )
    except HtmlExtractionError as exc:
        return ExtractedPage(url=clean_source, content_type="html", status="failed", error=str(exc))

    if not content:
        return ExtractedPage(url=clean_source, title=title, content_type="html", status="failed", error="empty_content")
    return ExtractedPage(url=clean_source, title=title, raw_content=content, content_type="html")


def extract_html_content(
    html: str | bytes,
    *,
    max_chars_per_page: int = 12000,
    query: str = "",
    excluded_tags: list[str] | None = None,
    excluded_selector: str = "",
    base_url: str = "",
) -> tuple[str, str]:
    soup = BeautifulSoup(html, "lxml")
    title = _extract_title(soup)
    cleaned = clean_html_for_markdown(soup, excluded_tags=excluded_tags, excluded_selector=excluded_selector)
    prune_content_tree(cleaned)
    markdown = generate_markdown(cleaned, query=query, base_url=base_url)
    content = markdown.fit_markdown
    if markdown.references_markdown:
        content = f"{content}\n\n{markdown.references_markdown}".strip()
    return title, truncate_text(content, max_chars_per_page)


def _load_html(source: str, *, timeout: float, user_agent: str) -> bytes:
    if is_http_url(source):
        request = urllib.request.Request(source, headers={"User-Agent": user_agent, "Accept-Encoding": "identity"}, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                return _decode_response_body(body, response.headers.get("Content-Encoding", ""))
        except urllib.error.URLError as exc:
            raise HtmlExtractionError(f"failed to download html: {exc}") from exc

    path = Path(source)
    try:
        return path.read_bytes()
    except OSError as exc:
        raise HtmlExtractionError(f"failed to read html file: {exc}") from exc


def _decode_response_body(body: bytes, content_encoding: str) -> bytes:
    encoding = str(content_encoding or "").lower()
    if "gzip" in encoding:
        try:
            return gzip.decompress(body)
        except OSError:
            return body
    if "deflate" in encoding:
        try:
            return zlib.decompress(body)
        except zlib.error:
            return body
    return body


def clean_html_for_markdown(
    soup: BeautifulSoup,
    *,
    excluded_tags: list[str] | None = None,
    excluded_selector: str = "",
) -> Tag | BeautifulSoup:
    """Return crawl4ai-style cleaned HTML ready for markdown generation."""
    root = soup.body or soup

    for comment in root.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()

    all_excluded_tags = set(EXCLUDED_TAGS)
    all_excluded_tags.update(str(tag).strip().lower() for tag in (excluded_tags or []) if str(tag).strip())
    for tag in root.find_all(all_excluded_tags):
        tag.decompose()

    if excluded_selector:
        try:
            for tag in list(root.select(excluded_selector)):
                tag.decompose()
        except Exception as exc:  # noqa: BLE001
            raise HtmlExtractionError(f"invalid excluded_selector: {exc}") from exc

    for tag in list(root.find_all(_has_negative_attrs)):
        tag.decompose()

    for tag in root.find_all(True):
        _clean_attrs(tag)

    _remove_empty_elements(root)
    return root


def prune_content_tree(root: Tag | BeautifulSoup) -> None:
    """Prune low-value content blocks using crawl4ai-style structural heuristics."""
    for tag in list(root.find_all(["p", "li", "blockquote", "pre", "td", "th"])):
        if _is_low_value_leaf(tag):
            tag.decompose()

    _remove_empty_elements(root)


def _is_low_value_leaf(tag: Tag) -> bool:
    text = normalize_whitespace(tag.get_text(" ", strip=True))
    if not text:
        return True
    tokens = _tokenize(text)
    if len(tokens) < MIN_WORD_THRESHOLD and tag.name not in {"th", "td"}:
        return True

    link_text = " ".join(anchor.get_text(" ", strip=True) for anchor in tag.find_all("a"))
    link_density = len(link_text) / max(1, len(text))
    if link_density > 0.65:
        return True

    noise_hits = len(NEGATIVE_TEXT_PATTERN.findall(text))
    if noise_hits >= 2 and len(text) < 240:
        return True
    return False


def _has_negative_attrs(tag: Tag) -> bool:
    values: list[str] = []
    for attr in ("id", "class", "role", "aria-label"):
        value = tag.get(attr)
        if isinstance(value, list):
            values.extend(str(item) for item in value)
        elif value:
            values.append(str(value))
    joined = " ".join(values).casefold()
    tokens = {token for token in re.split(r"[^a-z0-9]+", joined) if token}
    if tokens & NEGATIVE_ATTR_EXACT_TOKENS:
        return True
    return any(keyword in joined for keyword in NEGATIVE_ATTR_CONTAINS)


def _clean_attrs(tag: Tag) -> None:
    for attr in list(tag.attrs):
        if attr not in KEEP_ATTRS:
            del tag.attrs[attr]


def _remove_empty_elements(root: Tag | BeautifulSoup) -> None:
    changed = True
    while changed:
        changed = False
        for tag in list(root.find_all(True)):
            if tag.name in EMPTY_KEEP_TAGS:
                continue
            if tag.get_text("", strip=True):
                continue
            tag.decompose()
            changed = True


def _extract_title(soup: BeautifulSoup) -> str:
    if soup.title and soup.title.string:
        return normalize_whitespace(soup.title.string)
    heading = soup.find(["h1", "h2"])
    return normalize_whitespace(heading.get_text(" ", strip=True)) if heading else ""


def generate_markdown(root: Tag | BeautifulSoup, *, query: str = "", base_url: str = "") -> MarkdownGenerationResult:
    raw_markdown = html_to_markdown(root, base_url=base_url)
    fit_raw_markdown = filter_markdown_for_query(raw_markdown, query=query)
    fit_markdown, references = convert_links_to_citations(fit_raw_markdown, base_url=base_url)
    raw_markdown_with_citations, _ = convert_links_to_citations(raw_markdown, base_url=base_url)
    return MarkdownGenerationResult(raw_markdown=raw_markdown_with_citations, fit_markdown=fit_markdown, references_markdown=references)


def html_to_markdown(root: Tag | BeautifulSoup, *, base_url: str = "") -> str:
    """Convert cleaned HTML to a compact markdown document."""
    markdown = _render_children(root, block=True, base_url=base_url)
    markdown = re.sub(r"[ \t]+\n", "\n", markdown)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return markdown.strip()


def _render_children(tag: Tag | BeautifulSoup, *, block: bool, base_url: str) -> str:
    parts = [_render_node(child, block=block, base_url=base_url) for child in tag.children]
    separator = "\n\n" if block else ""
    return separator.join(part for part in parts if part.strip())


def _render_node(node: object, *, block: bool, base_url: str) -> str:
    if isinstance(node, NavigableString):
        return normalize_whitespace(str(node))
    if not isinstance(node, Tag):
        return ""

    name = str(node.name or "").lower()
    if name in {"html", "body", "article", "main", "section"}:
        return _render_children(node, block=True, base_url=base_url)
    if name in {"div", "figure", "figcaption", "details", "summary"}:
        return _render_children(node, block=True, base_url=base_url)
    if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        level = min(6, max(1, int(name[1])))
        text = _inline_text(node, base_url=base_url)
        return f"{'#' * level} {text}".strip() if text else ""
    if name == "p":
        return _inline_text(node, base_url=base_url)
    if name in {"ul", "ol"}:
        return _render_list(node, ordered=name == "ol", base_url=base_url)
    if name == "li":
        return _inline_text(node, base_url=base_url)
    if name == "blockquote":
        text = _render_children(node, block=True, base_url=base_url)
        return "\n".join(f"> {line}" if line else ">" for line in text.splitlines())
    if name == "pre":
        text = node.get_text("\n", strip=True)
        return f"```\n{text}\n```" if text else ""
    if name == "table":
        return _render_table(node)
    if name == "br":
        return "\n"
    if name == "hr":
        return "---"
    if name in INLINE_TAGS:
        return _inline_text(node, base_url=base_url)
    if name in BLOCK_TAGS or block:
        return _render_children(node, block=True, base_url=base_url)
    return _inline_text(node, base_url=base_url)


def _inline_text(tag: Tag, *, base_url: str) -> str:
    parts: list[str] = []
    for child in tag.children:
        if isinstance(child, NavigableString):
            text = normalize_whitespace(str(child))
        elif isinstance(child, Tag):
            text = _render_inline_tag(child, base_url=base_url)
        else:
            text = ""
        if text:
            parts.append(text)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def _render_inline_tag(tag: Tag, *, base_url: str) -> str:
    name = str(tag.name or "").lower()
    if name == "a":
        text = _inline_text(tag, base_url=base_url) or normalize_whitespace(tag.get_text(" ", strip=True))
        href = str(tag.get("href") or "").strip()
        if href and base_url:
            href = urljoin(base_url, href)
        return f"[{text}]({href})" if text and href else text
    if name in {"strong", "b"}:
        text = _inline_text(tag, base_url=base_url)
        return f"**{text}**" if text else ""
    if name in {"em", "i"}:
        text = _inline_text(tag, base_url=base_url)
        return f"*{text}*" if text else ""
    if name == "code" and tag.parent and tag.parent.name != "pre":
        text = normalize_whitespace(tag.get_text(" ", strip=True))
        return f"`{text}`" if text else ""
    if name == "br":
        return "\n"
    if name in BLOCK_TAGS:
        return _render_node(tag, block=True, base_url=base_url)
    return _inline_text(tag, base_url=base_url)


def _render_list(tag: Tag, *, ordered: bool, base_url: str) -> str:
    lines: list[str] = []
    index = 1
    for item in tag.find_all("li", recursive=False):
        text = _inline_text(item, base_url=base_url)
        if not text:
            continue
        prefix = f"{index}. " if ordered else "- "
        lines.append(prefix + text)
        index += 1
    return "\n".join(lines)


def _render_table(tag: Tag) -> str:
    rows: list[list[str]] = []
    for tr in tag.find_all("tr"):
        cells = [normalize_whitespace(cell.get_text(" ", strip=True)) for cell in tr.find_all(["th", "td"], recursive=False)]
        if cells:
            rows.append(cells)
    if not rows:
        return ""

    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    separator = ["---"] * width
    body = normalized[1:]
    table_lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(separator) + " |",
    ]
    table_lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(table_lines)


def convert_links_to_citations(markdown: str, *, base_url: str = "") -> tuple[str, str]:
    link_pattern = re.compile(r"!?\[([^\]]+)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
    link_map: dict[str, tuple[int, str]] = {}
    parts: list[str] = []
    last_end = 0
    counter = 1
    for match in link_pattern.finditer(markdown):
        text, raw_url = match.groups()
        url = urljoin(base_url, raw_url) if base_url else raw_url
        if url not in link_map:
            link_map[url] = (counter, text)
            counter += 1
        number = link_map[url][0]
        parts.append(markdown[last_end : match.start()])
        if match.group(0).startswith("!"):
            parts.append(f"![{text}⟨{number}⟩]")
        else:
            parts.append(f"{text}⟨{number}⟩")
        last_end = match.end()
    parts.append(markdown[last_end:])
    converted = "".join(parts)
    if not link_map:
        return converted, ""
    references = ["## References"]
    for url, (number, text) in sorted(link_map.items(), key=lambda item: item[1][0]):
        suffix = f": {text}" if text else ""
        references.append(f"⟨{number}⟩ {url}{suffix}")
    return converted, "\n\n".join(references)


def filter_markdown_for_query(markdown: str, *, query: str = "") -> str:
    """Return fit markdown using Pruning output plus optional BM25 query filtering."""
    clean_markdown = str(markdown or "").strip()
    clean_query = str(query or "").strip()
    if not clean_markdown or not clean_query:
        return clean_markdown

    blocks = _split_markdown_blocks(clean_markdown)
    if len(blocks) <= 2:
        return clean_markdown

    bm25 = BM25Okapi([_tokenize(block.text) for block in blocks])
    scores = bm25.get_scores(_tokenize(clean_query))
    if not any(score > 0 for score in scores):
        return clean_markdown

    positive_scores = [score for score in scores if score > 0]
    threshold = max(0.05, sum(positive_scores) / len(positive_scores) * 0.35)
    selected_indexes = {block.index for block, score in zip(blocks, scores) if score >= threshold}

    for index, block in enumerate(blocks):
        if not block.is_heading:
            continue
        next_selected = any(candidate in selected_indexes for candidate in range(index + 1, min(len(blocks), index + 4)))
        if next_selected:
            selected_indexes.add(block.index)

    selected = [block.text for block in blocks if block.index in selected_indexes]
    return "\n\n".join(selected).strip() or clean_markdown


def _split_markdown_blocks(markdown: str) -> list[MarkdownBlock]:
    blocks: list[MarkdownBlock] = []
    for index, part in enumerate(re.split(r"\n{2,}", markdown)):
        text = part.strip()
        if not text:
            continue
        blocks.append(MarkdownBlock(index=len(blocks), text=text, is_heading=text.startswith("#")))
    return blocks


def _tokenize(text: str) -> list[str]:
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
