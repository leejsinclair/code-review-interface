#!/usr/bin/env python3
"""Rich specification viewer.

Serves the Markdown documents of Spec Kit stories under ``specs/`` as readable HTML pages, with
hover tooltips for reference codes and Mermaid diagrams drawn in the browser.

Run it from a project folder::

    python3 specview.py [--port N] [--host ADDRESS]

Standard library only (Python 3.11+). See specs/001-rich-spec-viewer/ for the approved design.
"""

import sys

if sys.version_info < (3, 11):
    sys.stderr.write("specview.py needs Python 3.11 or later; this is Python %d.%d.\n" % sys.version_info[:2])
    sys.exit(1)

import argparse
import hashlib
import html
import json
import os
import re
import threading
import traceback
import webbrowser
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
PORT_RANGE = range(8000, 8020)
ALLOWED_HOSTS = {"localhost", "127.0.0.1"}
NO_SPECS = "No specs folder found"
OUTSIDE = "This location is outside the viewer's folder."
ERROR_ICON = "⚠"
ALIAS_NAMES = {"spec.md", "plan.md", "tasks.md"}

# ---------------------------------------------------------------------------------------------
# Reference codes (BR-1) and definitions (BR-2)
# ---------------------------------------------------------------------------------------------

CODE = r"(?:(?:REQ|UC|OQ|ART|CH|FR|NFR|SC|DEC|AIS|EVD)-\d{3,}|D-\d{2,}|T\d{3,})"
CODE_RE = re.compile(r"\b" + CODE + r"\b")
ITEM_DEF_RE = re.compile(r"^\s*(?:[-*+]\s+)?\*\*(" + CODE + r")\*\*\s*:")
HEADING_RE = re.compile(r"^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
HEADING_DEF_RE = re.compile(r"^(" + CODE + r")\b")
TASK_DEF_RE = re.compile(r"^\s*[-*+]\s+\[[ xX~!]\]\s+(T\d{3,})\b")


def anchor_for(code: str) -> str:
    return code.lower()


FIXED_PREFIXES = {"REQ", "UC", "OQ", "ART", "CH", "FR", "NFR", "SC", "DEC", "AIS", "EVD"}
LEAD_RE = re.compile(r"^([A-Z]{2,})-\d+\b")
BULLET_LEAD_RE = re.compile(r"^\s*[-*+]\s+(?:\*\*)?([A-Z]{2,})-\d+\b")
CELL_CODE_RE = re.compile(r"([A-Z]{2,})-\d+")
FILLER_RE = re.compile(r"[\s,;/&+()\[\]*_`.\-]|\b(?:and|or)\b")


def has_description(cell: str) -> bool:
    """Whether a table cell says more than which codes it points at, whatever their prefixes."""
    return bool(FILLER_RE.sub("", FIXED.code_re.sub("", CELL_CODE_RE.sub("", cell))))


class Codes:
    """The forms of code recognised in one story: the fixed list plus the prefixes its documents
    introduce (DEC-001). Built per request from a story's documents and never stored."""

    def __init__(self, prefixes=()):
        self.prefixes = tuple(sorted(p for p in prefixes if p not in FIXED_PREFIXES))
        pattern = CODE
        self.bullet_def_re = None
        self.cell_re = None
        if self.prefixes:
            found = "(?:%s)-\\d+" % "|".join(re.escape(p) for p in self.prefixes)
            pattern = "(?:%s|%s)" % (CODE, found)
            self.bullet_def_re = re.compile(r"^\s*[-*+]\s+(?:\*\*)?(" + found + r")\b")
            self.cell_re = re.compile(found)
        self.code_re = re.compile(r"\b" + pattern + r"\b")
        self.item_def_re = re.compile(r"^\s*(?:[-*+]\s+)?\*\*(" + pattern + r")\*\*\s*:")
        self.heading_def_re = re.compile(r"^(" + pattern + r")\b")
        self.fixed = pattern is CODE

    def bullet_definition(self, line: str) -> str | None:
        match = self.bullet_def_re.match(line) if self.bullet_def_re else None
        return match.group(1) if match else None

    def row_definition(self, cells: list[str]) -> str | None:
        """The discovered code a table row introduces: the only content of its first cell, with a
        description in the next cell, judged by structure alone (FR-002)."""
        if self.cell_re is None or len(cells) < 2:
            return None
        first = cells[0].strip().strip("*").strip()
        if not self.cell_re.fullmatch(first):
            return None
        return first if has_description(cells[1]) else None


FIXED = Codes()


def table_rows(tokens: list):
    """Yield (header index, row index, cells) for each body row of each table."""
    n = len(tokens)
    i = 0
    while i < n - 1:
        token, following = tokens[i], tokens[i + 1]
        if isinstance(token, str) and token.lstrip().startswith("|") and isinstance(following, str) and TABLE_SEP_RE.match(following):
            j = i + 2
            while j < n and isinstance(tokens[j], str) and tokens[j].lstrip().startswith("|"):
                yield i, j, _split_row(tokens[j])
                j += 1
            i = j
            continue
        i += 1


def discover_prefixes(text: str) -> set[str]:
    """The prefixes of the codes that start a heading or a bullet, or introduce a table row (FR-001, FR-002)."""
    tokens, _ = tokenize(text)
    found: set[str] = set()
    for token in tokens:
        if isinstance(token, Fence):
            continue
        heading = HEADING_RE.match(token)
        match = LEAD_RE.match(heading.group(2)) if heading else BULLET_LEAD_RE.match(token)
        if match:
            found.add(match.group(1))
    for _, _, cells in table_rows(tokens):
        if len(cells) < 2:
            continue
        first = cells[0].strip().strip("*").strip()
        lead = CELL_CODE_RE.fullmatch(first)
        if lead and has_description(cells[1]):
            found.add(lead.group(1))
    return found


# ---------------------------------------------------------------------------------------------
# Security: the Host check (CH-016) and the Path guard (FR-018)
# ---------------------------------------------------------------------------------------------


def host_allowed(header: str | None) -> bool:
    """Accept only ``localhost`` and ``127.0.0.1``, at any port."""
    if not header:
        return False
    host = header.strip().lower()
    if host.startswith("["):
        host = host[1 : host.find("]")] if "]" in host else host
    elif ":" in host:
        host = host.rsplit(":", 1)[0]
    return host in ALLOWED_HOSTS


class PathGuard:
    """The only route by which a file is opened: every path must resolve inside ``<start>/specs``."""

    def __init__(self, start: Path):
        self.start = start.resolve()
        self.specs = (self.start / "specs").resolve()

    @property
    def has_specs(self) -> bool:
        return self.specs.is_dir()

    def resolve(self, path: Path | str) -> Path | None:
        """The resolved path if it lies inside specs/ (symbolic links and ``..`` followed), else None."""
        candidate = Path(path)
        if not candidate.is_absolute():
            candidate = self.specs / candidate
        try:
            resolved = candidate.resolve()
        except (OSError, RuntimeError):
            return None
        if resolved == self.specs or resolved.is_relative_to(self.specs):
            return resolved
        return None

    def read_bytes(self, path: Path | str) -> bytes | None:
        resolved = self.resolve(path)
        if resolved is None or not resolved.is_file():
            return None
        with open(resolved, "rb") as handle:  # read only (Security Design)
            return handle.read()


# ---------------------------------------------------------------------------------------------
# Start-up: container detection (DEC-008)
# ---------------------------------------------------------------------------------------------


def detect_container(environ=os.environ, dockerenv: Path = Path("/.dockerenv")) -> str | None:
    if dockerenv.exists():
        return str(dockerenv)
    for name in ("REMOTE_CONTAINERS", "CODESPACES"):
        if environ.get(name):
            return name
    return None


def choose_host(override: str | None, environ=os.environ, dockerenv: Path = Path("/.dockerenv")) -> tuple[str, str]:
    """The bind address and the reason printed at start."""
    if override:
        return override, "--host given"
    reason = detect_container(environ, dockerenv)
    if reason:
        return "0.0.0.0", "container detected: " + reason
    return "127.0.0.1", "no container detected"


# ---------------------------------------------------------------------------------------------
# Markdown renderer (DEC-002): tokenizer, block parser, inline pass
# ---------------------------------------------------------------------------------------------

FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)")
FENCE_CLOSE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})\s*$")
EIL_BEGIN_RE = re.compile(r"^\s*<!--\s*eil:begin\s+(\w+)\s*-->\s*$")
LIST_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
HR_RE = re.compile(r"^ {0,3}([-*_])(?:\s*\1){2,}\s*$")
TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$")
QUOTE_RE = re.compile(r"^ {0,3}>\s?(.*)$")
TASK_BOX_RE = re.compile(r"^\[([ xX~!])\]\s+(.*)$", re.S)
CODE_SPAN_RE = re.compile(r"(`+)(.+?)\1")
LINK_RE = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
STRONG_RE = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*")
EM_STAR_RE = re.compile(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])")
EM_UNDER_RE = re.compile(r"(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)")


@dataclass
class Fence:
    info: str
    lines: list[str]


def tokenize(text: str) -> tuple[list, list[tuple[str, str]]]:
    """Split a document into line strings and Fence tokens, dropping HTML comments and ``eil:``
    regions and blocks (FR-019). Returns the tokens and the dropped ``eil:`` fenced blocks as
    ``(kind, body)`` so challenge definitions can still be read (FR-022)."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    tokens: list = []
    eil_blocks: list[tuple[str, str]] = []
    i = 0
    in_comment = False
    while i < len(lines):
        line = lines[i]
        if in_comment:
            end = line.find("-->")
            if end < 0:
                i += 1
                continue
            in_comment = False
            line = line[end + 3 :]
            if not line.strip():
                tokens.append("")
                i += 1
                continue
        begin = EIL_BEGIN_RE.match(line)
        if begin:
            end_marker = re.compile(r"^\s*<!--\s*eil:end\s+" + re.escape(begin.group(1)) + r"\s*-->\s*$")
            j = i + 1
            while j < len(lines) and not end_marker.match(lines[j]):
                j += 1
            i = j + 1
            continue
        fence = FENCE_OPEN_RE.match(line)
        if fence:
            marker, info = fence.group(1), fence.group(2)
            close = re.compile(r"^ {0,3}" + re.escape(marker[0]) + "{" + str(len(marker)) + r",}\s*$")
            body = []
            j = i + 1
            while j < len(lines) and not close.match(lines[j]):
                body.append(lines[j])
                j += 1
            if info.startswith("eil:"):
                eil_blocks.append((info[4:], "\n".join(body)))
            else:
                tokens.append(Fence(info.lower(), body))
            i = j + 1
            continue
        # HTML comments, possibly several on one line or spanning lines
        out = ""
        rest = line
        while "<!--" in rest:
            before, _, after = rest.partition("<!--")
            out += before
            end = after.find("-->")
            if end < 0:
                in_comment = True
                rest = ""
                break
            rest = after[end + 3 :]
        out += rest
        tokens.append(out if out.strip() or out == line else "")
        i += 1
    return tokens, eil_blocks


def slugify(text: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[\s_]+", "-", slug) or "section"


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def safe_href(href: str) -> str:
    scheme = href.split(":", 1)[0].lower() if ":" in href.split("/", 1)[0] else ""
    if scheme and scheme not in ("http", "https", "mailto"):
        return "#"
    return href


class RenderContext:
    """What the renderer needs from its caller: how to mark a code, and whether it renders a
    tooltip section (no marking, diagrams replaced by a note: FR-021, FR-023)."""

    def __init__(self, marker=None, tooltip: bool = False, codes: Codes | None = None):
        self.marker = marker
        self.tooltip = tooltip
        self.codes = codes or FIXED
        self.slugs: dict[str, int] = {}

    def unique_id(self, base: str) -> str:
        count = self.slugs.get(base, 0)
        self.slugs[base] = count + 1
        return base if count == 0 else "%s-%d" % (base, count + 1)


def render_inline(text: str, ctx: RenderContext, skip_code: str | None = None) -> str:
    """Escape first, then inline code, links and emphasis, then mark codes outside code (BR-6)."""
    held: list[str] = []

    def hold(fragment: str) -> str:
        held.append(fragment)
        return "\x00%d\x00" % (len(held) - 1)

    text = CODE_SPAN_RE.sub(lambda m: hold("<code>" + esc(m.group(2).strip()) + "</code>"), text)
    text = LINK_RE.sub(
        lambda m: hold('<a href="%s">%s</a>' % (esc(safe_href(m.group(2))), _emphasis(esc(m.group(1))))), text
    )
    text = _emphasis(esc(text))
    if ctx.marker is not None:
        skipped = [False]

        def mark(m: re.Match) -> str:
            code = m.group(0)
            if skip_code == code and not skipped[0]:
                skipped[0] = True
                return code
            return ctx.marker(code)

        text = ctx.codes.code_re.sub(mark, text)
    return re.sub("\x00(\\d+)\x00", lambda m: held[int(m.group(1))], text)


def _emphasis(text: str) -> str:
    text = STRONG_RE.sub(r"<strong>\1</strong>", text)
    text = EM_STAR_RE.sub(r"<em>\1</em>", text)
    return EM_UNDER_RE.sub(r"<em>\1</em>", text)


def _is_blank(token) -> bool:
    return isinstance(token, str) and not token.strip()


def _starts_block(token, following=None) -> bool:
    if isinstance(token, Fence):
        return True
    return bool(
        HEADING_RE.match(token)
        or HR_RE.match(token)
        or LIST_RE.match(token)
        or QUOTE_RE.match(token)
        or (token.lstrip().startswith("|") and isinstance(following, str) and TABLE_SEP_RE.match(following))
    )


def render_tokens(tokens: list, ctx: RenderContext) -> str:
    out: list[str] = []
    i = 0
    n = len(tokens)
    while i < n:
        token = tokens[i]
        if isinstance(token, Fence):
            out.append(_render_fence(token, ctx))
            i += 1
            continue
        if not token.strip():
            i += 1
            continue
        heading = HEADING_RE.match(token)
        if heading:
            level = len(heading.group(1))
            title = heading.group(2)
            code = ctx.codes.heading_def_re.match(title)
            ident = ctx.unique_id(anchor_for(code.group(1)) if code else slugify(title))
            body = render_inline(title, ctx, code.group(1) if code else None)
            out.append('<h%d id="%s">%s</h%d>' % (level, esc(ident), body, level))
            i += 1
            continue
        if HR_RE.match(token):
            out.append("<hr>")
            i += 1
            continue
        following = tokens[i + 1] if i + 1 < n else None
        if token.lstrip().startswith("|") and isinstance(following, str) and TABLE_SEP_RE.match(following):
            j = i + 2
            rows = [token]
            while j < n and isinstance(tokens[j], str) and tokens[j].lstrip().startswith("|"):
                rows.append(tokens[j])
                j += 1
            out.append(_render_table(rows, ctx))
            i = j
            continue
        if QUOTE_RE.match(token):
            inner = []
            while i < n and isinstance(tokens[i], str) and QUOTE_RE.match(tokens[i]):
                inner.append(QUOTE_RE.match(tokens[i]).group(1))
                i += 1
            out.append("<blockquote>%s</blockquote>" % render_tokens(inner, ctx))
            continue
        if LIST_RE.match(token):
            block = [token]
            first = LIST_RE.match(token)
            base, ordered = len(first.group(1)), first.group(2)[0].isdigit()

            def sibling_of_other_kind(line: str) -> bool:
                m = LIST_RE.match(line)
                return bool(m) and len(m.group(1)) <= base and m.group(2)[0].isdigit() != ordered

            j = i + 1
            while j < n and isinstance(tokens[j], str):
                line = tokens[j]
                if not line.strip():
                    nxt = tokens[j + 1] if j + 1 < n else None
                    if (
                        isinstance(nxt, str)
                        and nxt.strip()
                        and (LIST_RE.match(nxt) or nxt[:1] in " \t")
                        and not sibling_of_other_kind(nxt)
                    ):
                        block.append(line)
                        j += 1
                        continue
                    break
                if sibling_of_other_kind(line):
                    break
                if LIST_RE.match(line) or line[:1] in " \t":
                    block.append(line)
                    j += 1
                    continue
                if HEADING_RE.match(line) or HR_RE.match(line) or QUOTE_RE.match(line):
                    break
                block.append(line)  # lazy continuation of the last item
                j += 1
            out.append(_render_list(block, ctx))
            i = j
            continue
        para = [token]
        j = i + 1
        while j < n and isinstance(tokens[j], str) and tokens[j].strip():
            if _starts_block(tokens[j], tokens[j + 1] if j + 1 < n else None):
                break
            para.append(tokens[j])
            j += 1
        text = "\n".join(line.strip() for line in para)
        item = ctx.codes.item_def_re.match(para[0])
        attr = ' id="%s"' % esc(ctx.unique_id(anchor_for(item.group(1)))) if item else ""
        out.append("<p%s>%s</p>" % (attr, render_inline(text, ctx, item.group(1) if item else None)))
        i = j
    return "\n".join(out)


def _render_fence(fence: Fence, ctx: RenderContext) -> str:
    source = "\n".join(fence.lines)
    if fence.info == "mermaid":
        if ctx.tooltip:
            return '<p class="diagram-note">A diagram is shown here in the document.</p>'
        return '<pre class="mermaid-src">%s</pre>' % esc(source)
    lang = ' class="language-%s"' % esc(fence.info) if fence.info else ""
    return "<pre><code%s>%s</code></pre>" % (lang, esc(source))


def _split_row(row: str) -> list[str]:
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|") and not row.endswith("\\|"):
        row = row[:-1]
    cells = re.split(r"(?<!\\)\|", row)
    return [cell.strip().replace("\\|", "|") for cell in cells]


def _render_table(rows: list[str], ctx: RenderContext) -> str:
    head = _split_row(rows[0])
    body = [_split_row(r) for r in rows[1:]]
    parts = ["<table><thead><tr>"]
    parts += ["<th>%s</th>" % render_inline(c, ctx) for c in head]
    parts.append("</tr></thead><tbody>")
    for cells in body:
        defined = ctx.codes.row_definition(cells)
        attr = ' id="%s"' % esc(ctx.unique_id(anchor_for(defined))) if defined else ""
        tds = "".join(
            "<td>%s</td>" % render_inline(c, ctx, defined if defined and i == 0 else None) for i, c in enumerate(cells)
        )
        parts.append("<tr%s>%s</tr>" % (attr, tds))
    parts.append("</tbody></table>")
    return "".join(parts)


def _render_list(lines: list[str], ctx: RenderContext) -> str:
    first = LIST_RE.match(lines[0])
    base = len(first.group(1).expandtabs(4))
    ordered = first.group(2)[0].isdigit()
    items: list[tuple[list[str], list[str], str]] = []  # (text lines, child lines, first raw line)
    for line in lines:
        m = LIST_RE.match(line)
        if m and len(m.group(1).expandtabs(4)) <= base:
            items.append(([m.group(3)], [], line))
            continue
        text_lines, child_lines, _ = items[-1]
        if not line.strip():
            if child_lines:
                child_lines.append("")
            continue
        if child_lines or m:
            child_lines.append(line)
        else:
            text_lines.append(line.strip())
    tag = "ol" if ordered else "ul"
    start = ""
    if ordered:
        number = int(re.match(r"\d+", first.group(2)).group(0))
        if number != 1:
            start = ' start="%d"' % number
    out = ["<%s%s>" % (tag, start)]
    for text_lines, child_lines, raw in items:
        text = "\n".join(text_lines)
        ident = ""
        definition = ctx.codes.item_def_re.match(raw) or TASK_DEF_RE.match(raw)
        skip = definition.group(1) if definition else ctx.codes.bullet_definition(raw)
        if skip:
            ident = ' id="%s"' % esc(ctx.unique_id(anchor_for(skip)))
        box = TASK_BOX_RE.match(text)
        prefix = ""
        cls = ""
        if box:
            checked = " checked" if box.group(1) in "xX" else ""
            prefix = '<input type="checkbox" disabled%s> ' % checked
            text = box.group(2)
            cls = ' class="task"'
        body = prefix + render_inline(text, ctx, skip)
        if child_lines:
            indents = [len(c) - len(c.lstrip()) for c in child_lines if c.strip()]
            cut = min(indents) if indents else 0
            body += render_tokens([c[cut:] for c in child_lines], ctx)
        out.append("<li%s%s>%s</li>" % (ident, cls, body))
    out.append("</%s>" % tag)
    return "".join(out)


def render_markdown(text: str, ctx: RenderContext | None = None) -> str:
    tokens, _ = tokenize(text)
    return render_tokens(tokens, ctx or RenderContext())


# ---------------------------------------------------------------------------------------------
# Definitions and sections (BR-2, BR-3)
# ---------------------------------------------------------------------------------------------


@dataclass
class Definition:
    code: str
    document: str  # rel_path under specs/
    anchor: str
    kind: str  # item | heading | task | challenge
    section_html: str


def find_definitions(text: str, rel_path: str, codes: Codes = FIXED) -> list[Definition]:
    """Every code this document introduces, with the rendered HTML of its defining section."""
    tokens, eil_blocks = tokenize(text)
    found: list[tuple[int, str, str, int]] = []  # (token index, code, kind, heading level or 7)
    for index, token in enumerate(tokens):
        if isinstance(token, Fence):
            continue
        heading = HEADING_RE.match(token)
        if heading:
            code = codes.heading_def_re.match(heading.group(2))
            if code:
                found.append((index, code.group(1), "heading", len(heading.group(1))))
            continue
        task = TASK_DEF_RE.match(token)
        if task:
            found.append((index, task.group(1), "task", 7))
            continue
        item = codes.item_def_re.match(token)
        if item:
            found.append((index, item.group(1), "item", 7))
            continue
        bullet = codes.bullet_definition(token)
        if bullet:
            found.append((index, bullet, "item", 7))
    starts = {index for index, *_ in found}
    definitions: list[Definition] = []
    for index, code, kind, level in found:
        end = index + 1
        while end < len(tokens):
            token = tokens[end]
            if end in starts:
                break
            if isinstance(token, str):
                heading = HEADING_RE.match(token)
                if heading and len(heading.group(1)) <= level:
                    break
            end += 1
        section = render_tokens(tokens[index:end], RenderContext(marker=None, tooltip=True, codes=codes))
        definitions.append(Definition(code, rel_path, anchor_for(code), kind, section))
    for header, row, cells in table_rows(tokens):
        code = codes.row_definition(cells)
        if code:
            section = render_tokens([tokens[header], tokens[header + 1], tokens[row]], RenderContext(marker=None, tooltip=True, codes=codes))
            definitions.append(Definition(code, rel_path, anchor_for(code), "row", section))
    for kind, body in eil_blocks:
        if kind != "challenge":
            continue
        try:
            record = json.loads(body)
        except ValueError:
            continue
        code = record.get("id")
        if isinstance(code, str) and CODE_RE.fullmatch(code):
            definitions.append(Definition(code, rel_path, "challenges", "challenge", _challenge_html(record)))
    return definitions


def _challenge_html(record: dict) -> str:
    rows = [("Target", record.get("target")), ("Status", record.get("status"))]
    if record.get("response"):
        rows += [("Response", record.get("response")), ("Answered by", record.get("by")), ("Reason", record.get("reason"))]
    parts = ["<p>%s</p>" % esc(str(record.get("text", "")))]
    parts.append("<dl>" + "".join("<dt>%s</dt><dd>%s</dd>" % (esc(k), esc(str(v))) for k, v in rows if v) + "</dl>")
    return "".join(parts)


# ---------------------------------------------------------------------------------------------
# Story index (DEC-004, FR-024, FR-025) and the viewer's caches (DEC-001)
# ---------------------------------------------------------------------------------------------


@dataclass
class StoryIndex:
    story: str
    key: tuple
    documents: list[str]
    aliases: dict[str, str] = field(default_factory=dict)
    definitions: dict[str, list[Definition]] = field(default_factory=dict)
    codes: Codes = FIXED

    def state(self, code: str) -> str:
        found = self.definitions.get(code, [])
        if not found:
            return "unresolved"
        return "resolved" if len(found) == 1 else "ambiguous"


# ---------------------------------------------------------------------------------------------
# Kanban board from tasks.md (story 003: DEC-002, DEC-003, DEC-004)
# ---------------------------------------------------------------------------------------------

TASK_LINE_RE = re.compile(r"^\s*[-*+]\s+\[([ xX~!])\]\s+(T\d{3,})\b\s*(.*?)\s*$")
PHASE_RE = re.compile(r"^##\s+(.*?)\s*#*\s*$")
STORY_TAG_RE = re.compile(r"\[(US\d+)\]")
IN_PROGRESS_TAG_RE = re.compile(r"\(in progress\)", re.I)
BLOCKED_TAG_RE = re.compile(r"\(blocked\)", re.I)
COLUMNS = (("backlog", "Backlog"), ("in-progress", "In progress"), ("blocked", "Blocked"), ("done", "Done"))
UNALLOCATED = "Unallocated"


@dataclass
class Card:
    task: str
    story: str | None
    description: str
    phase: str | None
    column: str


def parse_tasks(text: str) -> list[Card]:
    """The cards of a tasks.md, read line by line. Blocked wins over in progress; a task marked done is
    done; a line that is not a task is ignored (DEC-003). Nothing is written back."""
    cards: list[Card] = []
    phase: str | None = None
    fence = None
    for line in text.splitlines():
        if fence is not None:
            closing = FENCE_CLOSE_RE.match(line)
            if closing and closing.group(1)[0] == fence[0] and len(closing.group(1)) >= len(fence):
                fence = None
            continue
        opening = FENCE_OPEN_RE.match(line)
        if opening:
            fence = opening.group(1)
            continue
        heading = PHASE_RE.match(line)
        if heading:
            phase = heading.group(1)
            continue
        task = TASK_LINE_RE.match(line)
        if not task:
            continue
        mark, code, rest = task.groups()
        if mark in "xX":
            column = "done"
        elif mark == "!" or BLOCKED_TAG_RE.search(rest):
            column = "blocked"
        elif mark == "~" or IN_PROGRESS_TAG_RE.search(rest):
            column = "in-progress"
        else:
            column = "backlog"
        story = STORY_TAG_RE.search(rest)
        description = " ".join(STORY_TAG_RE.sub("", rest, count=1).split()) if story else rest
        cards.append(Card(code, story.group(1) if story else None, description, phase, column))
    return cards


def group_cards(cards: list[Card], by: str) -> list[tuple[str, list[Card]]]:
    """Cards grouped by phase or by user story in order of first appearance, Unallocated last (AIS-027)."""
    groups: dict[str, list[Card]] = {}
    for card in cards:
        key = (card.story if by == "story" else card.phase) or UNALLOCATED
        groups.setdefault(key, []).append(card)
    ordered = [(name, group) for name, group in groups.items() if name != UNALLOCATED]
    if UNALLOCATED in groups:
        ordered.append((UNALLOCATED, groups[UNALLOCATED]))
    return ordered


def kanban_body(story: str, cards: list[Card], by: str) -> str:
    """The board for a story as HTML; every description and label is escaped (AIS-036)."""
    other = "phase" if by == "story" else "story"
    head = "<h1>Kanban: %s</h1>" % esc(story)
    switch = '<p class="board-switch">Grouped by %s. <a href="?group=%s">Group by %s</a></p>' % (
        "user story" if by == "story" else "phase",
        other,
        "phase" if by == "story" else "user story",
    )
    if not cards:
        return head + '<p class="board-empty">No tasks were found for this story.</p>'
    sections = []
    for name, group in group_cards(cards, by):
        columns = []
        for column, title in COLUMNS:
            chosen = [c for c in group if c.column == column]
            items = "".join(
                '<li class="card"><span class="card-id">%s</span>%s <span class="card-text">%s</span></li>'
                % (
                    esc(c.task),
                    ' <span class="card-story">%s</span>' % esc(c.story) if c.story and by != "story" else "",
                    esc(c.description),
                )
                for c in chosen
            )
            columns.append(
                '<section class="col col-%s"><h3>%s <span class="count">%d</span></h3><ul>%s</ul></section>'
                % (column, title, len(chosen), items)
            )
        sections.append('<section class="lane"><h2>%s</h2><div class="cols">%s</div></section>' % (esc(name), "".join(columns)))
    return head + switch + "".join(sections)


# ---------------------------------------------------------------------------------------------
# Reading order of a story's documents (story 002: DEC-003, DEC-004, DEC-006)
# ---------------------------------------------------------------------------------------------

STAGE_RE = re.compile(r"s([0-9]{2})-(.+)\.(?i:md)")
DIGITS_RE = re.compile(r"([0-9]+)")


def stage_of(file_name: str) -> tuple[str, str] | None:
    """The stage number and name of a file named ``sNN-name.md``, else None (FR-004)."""
    match = STAGE_RE.fullmatch(file_name)
    return (match.group(1), match.group(2)) if match else None


def natural_key(text: str) -> tuple:
    """Casefolded text with each run of digits compared by value; equal names fall back to the exact text."""
    pieces = DIGITS_RE.split(text.casefold())
    return tuple(int(piece) if i % 2 else piece for i, piece in enumerate(pieces)), text


def reading_order_key(parts: tuple[str, ...] | list[str], staged: bool) -> tuple:
    """One sort key: a part per folder, then the document part, so a folder's documents come before
    those of its nested folders and, within a folder, staged documents before unstaged ones (FR-007 to FR-009)."""
    folders = tuple((1, natural_key(name)) for name in parts[:-1])
    return folders + ((0, 0 if staged else 1, natural_key(parts[-1])),)


def entry_label(parts: tuple[str, ...] | list[str]) -> str:
    """The label of a document from its path inside the story folder (FR-003 to FR-005)."""
    name = parts[-1]
    stage = stage_of(name)
    if stage is not None:
        text = "[stage %s: %s]" % stage
        return "/".join([*parts[:-1], text])
    stem = name[:-3]
    if not stem:
        return "/".join([*parts[:-1], "[ref doc: blank]"])
    return "/".join([*parts[:-1], stem]) + " [ref doc: %s]" % stem


@dataclass
class ReadingEntry:
    path: Path
    parts: tuple[str, ...]
    resolved: Path
    aliases: list[str] = field(default_factory=list)
    current: bool = False


class Viewer:
    def __init__(self, start: Path):
        self.guard = PathGuard(start)
        self.lock = threading.Lock()
        self.indexes: dict[str, StoryIndex] = {}
        self.pages: dict[str, tuple[tuple, str]] = {}
        self.boards: dict[str, tuple[float | None, list[Card]]] = {}

    # -- walking ----------------------------------------------------------------------------

    def _markdown_files(self, folder: Path) -> list[Path]:
        """Every .md file at any depth under folder, symbolic links included but not followed
        into directories; files resolving outside specs/ are skipped (CH-017)."""
        files = []
        for root, dirs, names in os.walk(folder):
            dirs.sort()
            for name in sorted(names):
                if name.lower().endswith(".md"):
                    path = Path(root) / name
                    if self.guard.resolve(path) is not None:
                        files.append(path)
        return files

    def rel(self, path: Path) -> str:
        return path.relative_to(self.guard.specs).as_posix()

    def story_key(self, story: str) -> tuple:
        folder = self.guard.specs / story
        key = []
        for path in self._markdown_files(folder):
            try:
                st = path.stat()
            except OSError:
                continue
            key.append((self.rel(path), st.st_mtime_ns, st.st_size))
        return tuple(key)

    # -- story index ------------------------------------------------------------------------

    def discover(self, story: str) -> tuple[str, ...]:
        """The prefixes a story's documents introduce, found afresh on every request and kept nowhere (DEC-001)."""
        prefixes: set[str] = set()
        for path in self._markdown_files(self.guard.specs / story):
            data = self.guard.read_bytes(path)
            if data is not None:
                prefixes |= discover_prefixes(data.decode("utf-8", "replace"))
        return Codes(prefixes).prefixes

    def story_index(self, story: str) -> StoryIndex:
        key = self.story_key(story)
        prefixes = self.discover(story)
        with self.lock:
            cached = self.indexes.get(story)
            if cached is not None and cached.key == key and cached.codes.prefixes == prefixes:
                return cached
        index = self._build_index(story, key)
        with self.lock:
            self.indexes[story] = index
        return index

    def _build_index(self, story: str, key: tuple) -> StoryIndex:
        paths = self._markdown_files(self.guard.specs / story)
        # Real files before links, and Spec Kit's alias names last, so a copy never outranks its stage document.
        paths.sort(key=lambda p: (p.is_symlink(), p.name in ALIAS_NAMES, self.rel(p)))
        index = StoryIndex(story, key, [])
        by_path: dict[Path, str] = {}
        by_content: dict[tuple[int, str], str] = {}
        loaded = []
        prefixes: set[str] = set()
        for path in paths:  # first pass: the prefixes this story introduces (DEC-001)
            data = self.guard.read_bytes(path)
            resolved = self.guard.resolve(path)
            if resolved is None or data is None:
                continue
            loaded.append((path, resolved, data))
            prefixes |= discover_prefixes(data.decode("utf-8", "replace"))
        index.codes = Codes(prefixes)
        for path, resolved, data in loaded:
            rel = self.rel(path)
            index.documents.append(rel)
            digest = (len(data), hashlib.sha256(data).hexdigest())
            original = by_path.get(resolved) or by_content.get(digest)
            if original is not None:
                index.aliases[rel] = original  # an alias counts as its target (FR-024)
                continue
            by_path[resolved] = rel
            by_content[digest] = rel
            seen_here: set[str] = set()
            for definition in find_definitions(data.decode("utf-8", "replace"), rel, index.codes):
                if definition.code in seen_here:
                    continue  # defined twice in one document still counts once
                seen_here.add(definition.code)
                index.definitions.setdefault(definition.code, []).append(definition)
        # A heading for a code another document defines as an item expands that item (FR-026).
        for code, found in index.definitions.items():
            item_docs = {d.document for d in found if d.kind != "heading"}
            if item_docs:
                found[:] = [d for d in found if d.kind != "heading" or d.document in item_docs]
        return index

    # -- pages ------------------------------------------------------------------------------

    def document_page(self, path: Path) -> str:
        rel = self.rel(path)
        parts = rel.split("/")
        story = parts[0] if len(parts) > 1 else None
        st = path.stat()
        key = ((rel, st.st_mtime_ns, st.st_size),)
        if story is not None:
            key = (self.story_key(story), self.discover(story), key)
        with self.lock:
            cached = self.pages.get(rel)
            if cached is not None and cached[0] == key:
                return cached[1]
        page = self._render_document(path, rel, story)
        with self.lock:
            self.pages[rel] = (key, page)
        return page

    def _render_document(self, path: Path, rel: str, story: str | None) -> str:
        stamp = self.stamp(path)  # taken before the content is read, so an edit during rendering still refreshes
        data = self.guard.read_bytes(path)
        if data is None:
            raise FileNotFoundError(rel)
        text = data.decode("utf-8", "replace")
        refs: dict[str, dict] = {}
        marker = None
        if story is not None:  # a document directly in specs/ gets no marking (FR-009)
            index = self.story_index(story)

            def marker(code: str) -> str:
                state = index.state(code)
                if code not in refs:
                    refs[code] = self._ref_entry(index, code, state)
                if state == "resolved":
                    href = refs[code]["href"]
                    return '<a class="ref" data-code="%s" href="%s">%s</a>' % (code, esc(href), code)
                title = "Not defined in this story" if state == "unresolved" else "Defined in more than one document"
                return '<span class="ref ref-error" data-code="%s" title="%s">%s %s</span>' % (
                    code,
                    title,
                    ERROR_ICON,
                    code,
                )

        body = render_markdown(text, RenderContext(marker=marker, codes=index.codes if story is not None else None))
        if story is not None:
            body = story_menu(story) + body + self.reading_order(story, rel)
        title = parts_title(rel)
        return page_html(
            title, breadcrumbs(rel, is_dir=False), body, refs, self.guard.has_specs, stamp_of=(rel, stamp)
        )

    def _ref_entry(self, index: StoryIndex, code: str, state: str) -> dict:
        if state == "unresolved":
            return {"state": "unresolved"}
        found = index.definitions[code]
        if state == "ambiguous":
            return {"state": "ambiguous", "documents": sorted(d.document.split("/", 1)[1] for d in found)}
        d = found[0]
        return {
            "state": "resolved",
            "doc": d.document.split("/", 1)[1],
            "href": doc_url(d.document) + "#" + d.anchor,
            "html": d.section_html,
        }

    # -- stamps and the kanban board (story 003) ----------------------------------------------

    def stamp(self, path: Path | str) -> float | None:
        """The modified time of a file inside specs/, or None when it cannot be read (DEC-004)."""
        resolved = self.guard.resolve(path)
        if resolved is None:
            return None
        try:
            if not resolved.is_file():
                return None
            with open(resolved, "rb"):  # a file that cannot be opened counts as unreadable
                pass
            return resolved.stat().st_mtime
        except OSError:
            return None

    def board(self, story: str) -> list[Card]:
        """The parsed cards of a story's tasks.md, parsed again only when its modified time changes."""
        path = self.guard.specs / story / "tasks.md"
        stamp = self.stamp(path)
        with self.lock:
            cached = self.boards.get(story)
            if cached is not None and cached[0] == stamp and stamp is not None:
                return cached[1]
        try:
            data = self.guard.read_bytes(path) if stamp is not None else None
        except OSError:
            data = None
        cards = parse_tasks(data.decode("utf-8", "replace")) if data is not None else []
        with self.lock:
            if data is None:
                self.boards.pop(story, None)  # nothing was read, so try again next time
            else:
                self.boards[story] = (stamp, cards)
        return cards

    def kanban_page(self, story: str, by: str) -> str:
        tasks = self.guard.specs / story / "tasks.md"
        stamp = self.stamp(tasks)
        body = story_menu(story) + kanban_body(story, self.board(story), by)
        rel = story + "/tasks.md"
        return page_html(
            "Kanban: " + story, breadcrumbs(story, is_dir=True), body, {}, True, stamp_of=(rel, stamp), wide=True
        )

    # -- reading order (story 002) ------------------------------------------------------------

    def reading_order(self, story: str, current_rel: str) -> str:
        """The "Documents in reading order" section for a document of a story, as HTML (DEC-001)."""
        folder = self.guard.specs / story
        story_root = self.guard.resolve(folder)
        if story_root is None:
            return ""
        candidates: list[ReadingEntry] = []
        for path in self._markdown_files(folder):
            resolved = self.guard.resolve(path)
            try:
                listed = resolved is not None and resolved.is_file()
            except OSError:
                listed = False
            if listed:
                candidates.append(ReadingEntry(path, path.relative_to(folder).parts, resolved))

        def is_alias(entry: ReadingEntry) -> bool:
            return (
                entry.path.name in ALIAS_NAMES
                and entry.path.is_symlink()
                and entry.resolved.is_relative_to(story_root)
                and stage_of(entry.resolved.name) is not None
            )

        sources: dict[Path, ReadingEntry] = {}
        for entry in sorted(candidates, key=lambda e: (e.path.is_symlink(), e.parts)):
            if not is_alias(entry):
                sources.setdefault(entry.resolved, entry)
        entries: list[ReadingEntry] = []
        alias_of: dict[str, ReadingEntry] = {}
        for entry in candidates:
            source = sources.get(entry.resolved) if is_alias(entry) else None
            if source is None:
                entries.append(entry)
            else:
                source.aliases.append(entry.path.name)
                alias_of[self.rel(entry.path)] = source

        by_rel = {self.rel(entry.path): entry for entry in entries}
        current = alias_of.get(current_rel) or by_rel.get(current_rel)
        if current is None:  # reached through a symbolic link to a folder, which the walk does not enter
            viewed = self.guard.specs / current_rel
            resolved = self.guard.resolve(viewed)
            if resolved is not None and resolved.is_file() and viewed.is_relative_to(folder):
                current = ReadingEntry(viewed, viewed.relative_to(folder).parts, resolved)
                entries.append(current)
        if not entries:
            return ""
        if current is not None:
            current.current = True
        entries.sort(key=lambda e: reading_order_key(e.parts, stage_of(e.parts[-1]) is not None))

        items = []
        for entry in entries:
            label = esc(entry_label(entry.parts))
            if entry.current:
                core = '<span aria-current="page">%s</span>' % label
            else:
                target = self.rel(entry.path)
                if not entry.resolved.is_relative_to(story_root):
                    real = self.rel(entry.resolved)
                    if "/" in real:  # a document of another story is opened under its own path (FR-013)
                        target = real
                core = '<a href="%s">%s</a>' % (esc(doc_url(target)), label)
            aliases = "".join(" (%s)" % esc(name) for name in sorted(entry.aliases, key=natural_key))
            items.append("<li>%s%s</li>" % (core, aliases))
        return (
            '<nav class="reading-order" aria-label="Documents in reading order">'
            "<h2>Documents in reading order</h2><ol>%s</ol></nav>" % "".join(items)
        )

    def navigation_page(self, folder: Path | None) -> str:
        """The navigation view of specs/ or a folder below it (FR-001, FR-020)."""
        if folder is None or not self.guard.has_specs:
            body = "<h1>specs/</h1><p>There are no Spec Kit documents in this folder.</p>"
            return page_html("specs", breadcrumbs("", is_dir=True), body, {}, False)
        rel = "" if folder == self.guard.specs else self.rel(folder)
        entries = []
        for child in sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if self.guard.resolve(child) is None:
                continue
            if child.is_dir():
                entries.append('<li class="dir"><a href="%s">%s/</a></li>' % (esc(dir_url(self.rel(child))), esc(child.name)))
            elif child.name.lower().endswith(".md"):
                entries.append('<li class="doc"><a href="%s">%s</a></li>' % (esc(doc_url(self.rel(child))), esc(child.name)))
        listing = '<ul class="listing">%s</ul>' % "".join(entries) if entries else "<p>This folder has no documents.</p>"
        heading = "specs/" + (rel + "/" if rel else "")
        menu = story_menu(rel.split("/")[0]) if rel else ""
        return page_html(heading, breadcrumbs(rel, is_dir=True), menu + "<h1>%s</h1>%s" % (esc(heading), listing), {}, True)

    # -- search (DEC-005) -------------------------------------------------------------------

    def search(self, query: str) -> dict:
        if not self.guard.has_specs:
            return {"specs": False, "results": []}
        pattern = query.strip().lower()
        if not pattern:
            return {"specs": True, "results": []}
        if not any(ch in pattern for ch in "*?["):
            pattern = "*" + pattern + "*"
        results = []
        for path in self._markdown_files(self.guard.specs):
            rel = self.rel(path)
            if fnmatchcase(rel.lower(), pattern):
                story, _, file = rel.partition("/")
                if not file:
                    story, file = None, rel
                results.append({"story": story, "file": file, "href": doc_url(rel)})
        results.sort(key=lambda r: ((r["story"] or "") + "/" + r["file"]).lower())
        return {"specs": True, "results": results}


def story_menu(story: str) -> str:
    """The menu of a story's pages: its documents and its kanban board (FR-011)."""
    return '<nav class="story-menu" aria-label="Story"><a href="%s">Documents</a> <a href="%s">Kanban board</a></nav>' % (
        esc(dir_url(story)),
        esc(doc_url(story) + "/kanban"),
    )


def doc_url(rel: str) -> str:
    return "/specs/" + quote(rel)


def dir_url(rel: str) -> str:
    return "/specs/" + quote(rel) + "/" if rel else "/"


def parts_title(rel: str) -> str:
    return rel.rsplit("/", 1)[-1]


def breadcrumbs(rel: str, is_dir: bool) -> str:
    parts = [p for p in rel.split("/") if p]
    crumbs = ['<a href="/">specs</a>']
    for i, part in enumerate(parts):
        last = i == len(parts) - 1
        if last and not is_dir:
            crumbs.append('<span aria-current="page">%s</span>' % esc(part))
        else:
            crumbs.append('<a href="%s">%s</a>' % (esc(dir_url("/".join(parts[: i + 1]))), esc(part)))
    return '<nav class="crumbs">%s</nav>' % " / ".join(crumbs)


# ---------------------------------------------------------------------------------------------
# Page template (FR-005, FR-020, NFR-001) with the inline style and scripts (ART-014)
# ---------------------------------------------------------------------------------------------

CSS = """
:root { --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --bg: #fff; --soft: #f6f8fa;
        --link: #0969da; --err: #cf222e; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
       font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
header, main { max-width: 72ch; margin: 0 auto; padding: 0 1rem; }
header { padding-top: 1rem; border-bottom: 1px solid var(--line); padding-bottom: .75rem; }
main { padding-top: 1rem; padding-bottom: 4rem; }
.crumbs { color: var(--muted); font-size: .9rem; margin-bottom: .5rem; }
.search input { width: 100%; padding: .45rem .6rem; font: inherit; border: 1px solid var(--line); border-radius: 6px; }
.search-msg { margin: .35rem 0 0; color: var(--err); font-size: .9rem; min-height: 0; }
.search-msg:empty { display: none; }
#results { margin: .5rem 0 0; padding-left: 1.2rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .6em; }
h1 { font-size: 1.8rem; } h2 { font-size: 1.4rem; border-bottom: 1px solid var(--line); padding-bottom: .2em; }
h3 { font-size: 1.15rem; }
p, ul, ol, table, pre, blockquote, dl { margin: 0 0 1em; }
li { margin: .25em 0; }
li.task { list-style: none; margin-left: -1.2em; }
a { color: var(--link); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
code { background: var(--soft); padding: .1em .3em; border-radius: 4px; }
pre { background: var(--soft); padding: .75rem 1rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 4px solid var(--line); margin-left: 0; padding-left: 1rem; color: var(--muted); }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: .35rem .6rem; text-align: left; vertical-align: top; }
th { background: var(--soft); }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
.reading-order { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.reading-order h2 { font-size: 1.1rem; margin: 0 0 .5rem; }
.reading-order ol { margin: 0; padding-left: 1.5rem; }
.reading-order [aria-current="page"] { font-weight: 700; color: var(--fg); text-decoration: none; }
.story-menu { display: flex; gap: 1rem; margin: 0 0 1rem; padding-bottom: .5rem; border-bottom: 1px solid var(--line); font-size: .9rem; }
.wide header, .wide main { max-width: none; }
.board-switch { color: var(--muted); }
.board-empty { color: var(--muted); font-style: italic; }
.lane { margin: 0 0 2rem; }
.cols { display: grid; grid-template-columns: repeat(4, minmax(12rem, 1fr)); gap: .75rem; overflow-x: auto; }
.col { background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: .5rem .6rem; min-width: 0; }
.col h3 { font-size: .95rem; margin: 0 0 .5rem; }
.col .count { color: var(--muted); font-weight: 400; }
.col ul { list-style: none; margin: 0; padding: 0; }
.card { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: .4rem .5rem; margin: 0 0 .4rem; font-size: .88rem; line-height: 1.4; overflow-wrap: anywhere; }
.card-id { font-weight: 600; } .card-story { color: var(--muted); }
.col-blocked .card { border-left: 4px solid var(--err); }
.col-in-progress .card { border-left: 4px solid var(--link); }
.col-done .card { color: var(--muted); }
.listing { padding-left: 1.2rem; } .listing .dir a { font-weight: 600; }
.ref { text-decoration: underline dotted; text-underline-offset: 3px; white-space: nowrap; }
.ref-error { color: var(--err); font-weight: 600; cursor: help; }
.diagram { margin: 0 0 1em; overflow-x: auto; }
.diagram-error { color: var(--err); border: 1px solid var(--err); border-radius: 6px; padding: .5rem .75rem; margin: 0 0 1em; }
.diagram-note { color: var(--muted); font-style: italic; }
.tip { position: fixed; z-index: 10; max-width: min(40rem, 90vw); max-height: 60vh; overflow: auto;
       background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: .6rem .8rem;
       box-shadow: 0 8px 24px rgba(0,0,0,.15); font-size: .92rem; }
.tip-head { font-weight: 600; color: var(--muted); margin-bottom: .4rem; }
.tip-err { color: var(--err); }
.tip h1, .tip h2, .tip h3 { font-size: 1rem; border: 0; margin: .4em 0; }
.tip dl { display: grid; grid-template-columns: max-content 1fr; gap: .2rem .8rem; }
.tip dt { color: var(--muted); } .tip dd { margin: 0; }
"""

PAGE_JS = r"""
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Search box (FR-002)
  const q = document.getElementById('q'), res = document.getElementById('results'),
        msg = document.getElementById('search-msg'), initial = msg.textContent;
  let timer = null;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  async function run() {
    const v = q.value.trim();
    if (!v) { res.hidden = true; res.innerHTML = ''; msg.textContent = initial; return; }
    try {
      const r = await fetch('/api/search?q=' + encodeURIComponent(v));
      const d = await r.json();
      if (!d.specs) { msg.textContent = 'No specs folder found'; res.hidden = true; return; }
      if (!d.results.length) { msg.textContent = 'No documents match “' + v + '”.'; res.hidden = true; return; }
      msg.textContent = '';
      res.innerHTML = d.results.map(x => '<li><a href="' + esc(x.href) + '">' +
        esc((x.story ? x.story + '/' : '') + x.file) + '</a></li>').join('');
      res.hidden = false;
    } catch (e) { msg.textContent = 'Search failed: ' + e.message; }
  }
  // Tooltip controller (FR-010, FR-011, FR-013, FR-021, FR-022)
  const refs = JSON.parse(document.getElementById('refs').textContent || '{}');
  const tip = document.getElementById('tip');
  let hideTimer = null;
  function show(el) {
    const code = el.dataset.code, r = refs[code];
    if (!r) return;
    clearTimeout(hideTimer);
    let h;
    if (r.state === 'resolved') h = '<div class="tip-head">' + esc(code) + ' — ' + esc(r.doc) + '</div>' + r.html;
    else if (r.state === 'unresolved') h = '<div class="tip-head tip-err">⚠ ' + esc(code) + '</div><p>Not defined in this story.</p>';
    else h = '<div class="tip-head tip-err">⚠ ' + esc(code) + '</div><p>Defined in more than one document of this story:</p><ul>' +
             r.documents.map(d => '<li>' + esc(d) + '</li>').join('') + '</ul>';
    tip.innerHTML = h; tip.hidden = false; tip.scrollTop = 0;
    const b = el.getBoundingClientRect(), th = tip.offsetHeight, tw = tip.offsetWidth;
    let top = b.bottom + 6;
    if (top + th > innerHeight - 6) top = Math.max(6, b.top - th - 6);
    tip.style.top = top + 'px';
    tip.style.left = Math.max(6, Math.min(b.left, innerWidth - tw - 6)) + 'px';
  }
  const hideSoon = () => { hideTimer = setTimeout(() => { tip.hidden = true; }, 200); };
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest('.ref');
    if (el && !tip.contains(el)) show(el);
  });
  document.addEventListener('mouseout', e => {
    const el = e.target.closest && e.target.closest('.ref');
    if (el && !tip.contains(el)) hideSoon();
  });
  tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  tip.addEventListener('mouseleave', hideSoon);
})();
"""

DIAGRAM_JS = r"""
// Diagram loader (FR-014, FR-015, DEC-003)
const blocks = [...document.querySelectorAll('pre.mermaid-src')];
const fail = (block, text) => {
  const d = document.createElement('div');
  d.className = 'diagram-error';
  d.textContent = '⚠ ' + text;
  block.replaceWith(d);
};
if (blocks.length) {
  let mermaid = null;
  try {
    mermaid = (await import('__MERMAID_URL__')).default;
    mermaid.initialize({ startOnLoad: false });
  } catch (e) {
    blocks.forEach(b => fail(b, 'The diagram library could not be loaded, so this diagram cannot be drawn.'));
  }
  if (mermaid) {
    let n = 0;
    for (const block of blocks) {
      const id = 'mmd-' + (n++);
      try {
        const { svg } = await mermaid.render(id, block.textContent);
        const d = document.createElement('div');
        d.className = 'diagram';
        d.innerHTML = svg;
        block.replaceWith(d);
      } catch (e) {
        document.getElementById('d' + id)?.remove();
        fail(block, 'This diagram could not be drawn: ' + ((e && e.message) || e));
      }
    }
  }
}
""".replace("__MERMAID_URL__", MERMAID_URL)


REFRESH_JS = r"""
// Page refresher (REQ-012, DEC-004): every 10 seconds check the shown file and reload when it changed
(() => {
  const info = JSON.parse(document.getElementById('stamp').textContent);
  const key = 'specview-scroll:' + location.pathname + location.search;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved !== null) {
      sessionStorage.removeItem(key);
      window.addEventListener('load', () => window.scrollTo(0, Number(saved)));
    }
  } catch (e) {}
  setInterval(async () => {
    try {
      const r = await fetch('/api/stamp?path=' + encodeURIComponent(info.path), { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (d.stamp === null || d.stamp === info.stamp) return;
      try { sessionStorage.setItem(key, String(window.scrollY)); } catch (e) {}
      location.reload();
    } catch (e) {}
  }, 10000);
})();
"""


def refs_json(refs: dict) -> str:
    """JSON safe to embed in a script element (DEC-004)."""
    text = json.dumps(refs, ensure_ascii=False)
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def page_html(
    title: str, crumbs: str, body: str, refs: dict, has_specs: bool, stamp_of: tuple[str, float | None] | None = None, wide: bool = False
) -> str:
    message = "" if has_specs else NO_SPECS
    stamp = ""
    if stamp_of is not None:
        stamp = '<script type="application/json" id="stamp">%s</script><script>%s</script>' % (
            refs_json({"path": stamp_of[0], "stamp": stamp_of[1]}),
            REFRESH_JS,
        )
    return (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>%s</title><style>%s</style></head><body%s>"
        '<header>%s<div class="search"><input id="q" type="search" autocomplete="off" '
        'placeholder="Search by glob pattern, e.g. */s01-*" aria-label="Search documents">'
        '<p id="search-msg" class="search-msg">%s</p><ul id="results" hidden></ul></div></header>'
        '<main id="content">%s</main><div id="tip" class="tip" hidden></div>'
        '<script type="application/json" id="refs">%s</script>'
        "<script>%s</script><script type=\"module\">%s</script>%s</body></html>"
    ) % (esc(title), CSS, ' class="wide"' if wide else "", crumbs, esc(message), body, refs_json(refs), PAGE_JS, DIAGRAM_JS, stamp)


def message_page(title: str, text: str) -> str:
    return page_html(title, breadcrumbs("", is_dir=True), "<h1>%s</h1><p>%s</p>" % (esc(title), esc(text)), {}, True)


# ---------------------------------------------------------------------------------------------
# Request handler (ART-013, contracts/http.md)
# ---------------------------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "specview/1"

    @property
    def viewer(self) -> Viewer:
        return self.server.viewer  # type: ignore[attr-defined]

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        if not host_allowed(self.headers.get("Host")):
            self._send(403, message_page("Refused", "This viewer only answers requests to localhost."))
            return
        try:
            self._route()
        except Exception as exc:  # the server keeps running (Error Handling)
            traceback.print_exc()
            self._send(500, message_page("Error", "The page could not be rendered: %s" % exc))

    def _route(self) -> None:
        url = urlsplit(self.path)
        path = unquote(url.path)
        if path == "/api/search":
            query = parse_qs(url.query).get("q", [""])[0]
            self._send(200, json.dumps(self.viewer.search(query)), "application/json; charset=utf-8")
            return
        if path == "/api/stamp":
            rel = parse_qs(url.query).get("path", [""])[0]
            guard = self.viewer.guard
            if not rel or guard.resolve(rel) is None:
                self._send(403, json.dumps({"error": "outside specs"}), "application/json; charset=utf-8")
                return
            self._send(200, json.dumps({"stamp": self.viewer.stamp(rel)}), "application/json; charset=utf-8")
            return
        board = re.fullmatch(r"/specs/([^/]+)/kanban/?", path)
        if board:
            story = board.group(1)
            folder = self.viewer.guard.resolve(story)
            if folder is None:
                self._send(403, message_page("Refused", OUTSIDE))
            elif not folder.is_dir():
                self._send(404, message_page("Not found", "This story no longer exists, or never did."))
            else:
                group = parse_qs(url.query).get("group", [""])[0]
                self._send(200, self.viewer.kanban_page(story, "story" if group == "story" else "phase"))
            return
        if path in ("/", "/specs", "/specs/"):
            self._send(200, self.viewer.navigation_page(self.viewer.guard.specs if self.viewer.guard.has_specs else None))
            return
        if not path.startswith("/specs/"):
            self._send(404, message_page("Not found", "There is nothing at this address."))
            return
        guard = self.viewer.guard
        target = guard.resolve(path[len("/specs/") :])
        if target is None:
            self._send(403, message_page("Refused", OUTSIDE))
            return
        if target.is_dir():
            self._send(200, self.viewer.navigation_page(target))
            return
        if target.is_file() and target.name.lower().endswith(".md"):
            # Serve the requested path, not its resolved target, so a link keeps its own name.
            requested = Path(os.path.normpath(guard.specs / path[len("/specs/") :]))
            inside = requested.is_relative_to(guard.specs) and requested.exists()
            self._send(200, self.viewer.document_page(requested if inside else target))
            return
        self._send(404, message_page("Not found", "This document no longer exists, or never did."))

    def _send(self, status: int, body: str, content_type: str = "text/html; charset=utf-8") -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


class ViewerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, start: Path):
        super().__init__(address, Handler)
        self.viewer = Viewer(start)


def make_server(start: Path, host: str = "127.0.0.1", port: int | None = None) -> ViewerServer:
    """Bind to the given port, or the first free one from 8000 to 8019 (DEC-007)."""
    if port is not None:
        try:
            return ViewerServer((host, port), start)
        except OSError as exc:
            raise SystemExit("Port %d is not available (%s)." % (port, exc.strerror or exc)) from None
    for candidate in PORT_RANGE:
        try:
            return ViewerServer((host, candidate), start)
        except OSError:
            continue
    raise SystemExit("All ports from %d to %d are in use." % (PORT_RANGE[0], PORT_RANGE[-1]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="View Spec Kit documents under ./specs as rich HTML.")
    parser.add_argument("--port", type=int, help="use exactly this port (default: first free from 8000 to 8019)")
    parser.add_argument("--host", help="bind address (default: 127.0.0.1, or 0.0.0.0 in a container)")
    args = parser.parse_args(argv)
    start = Path.cwd()
    host, reason = choose_host(args.host)
    try:
        server = make_server(start, host, args.port)
    except SystemExit as exc:
        sys.stderr.write("%s\n" % exc)
        return 1
    port = server.server_address[1]
    url = "http://localhost:%d/" % port
    print("Serving specs/ from %s" % start)
    print("Listening on %s:%d (%s)" % (host, port, reason))
    print("Open %s" % url)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        webbrowser.open(url)
    except Exception:
        pass  # no browser is not an error
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
