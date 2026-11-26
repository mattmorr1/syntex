"""Agent loop harness checks. Run: python -m pytest test_agent_loop.py"""
import asyncio
import shutil

import pytest

from api.services.agent_loop import MAX_COMPILES, MAX_STEPS, build_loop, diff_changes, parse_log, regressions, unwrap_log

DOC = "\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}"
BASE_LOG = "This is pdfTeX\nOutput written on main.pdf (1 page).\n"
BROKEN_LOG = "! Undefined control sequence.\nl.3 Hello \\badmacro\n                    world.\n"
MISSING_IMG_LOG = "! LaTeX Error: File `fig1.png' not found.\n\nl.7 \\includegraphics{fig1.png}\n"


def scripted(*actions):
    """LLM stub that replays actions in order and records every prompt it saw."""
    queue, prompts = list(actions), []

    async def llm(prompt):
        prompts.append(prompt)
        nxt = queue.pop(0) if queue else {"thought": "out of script", "action": "finish", "args": {"explanation": "done"}}
        if isinstance(nxt, Exception):
            raise nxt
        return nxt, 10
    llm.prompts = prompts
    return llm


def compiler_returning(*logs):
    """First log is the baseline; later logs are returned per post-edit compile (last repeats)."""
    calls = []

    async def compile_(files, main):
        calls.append({f["name"]: f["content"] for f in files})
        return True, logs[min(len(calls) - 1, len(logs) - 1)]
    compile_.calls = calls
    return compile_


def act(action, thought="", **args):
    return {"thought": thought, "action": action, "args": args}


def run(loop):
    async def go():
        return [e async for e in loop.run()]
    return asyncio.run(go())


def make(llm, compiler, document=DOC, files=None, main="main.tex", instruction="edit it"):
    return build_loop(llm, compiler, document=document, instruction=instruction, file_name="main.tex",
                      project_files=files, main_file=main)


# -- log inspector --------------------------------------------------------

def test_parse_log_extracts_errors_with_line_and_warnings():
    log = BROKEN_LOG + "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 12.\n"
    diags = parse_log(log)
    assert [(d.kind, d.line) for d in diags] == [("error", 3), ("warning", 12)]
    assert diags[0].message == "Undefined control sequence." and "l.3" in diags[0].excerpt


def test_unwrap_rejoins_79_char_wrapped_lines():
    long = "LaTeX Warning: " + "x" * 64
    assert len(long) == 79
    assert unwrap_log(long + "\nrest on input line 4.\n") == [long + "rest on input line 4."]


def test_regressions_ignore_baseline_errors_and_count_fixed():
    base = parse_log(MISSING_IMG_LOG)
    new, fixed = regressions(base, parse_log(MISSING_IMG_LOG + BROKEN_LOG))
    assert [d.message for d in new] == ["Undefined control sequence."] and fixed == 0
    new, fixed = regressions(base, [])
    assert new == [] and fixed == 1


def test_regressions_count_duplicates_as_multiset():
    two = parse_log(BROKEN_LOG + BROKEN_LOG.replace("l.3", "l.9"))
    new, _ = regressions(parse_log(BROKEN_LOG), two)
    assert len(new) == 1


# -- diff output -----------------------------------------------------------

def test_diff_changes_roundtrip_via_frontend_splice():
    old = "a\nb\nc\nd\ne"
    new = "a\nB\nc\nx\ny\nd"
    doc = old.split("\n")
    for ch in reversed(diff_changes(old, new)):
        doc[ch["start_line"] - 1:ch["end_line"]] = ch["replacement"].split("\n")
    assert "\n".join(doc) == new


def test_diff_changes_pure_delete_never_yields_empty_replacement():
    chs = diff_changes("a\nb\nc", "a\nc")
    assert chs and all(c["replacement"] for c in chs)


# -- gate ------------------------------------------------------------------

def test_finish_rejected_until_compiled_then_accepted():
    llm = scripted(
        act("edit", start_line=3, end_line=3, original="Hello world.", replacement="Hello there."),
        act("finish", explanation="early"),
        act("compile"),
        act("finish", explanation="changed greeting"),
    )
    comp = compiler_returning(BASE_LOG, BASE_LOG)
    events = run(make(llm, comp))
    steps = [e for e in events if e["type"] == "step"]
    assert "REJECTED" in steps[1]["observation"]
    result = events[-1]
    assert result["type"] == "result" and result["status"] == "verified"
    assert result["changes"] == [{"start_line": 3, "end_line": 3, "original": "Hello world.", "replacement": "Hello there.", "reason": "agent edit"}]
    assert comp.calls[0]["main.tex"] == DOC, "baseline must compile the pre-edit snapshot"
    assert "Hello there." in comp.calls[1]["main.tex"]


def test_finish_rejected_while_new_errors_then_fix_loop():
    llm = scripted(
        act("edit", start_line=3, end_line=3, original="Hello world.", replacement="Hello \\badmacro world."),
        act("compile"),
        act("finish", explanation="x"),
        act("inspect_log", mode="errors"),
        act("edit", start_line=3, end_line=3, original="Hello \\badmacro world.", replacement="Hello world!"),
        act("compile"),
        act("finish", explanation="fixed"),
    )
    events = run(make(llm, compiler_returning(BASE_LOG, BROKEN_LOG, BASE_LOG)))
    steps = {e["step"]: e for e in events if e["type"] == "step"}
    assert "new 1" in steps[2]["observation"]
    assert "REJECTED" in steps[3]["observation"]
    assert "Undefined control sequence" in steps[4]["observation"]
    assert events[-1]["status"] == "verified" and events[-1]["changes"][0]["replacement"] == "Hello world!"


def test_preexisting_errors_do_not_block_finish():
    llm = scripted(
        act("edit", start_line=3, end_line=3, original="Hello world.", replacement="Hi."),
        act("compile"),
        act("finish", explanation="ok"),
    )
    events = run(make(llm, compiler_returning(MISSING_IMG_LOG, MISSING_IMG_LOG)))
    assert events[-1]["status"] == "verified"


def test_answer_only_finish_needs_no_compile():
    comp = compiler_returning(BASE_LOG)
    events = run(make(scripted(act("finish", explanation="It is an article.")), comp))
    assert events == [events[-1]] and events[-1]["status"] == "no_changes" and events[-1]["explanation"] == "It is an article."


def test_step_budget_ends_unverified_with_changes():
    edit = act("edit", start_line=3, end_line=3, original="Hello world.", replacement="Hey.")
    llm = scripted(edit, *[act("read_file", start=1, end=2)] * (MAX_STEPS + 5))
    events = run(make(llm, compiler_returning(BASE_LOG)))
    assert sum(e["type"] == "step" for e in events) == MAX_STEPS
    assert events[-1]["status"] == "unverified" and events[-1]["changes"]
    assert "Not verified" in events[-1]["explanation"]


def test_compile_budget_allows_unverified_finish():
    edit = lambda r: act("edit", start_line=3, end_line=3, original="Hello world." if r == 0 else f"v{r}", replacement=f"v{r + 1}")
    seq = [x for r in range(MAX_COMPILES) for x in (edit(r), act("compile"))]
    llm = scripted(*seq, edit(MAX_COMPILES), act("finish", explanation="out of compiles"))
    events = run(make(llm, compiler_returning(BASE_LOG)))
    assert events[-1]["type"] == "result" and events[-1]["status"] == "unverified"


def test_no_main_file_marks_unavailable_and_allows_finish():
    llm = scripted(
        act("edit", start_line=1, end_line=1, original="\\newcommand{\\x}{1}", replacement="\\newcommand{\\x}{2}"),
        act("finish", explanation="cls tweak"),
    )
    loop = build_loop(llm, compiler_returning(BASE_LOG), document="\\newcommand{\\x}{1}", instruction="bump",
                      file_name="macros.sty", project_files=None, main_file=None)
    events = run(loop)
    assert events[-1]["status"] == "unverified" and "no main .tex" in events[-1]["explanation"]


# -- tools -----------------------------------------------------------------

def test_edit_with_stale_original_is_refused_and_shows_current_text():
    llm = scripted(act("edit", start_line=3, end_line=3, original="Goodbye.", replacement="x"))
    events = run(make(llm, compiler_returning(BASE_LOG)))
    obs = events[0]["observation"]
    assert "does not match" in obs and "3: Hello world." in obs
    assert events[-1]["status"] == "no_changes"


def test_insert_and_delete_semantics():
    llm = scripted(
        act("edit", start_line=3, end_line=2, original="", replacement="Inserted."),
        act("edit", start_line=4, end_line=4, original="Hello world.", replacement=""),
        act("compile"),
        act("finish", explanation="moved"),
    )
    events = run(make(llm, compiler_returning(BASE_LOG)))
    doc = DOC.split("\n")
    for ch in reversed(events[-1]["changes"]):
        doc[ch["start_line"] - 1:ch["end_line"]] = ch["replacement"].split("\n")
    assert doc == ["\\documentclass{article}", "\\begin{document}", "Inserted.", "\\end{document}"]


def test_search_and_read_supporting_files_binaries_excluded():
    files = [{"name": "refs.bib", "content": "@article{knuth84,}", "type": "bib"},
             {"name": "fig.png", "content": "iVBORw0", "type": "png"}]
    llm = scripted(act("search", pattern="knuth\\d+"), act("read_file", name="fig.png"), act("search", pattern="(unclosed"))
    events = run(make(llm, compiler_returning(BASE_LOG), files=files))
    obs = [e["observation"] for e in events if e["type"] == "step"]
    assert obs[0].startswith("refs.bib:1:")
    assert "No text file named 'fig.png'" in obs[1]
    assert obs[2] == "no matches", "invalid regex falls back to a literal search"


def test_inspect_log_before_compile_and_grep_context():
    llm = scripted(act("inspect_log"), act("edit", start_line=3, end_line=3, original="Hello world.", replacement="Hi."),
                   act("compile"), act("inspect_log", mode="grep", pattern="Undefined", context=1))
    events = run(make(llm, compiler_returning(BASE_LOG, BROKEN_LOG)))
    obs = [e["observation"] for e in events if e["type"] == "step"]
    assert "no compile log yet" in obs[0]
    assert obs[3].splitlines() == ["! Undefined control sequence.", "l.3 Hello \\badmacro"]


def test_invalid_json_is_an_observation_not_a_crash():
    llm = scripted(ValueError("Expecting value"), act("finish", explanation="ok"))
    events = run(make(llm, compiler_returning(BASE_LOG)))
    assert "not a valid action JSON" in events[0]["observation"] and events[-1]["type"] == "result"


def test_provider_failure_propagates():
    llm = scripted(RuntimeError("503 from provider"))
    with pytest.raises(RuntimeError):
        run(make(llm, compiler_returning(BASE_LOG)))


def test_history_is_pruned_but_recent_observations_stay_full():
    big = "\n".join(f"line {i}" for i in range(300))
    llm = scripted(*[act("read_file", start=1, end=200, thought=f"t{i}") for i in range(5)], act("finish", explanation=""))
    loop = make(llm, compiler_returning(BASE_LOG), document=big, main=None)
    run(loop)
    last = llm.prompts[-1]
    assert last.count("...[truncated") == 2, "only the oldest observations (beyond the last 3) are clipped"


@pytest.mark.skipif(not shutil.which("pdflatex"), reason="pdflatex not installed")
def test_real_compile_catches_introduced_error():
    from api.services.latex import latex_service
    llm = scripted(
        act("edit", start_line=3, end_line=3, original="Hello world.", replacement="Hello \\nosuchmacro world."),
        act("compile"),
        act("finish", explanation="should be refused"),
    )
    events = run(make(llm, latex_service.compile_log))
    steps = [e for e in events if e["type"] == "step"]
    assert "new 1" in steps[1]["observation"], steps[1]["observation"]
    assert "REJECTED" in steps[2]["observation"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))


def test_schema_requires_every_arg_and_nulls_are_dropped():
    from api.services.agent_loop import ACTION_SCHEMA, ARG_TYPES, build_loop
    args_schema = ACTION_SCHEMA["properties"]["args"]
    assert set(args_schema["required"]) == set(ARG_TYPES) and all(p["nullable"] for p in args_schema["properties"].values())
    nulls = dict.fromkeys(ARG_TYPES)
    script = [{"thought": "", "action": "read_file", "args": {**nulls, "start": 1}},
              {"thought": "", "action": "finish", "args": {**nulls, "explanation": "done"}}]

    async def llm(prompt):
        return script.pop(0), 0

    async def compiler(files, main):
        return True, ""

    loop = build_loop(llm, compiler, document="\\documentclass{article}\nx", instruction="i", file_name="main.tex",
                      project_files=[], main_file="main.tex")
    events = asyncio.run(_collect(loop))
    assert loop.steps[0].args == {"start": 1} and events[-1]["explanation"] == "done"


def test_budget_stop_explains_why_and_echoes_bad_edit_args():
    from api.services.agent_loop import MAX_STEPS, build_loop

    async def llm(prompt):
        return {"thought": "I will edit", "action": "edit", "args": {"start_line": 1}}, 0

    async def compiler(files, main):
        return True, ""

    loop = build_loop(llm, compiler, document="\\documentclass{article}", instruction="i", file_name="main.tex",
                      project_files=[], main_file="main.tex")
    result = asyncio.run(_collect(loop))[-1]
    assert len(loop.steps) == MAX_STEPS and "end_line=None" in loop.steps[0].observation
    assert result["status"] == "no_changes" and "[Stopped (step budget)" in result["explanation"]


async def _collect(loop):
    return [e async for e in loop.run()]
