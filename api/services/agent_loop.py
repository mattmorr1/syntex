"""Harness-gated ReAct loop for LaTeX edits.

The model picks tools freely, but `finish` is refused while edits are uncompiled or a compile shows
errors the pre-edit baseline did not have. Every step emits a structured trace line and an SSE event.
"""
from __future__ import annotations

import asyncio
import difflib
import json
import logging
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

MAX_STEPS = 10
MAX_COMPILES = 4
MAX_RUN_TOKENS = 250_000
RUN_DEADLINE_S = 240.0
OBS_CAP = 4000
OLD_OBS_CAP = 300
KEEP_FULL_OBS = 3
READ_MAX_LINES = 200
FULL_VIEW_LINES = 400
SEARCH_MAX_HITS = 40
PATTERN_MAX_LEN = 200
BINARY_TYPES = frozenset({"png", "jpg", "jpeg", "pdf"})

ACTIONS = ("read_file", "search", "edit", "compile", "inspect_log", "finish")
ARG_TYPES = {"name": "string", "start": "integer", "end": "integer", "pattern": "string", "start_line": "integer",
             "end_line": "integer", "original": "string", "replacement": "string", "mode": "string",
             "context": "integer", "explanation": "string"}
# Every arg is required-but-nullable: Gemini structured output drops optional fields (edit arrived without end_line).
ACTION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "thought": {"type": "string"},
        "action": {"type": "string", "enum": list(ACTIONS)},
        "args": {"type": "object", "properties": {k: {"type": t, "nullable": True} for k, t in ARG_TYPES.items()},
                 "required": list(ARG_TYPES)},
    },
    "required": ["thought", "action", "args"],
}

# (prompt) -> (action dict, tokens); raises ValueError on an unparseable response.
LLM = Callable[[str], Awaitable[Tuple[Dict[str, Any], int]]]
# (files, main_file) -> (pdf_produced, log text)
Compiler = Callable[[List[Dict[str, Any]], str], Awaitable[Tuple[bool, str]]]

_DIGITS = re.compile(r"\d+")
_ERR_LINE = re.compile(r"^l\.(\d+)")
_WARN = re.compile(r"^(?:LaTeX|Package \S+|Class \S+|LaTeX Font) Warning: (.*)")
_INPUT_LINE = re.compile(r"on input line (\d+)")
UNAVAILABLE_MARKERS = ("LaTeX compiler not found", "Main file not found", "Compilation timed out")


@dataclass(frozen=True, slots=True)
class Diagnostic:
    kind: str
    message: str
    line: Optional[int]
    excerpt: str

    @property
    def key(self) -> Tuple[str, str]:
        return self.kind, _DIGITS.sub("#", self.message)


def unwrap_log(log: str) -> List[str]:
    """TeX hard-wraps log lines at 79 chars; rejoin them so messages and regexes see whole lines."""
    out: List[str] = []
    carry = ""
    for line in log.splitlines():
        if len(line) == 79:
            carry += line
            continue
        out.append(carry + line)
        carry = ""
    return out + ([carry] if carry else [])


def parse_log(log: str) -> List[Diagnostic]:
    lines = unwrap_log(log)
    diags: List[Diagnostic] = []
    for i, line in enumerate(lines):
        if line.startswith("! "):
            block = lines[i:i + 8]
            hit = next((m for m in map(_ERR_LINE.match, block) if m), None)
            end = next((k + 1 for k, b in enumerate(block) if _ERR_LINE.match(b)), 3)
            diags.append(Diagnostic("error", line[2:].strip(), int(hit.group(1)) if hit else None, "\n".join(block[:end])))
        elif m := _WARN.match(line):
            ln = _INPUT_LINE.search(line)
            diags.append(Diagnostic("warning", m.group(1).strip(), int(ln.group(1)) if ln else None, line))
    return diags


def regressions(baseline: List[Diagnostic], current: List[Diagnostic]) -> Tuple[List[Diagnostic], int]:
    """Errors in `current` beyond the baseline multiset, plus how many baseline errors disappeared."""
    base = Counter(d.key for d in baseline if d.kind == "error")
    seen: Counter = Counter()
    new: List[Diagnostic] = []
    for d in (d for d in current if d.kind == "error"):
        seen[d.key] += 1
        if seen[d.key] > base[d.key]:
            new.append(d)
    fixed = sum((base - Counter(d.key for d in current if d.kind == "error")).values())
    return new, fixed


def diff_changes(old: str, new: str) -> List[Dict[str, Any]]:
    """Line hunks old->new; pure inserts/deletes widen by one context line so `replacement` is never ambiguous-empty."""
    a, b = old.split("\n"), new.split("\n")
    out: List[Dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if i1 == i2 or j1 == j2:
            if i1 > 0:
                i1, j1 = i1 - 1, j1 - 1
            elif i2 < len(a):
                i2, j2 = i2 + 1, j2 + 1
        out.append({"start_line": i1 + 1, "end_line": i2, "original": "\n".join(a[i1:i2]),
                    "replacement": "\n".join(b[j1:j2]), "reason": "agent edit"})
    return out


def _clip(text: str, cap: int) -> str:
    return text if len(text) <= cap else f"{text[:cap]}\n...[truncated {len(text) - cap} chars]"


def _numbered(lines: List[str], start: int) -> str:
    return "\n".join(f"{start + k}: {line}" for k, line in enumerate(lines))


@dataclass(slots=True)
class Step:
    thought: str
    action: str
    args: Dict[str, Any]
    observation: str


@dataclass(slots=True)
class AgentLoop:
    llm: LLM
    compiler: Compiler
    instruction: str
    files: Dict[str, str]
    file_types: Dict[str, str]
    active: str
    main_file: Optional[str]
    selection: Optional[Dict[str, Any]] = None
    cursor_line: Optional[int] = None
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    original: str = ""
    steps: List[Step] = field(default_factory=list)
    tokens: int = 0
    edits: int = 0
    compiles: int = 0
    dirty: bool = False
    last_log: Optional[str] = None
    new_errors: List[Diagnostic] = field(default_factory=list)
    baseline: List[Diagnostic] = field(default_factory=list)
    unavailable: Optional[str] = None
    readonly: frozenset = frozenset()
    attachment_note: str = ""
    _baseline_task: Optional[asyncio.Task] = None

    def __post_init__(self) -> None:
        self.original = self.files[self.active]
        if not self.main_file:
            self.unavailable = "no main .tex file with \\documentclass in the project"

    # -- compile plumbing --------------------------------------------------
    def _compile_files(self) -> List[Dict[str, Any]]:
        return [{"name": n, "content": c, "type": self.file_types.get(n, n.rsplit(".", 1)[-1])} for n, c in self.files.items() if n not in self.readonly]

    async def _await_baseline(self) -> None:
        if self._baseline_task is None:
            return
        task, self._baseline_task = self._baseline_task, None
        _, log = await task
        if any(s in log for s in UNAVAILABLE_MARKERS) and "! " not in log:
            self.unavailable = log.strip()[:200]
        self.baseline = parse_log(log)

    # -- tools -------------------------------------------------------------
    def _t_read_file(self, args: Dict[str, Any]) -> str:
        name = args.get("name") or self.active
        if name not in self.files:
            return f"No text file named {name!r}. Files: {', '.join(self.files)}"
        lines = self.files[name].split("\n")
        start = max(1, int(args.get("start") or 1))
        end = min(len(lines), int(args.get("end") or start + READ_MAX_LINES - 1), start + READ_MAX_LINES - 1)
        return f"{name} lines {start}-{end} of {len(lines)}:\n{_numbered(lines[start - 1:end], start)}"

    def _t_search(self, args: Dict[str, Any]) -> str:
        pattern = str(args.get("pattern") or "")[:PATTERN_MAX_LEN]
        if not pattern:
            return "search requires a non-empty pattern"
        try:
            rx = re.compile(pattern)
        except re.error:
            rx = re.compile(re.escape(pattern))
        names = [args["name"]] if args.get("name") in self.files else list(self.files)
        hits = [f"{n}:{i}: {line.strip()[:160]}" for n in names for i, line in enumerate(self.files[n].split("\n"), 1) if rx.search(line)]
        return "\n".join(hits[:SEARCH_MAX_HITS]) + (f"\n...[{len(hits) - SEARCH_MAX_HITS} more]" if len(hits) > SEARCH_MAX_HITS else "") if hits else "no matches"

    def _t_edit(self, args: Dict[str, Any]) -> str:
        lines = self.files[self.active].split("\n")
        try:
            start, end = int(args["start_line"]), int(args["end_line"])
        except (KeyError, TypeError, ValueError):
            return f"edit requires integer start_line and end_line; received start_line={args.get('start_line')!r}, end_line={args.get('end_line')!r}. Send both."
        original, replacement = str(args.get("original") or ""), str(args.get("replacement") or "")
        if not (1 <= start <= len(lines) + 1 and start - 1 <= end <= len(lines)):
            return f"line range {start}-{end} out of bounds (file has {len(lines)} lines)"
        actual = lines[start - 1:end]
        if [s.rstrip() for s in actual] != [s.rstrip() for s in original.split("\n")] and not (end == start - 1 and not original):
            return f"original does not match lines {start}-{end}; current text:\n{_numbered(actual, start)}\nRe-read and retry."
        new_lines = replacement.split("\n") if replacement else []
        lines[start - 1:end] = new_lines
        self.files[self.active] = "\n".join(lines)
        self.edits, self.dirty = self.edits + 1, True
        return f"applied: lines {start}-{end} -> {len(new_lines)} lines (empty replacement deletes). File now {len(lines)} lines; later line numbers shifted."

    async def _t_compile(self, _args: Dict[str, Any]) -> str:
        await self._await_baseline()
        if self.unavailable:
            return f"compile unavailable: {self.unavailable}. Verification cannot run; finish when the edit is complete."
        if self.compiles >= MAX_COMPILES:
            return f"compile budget ({MAX_COMPILES}) exhausted"
        self.compiles += 1
        ok, self.last_log = await self.compiler(self._compile_files(), self.main_file or "")
        current = parse_log(self.last_log)
        self.new_errors, fixed = regressions(self.baseline, current)
        self.dirty = False
        errs = sum(d.kind == "error" for d in current)
        head = f"compile #{self.compiles}: {'pdf produced' if ok else 'no pdf'}; errors {errs} (baseline {sum(d.kind == 'error' for d in self.baseline)}); new {len(self.new_errors)}; fixed {fixed}"
        return "\n".join([head, *(f"- NEW: {d.message} (l.{d.line})" for d in self.new_errors[:10]), "Use inspect_log for detail."])

    def _t_inspect_log(self, args: Dict[str, Any]) -> str:
        if self.last_log is None:
            return "no compile log yet; call compile first"
        mode, ctx = args.get("mode") or "errors", max(0, min(int(args.get("context") or 2), 5))
        if mode in ("errors", "warnings"):
            kind = mode[:-1]
            hits = [d.excerpt for d in parse_log(self.last_log) if d.kind == kind]
            return "\n---\n".join(hits) if hits else f"no {mode}"
        lines = unwrap_log(self.last_log)
        if mode == "tail":
            return "\n".join(lines[-40:])
        try:
            rx = re.compile(str(args.get("pattern") or "")[:PATTERN_MAX_LEN] or r"^!")
        except re.error as e:
            return f"bad pattern: {e}"
        idx = [i for i, line in enumerate(lines) if rx.search(line)][:20]
        return "\n--\n".join("\n".join(lines[max(0, i - ctx):i + ctx + 1]) for i in idx) or "no matches"

    def _gate(self) -> Optional[str]:
        if not self.edits or self.unavailable:
            return None
        if self.dirty and self.compiles < MAX_COMPILES:
            return "REJECTED: you edited after the last compile. Call compile to verify first."
        if self.new_errors and not self.dirty:
            return f"REJECTED: the last compile has {len(self.new_errors)} error(s) the baseline did not. Inspect the log and fix them."
        return None

    # -- prompt ------------------------------------------------------------
    def _prompt(self) -> str:
        lines = self.files[self.active].split("\n")
        if len(lines) <= FULL_VIEW_LINES:
            view, note = _numbered(lines, 1), "full file"
        else:
            c = (self.selection or {}).get("start_line") or self.cursor_line or 1
            lo = max(1, c - FULL_VIEW_LINES // 2)
            view, note = _numbered(lines[lo - 1:lo - 1 + FULL_VIEW_LINES], lo), f"window; file has {len(lines)} lines, use read_file for the rest"
        files = ", ".join(f"{n} ({c.count(chr(10)) + 1} lines)" for n, c in self.files.items())
        sel = f"\nUSER SELECTION lines {self.selection['start_line']}-{self.selection['end_line']}:\n{self.selection.get('text', '')[:3000]}\n" if self.selection else ""
        hist = "\n\n".join(
            f"Step {k}\nThought: {s.thought}\nAction: {s.action} {json.dumps(s.args)[:400]}\nObservation: {s.observation if k > len(self.steps) - KEEP_FULL_OBS else _clip(s.observation, OLD_OBS_CAP)}"
            for k, s in enumerate(self.steps, 1))
        return f"""You are a LaTeX editing agent running a ReAct loop. Each turn return JSON {{"thought", "action", "args"}}.

TOOLS
- read_file {{name, start?, end?}}: numbered lines, max {READ_MAX_LINES}.
- search {{pattern, name?}}: regex over project text files.
- edit {{start_line, end_line, original, replacement}}: replace lines start_line..end_line (1-based, inclusive) of the ACTIVE file `{self.active}`. `original` must equal those lines exactly; an empty replacement deletes them. To insert, set end_line = start_line - 1 and original "". Line numbers refer to the CURRENT file below.
- compile {{}}: compile the project; reports errors your edits introduced versus the pre-edit baseline.
- inspect_log {{mode: errors|warnings|grep|tail, pattern?, context?}}: inspect the last compile log.
- finish {{explanation}}: end the run. Refused while edits are uncompiled or the last compile has new errors.

RULES
1. Make the minimum edits needed; preserve existing style. Only the active file can be edited.
2. After editing, compile; if there are new errors, inspect_log, fix, recompile.
3. Pre-existing baseline errors are not yours to fix unless the instruction asks.
4. For questions that need no edit, finish immediately with the answer as the explanation.
5. Budget: {MAX_STEPS} steps, {MAX_COMPILES} compiles. Steps used: {len(self.steps)}.
6. `args` must contain every field; set the ones this action does not use to null.

PROJECT FILES: {files}
MAIN FILE: {self.main_file or 'none'}
{self.attachment_note}{sel}
CURRENT ACTIVE FILE `{self.active}` ({note}; reflects your edits):
{view}

USER INSTRUCTION: {self.instruction}

HISTORY:
{hist or '(none yet)'}"""

    # -- driver ------------------------------------------------------------
    def _result(self, explanation: str, stop: str) -> Dict[str, Any]:
        changes = diff_changes(self.original, self.files[self.active])
        verified = not self.unavailable and not self.dirty and not self.new_errors
        status = "no_changes" if not changes else "verified" if verified else "unverified"
        if status == "unverified":
            explanation += f"\n\n[Not verified: {self.unavailable or ('new compile errors remain' if self.new_errors else 'edits were not compiled')}; stop reason: {stop}.]"
        elif stop != "finish":
            explanation += f"\n\n[Stopped ({stop}) before finishing. Last tool result: {_clip(self.steps[-1].observation, 200) if self.steps else 'none'}]"
        return {"type": "result", "explanation": explanation, "changes": changes,
                "tokens": self.tokens, "status": status, "steps": len(self.steps), "compiles": self.compiles}

    async def run(self) -> AsyncIterator[Dict[str, Any]]:
        t_run = time.monotonic()
        if self.main_file:
            self._baseline_task = asyncio.create_task(self.compiler(self._compile_files(), self.main_file))
        tools = {"read_file": self._t_read_file, "search": self._t_search, "edit": self._t_edit, "inspect_log": self._t_inspect_log}
        stop = "step budget"
        try:
            while len(self.steps) < MAX_STEPS:
                if self.tokens >= MAX_RUN_TOKENS or time.monotonic() - t_run > RUN_DEADLINE_S:
                    stop = "token budget" if self.tokens >= MAX_RUN_TOKENS else "deadline"
                    break
                t0, obs = time.monotonic(), ""
                try:
                    act, tok = await self.llm(self._prompt())
                    self.tokens += tok
                    thought, action, args = str(act.get("thought", "")), str(act.get("action", "")), act.get("args") or {}
                    if not isinstance(args, dict):
                        raise ValueError("args must be an object")
                    args = {k: v for k, v in args.items() if v is not None}
                except ValueError as e:
                    thought, action, args, tok = "", "", {}, 0
                    obs = f"Your response was not a valid action JSON ({e}). Return {{thought, action, args}}."
                llm_ms, t1 = int((time.monotonic() - t0) * 1000), time.monotonic()
                if action == "finish":
                    await self._await_baseline()
                    obs = self._gate() or ""
                    if not obs:
                        self._trace(len(self.steps) + 1, action, args, "accepted", tok, llm_ms, 0)
                        yield self._result(str(args.get("explanation") or thought), "finish")
                        return
                elif action == "compile":
                    obs = await self._t_compile(args)
                elif action in tools:
                    obs = tools[action](args)
                elif not obs:
                    obs = f"unknown action {action!r}; choose one of {', '.join(ACTIONS)}"
                obs = _clip(obs, OBS_CAP)
                self.steps.append(Step(thought, action, args, obs))
                tool_ms = int((time.monotonic() - t1) * 1000)
                self._trace(len(self.steps), action, args, obs, tok, llm_ms, tool_ms)
                yield {"type": "step", "step": len(self.steps), "thought": thought, "action": action,
                       "args": self._args_summary(action, args), "observation": _clip(obs, 600), "tokens": tok, "ms": llm_ms + tool_ms}
            await self._await_baseline()
            yield self._result(self.steps[-1].thought if self.steps else "", stop)
        finally:
            if self._baseline_task is not None and not self._baseline_task.done():
                self._baseline_task.cancel()

    @staticmethod
    def _args_summary(action: str, args: Dict[str, Any]) -> str:
        if action == "edit":
            return f"lines {args.get('start_line')}-{args.get('end_line')}"
        return _clip(json.dumps(args), 160)

    def _trace(self, step: int, action: str, args: Dict[str, Any], obs: str, tokens: int, llm_ms: int, tool_ms: int) -> None:
        logger.info("agent_step %s", json.dumps({
            "run_id": self.run_id, "step": step, "action": action, "args": self._args_summary(action, args),
            "obs_chars": len(obs), "obs_head": obs[:120], "tokens": tokens, "run_tokens": self.tokens,
            "llm_ms": llm_ms, "tool_ms": tool_ms, "edits": self.edits, "compiles": self.compiles,
            "new_errors": len(self.new_errors), "dirty": self.dirty}))


def build_loop(llm: LLM, compiler: Compiler, *, document: str, instruction: str, file_name: Optional[str],
               project_files: Optional[List[Dict[str, Any]]], main_file: Optional[str],
               selection: Optional[Dict[str, Any]] = None, cursor_line: Optional[int] = None,
               attachment: Optional[Dict[str, Any]] = None, pdf_visible: bool = False) -> AgentLoop:
    active = file_name or "main.tex"
    text = [f for f in project_files or [] if f.get("type") not in BINARY_TYPES and f.get("name") and f["name"] != active]
    files = {active: document, **{f["name"]: str(f.get("content") or "") for f in text}}
    types = {f["name"]: f.get("type") or "" for f in text}
    if main_file not in files:
        main_file = next((n for n, c in files.items() if n.endswith(".tex") and "\\documentclass" in c), None)
    readonly, note = frozenset(), ""
    if attachment:
        files[attachment["name"]], readonly = attachment["text"], frozenset({attachment["name"]})
        note = (f"ATTACHED PDF: text extract is the read-only file `{attachment['name']}` ({attachment['pages']} pages, '--- page N ---' markers); "
                "use read_file/search on it." + (" The original PDF is also attached to this request: read equations, tables and layout from "
                                                 "it, since the extract flattens math." if pdf_visible else "") + "\n")
    return AgentLoop(llm=llm, compiler=compiler, instruction=instruction, files=files, file_types=types,
                     active=active, main_file=main_file, selection=selection, cursor_line=cursor_line,
                     readonly=readonly, attachment_note=note)
