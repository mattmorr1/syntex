"""Generation fidelity (split, completeness retry, ref reconciliation, single-pass continuation) and chat PDF attachments."""
import asyncio
import base64
import re

import fitz
import pytest
from fastapi import HTTPException

from api.models.schemas import AgentAttachment
from api.routers.ai import _read_attachment
from api.services import gemini as g
from api.services.agent_loop import build_loop


def run(coro):
    return asyncio.run(coro)


def para(i: int, eq: bool = False) -> str:
    return f"Paragraph {i} " + "words " * 60 + ("\nY = a + b X (%d)" % i if eq else "") + "\n\n"


# -- pure helpers -------------------------------------------------------------
def test_split_prefers_subsection_heading_near_middle():
    text = para(0) * 20 + "3.2 Estimation Strategy\n" + para(1) * 20
    pieces = g.split_source(text, len(text) - 1)
    assert len(pieces) == 2 and pieces[1].startswith("3.2 Estimation Strategy")
    assert "".join(pieces) == text


def test_split_is_lossless_and_bounded():
    text = "".join(para(i) for i in range(200))
    pieces = g.split_source(text, 5000)
    assert "".join(pieces) == text and all(len(p) <= 5000 for p in pieces)


def test_split_without_breaks_still_terminates():
    pieces = g.split_source("x" * 10_001, 1000)
    assert "".join(pieces) == "x" * 10_001 and all(len(p) <= 1000 for p in pieces)


def test_counts():
    src = "y = x (1)\nz = w (2)\nsee (1)\nTable 1: Results\nTable 1 shows\nTable 2. More\n"
    assert g.source_counts(src) == (2, 2)
    tex = (r"\begin{equation}a\end{equation}\begin{align*}b\\c\\\end{align*}\[d\]"
           r"\begin{tabular}{c}x\\[2pt]\end{tabular}")
    assert g.latex_counts(tex) == (4, 1)


def test_reconcile_refs():
    tex = r"\label{eq:ols}\label{tab:Main-Results}\label{fig:a}\label{a}" \
          r"\eqref{eqn:ols} \ref{tab:main_results} \cref{eq:ols,sec:missing} \ref{fig:a2}\ref{x:a}"
    out, unresolved = g.reconcile_refs(tex)
    assert r"\eqref{eq:ols}" in out and r"\ref{tab:Main-Results}" in out and r"\cref{eq:ols,sec:missing}" in out
    assert unresolved == ["fig:a2", "sec:missing", "x:a"]  # x:a is ambiguous between fig:a and a


# -- chunked pipeline ---------------------------------------------------------
class FakeModel:
    """Scripted _call_api: section fills truncate above `cut_over` chars of source; first fills can drop equations."""

    def __init__(self, cut_over: int = 10**9, drop_first: bool = False):
        self.cut_over, self.drop_first, self.fills, self.prompts = cut_over, drop_first, 0, []

    async def __call__(self, model, prompt, temperature=0.1, max_tokens=2048, api_key=None, images=None,
                       response_schema=None, cached_content=None, thinking_level=None):
        self.prompts.append(prompt)
        if "auditing an academic document" in prompt:
            return "inventory", 1
        src = prompt.split("SOURCE TEXT FOR THIS SECTION:\n", 1)[1].rsplit("\n\nBEGIN LATEX", 1)[0]
        self.fills += 1
        if len(src) > self.cut_over:
            raise g.TokenLimitError("cut", partial_text=r"\section{X} partial", tokens=5)
        nums = re.findall(r"\((\d+)\)\s*$", src, re.MULTILINE)
        if self.drop_first and "CORRECTION REQUIRED" not in prompt:
            nums = nums[:1]
        return "".join(rf"\begin{{equation}}e{n}\end{{equation}}" for n in nums) + f"%len={len(src)}", 10


def chunked(monkeypatch, content, model, sections=None):
    svc = g.GeminiService()
    monkeypatch.setattr(svc, "_call_api", model)
    secs = sections or [{"heading": "Method", "placeholder": "SECTION_0", "anchor": content.split()[0] + " " + " ".join(content.split()[1:8]), "figures": []}]

    async def structure(*a, **k):
        return {"preamble": r"\documentclass{article}\begin{document}", "sections": secs, "postamble": r"\end{document}"}

    monkeypatch.setattr(svc, "_generate_structure", structure)
    return run(svc._generate_document_chunked(content, "plain", "", "", "", None, None, 65536))


def test_long_section_is_split_and_every_part_filled(monkeypatch):
    content = "".join(para(i, eq=True) for i in range(80))
    model = FakeModel()
    tex, _, report = chunked(monkeypatch, content, model)
    assert report["parts"] == len(g.split_source(content, g.SPLIT_CHARS)) > 1
    assert g.latex_counts(tex)[0] == 80 and not report["truncated"] and not report["incomplete"]
    assert any("part 2 of" in p and "Do NOT output \\section" in p for p in model.prompts)


def test_truncated_part_is_resplit_then_reported(monkeypatch):
    content = "".join(para(i, eq=True) for i in range(30))
    tex, _, report = chunked(monkeypatch, content, FakeModel(cut_over=3000))
    assert g.latex_counts(tex)[0] == 30 and not report["truncated"]

    tex, _, report = chunked(monkeypatch, content, FakeModel(cut_over=100))
    assert report["truncated"] and "WARNING: output hit the token limit" in tex


def test_missing_equations_trigger_one_corrective_retry(monkeypatch):
    content = "".join(para(i, eq=True) for i in range(5))
    model = FakeModel(drop_first=True)
    tex, _, report = chunked(monkeypatch, content, model)
    assert g.latex_counts(tex)[0] == 5 and not report["incomplete"] and model.fills == 2
    assert "reproduced only 1 of 5 numbered equations" in model.prompts[-1]


def test_failed_part_is_logged_and_reported_not_silent(monkeypatch, caplog):
    content = "".join(para(i) for i in range(10))
    secs = [{"heading": h, "placeholder": f"SECTION_{i}", "anchor": a, "figures": []}
            for i, (h, a) in enumerate([("A", "Paragraph 0 words words"), ("B", "Paragraph 5 words words"), ("C", "Paragraph 8 words words")])]
    model = FakeModel()

    async def flaky(*a, **k):
        if "Paragraph 5" in a[1] and "SOURCE TEXT" in a[1]:
            raise RuntimeError("boom")
        return await model(*a, **k)

    tex, _, report = chunked(monkeypatch, content, flaky, secs)
    assert report["failed"] == ["B"] and "GENERATION FAILED" in tex and "boom" in caplog.text


def test_single_pass_continuation_carries_source(monkeypatch):
    svc = g.GeminiService()
    calls = []

    async def fake(model, prompt, temperature=0.1, max_tokens=2048, api_key=None, images=None, **k):
        calls.append(prompt)
        if len(calls) == 1:
            raise g.TokenLimitError("cut", partial_text=r"\documentclass{article}\begin{document} first", tokens=1)
        return r"second \end{document}", 1

    monkeypatch.setattr(svc, "_call_api", fake)
    tex, _, report = run(svc.generate_document("short source (1)\n", "plain"))
    assert "SOURCE DOCUMENT:\nshort source (1)" in calls[1] and r"\end{document}" in tex
    assert report["path"] == "single_pass" and report["incomplete"] == ["document: equations 0/1, tables 0/0"]


# -- chat PDF attachment ------------------------------------------------------
def pdf_b64(text: str) -> str:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return base64.b64encode(data).decode()


def test_read_attachment_extracts_text_with_page_markers():
    att = run(_read_attachment(AgentAttachment(name="My Paper (v2).pdf", data=pdf_b64("Beta equals 0.42"))))
    assert att["name"] == "My_Paper__v2_.pdf.txt" and att["pages"] == 1
    assert "--- page 1 ---" in att["text"] and "Beta equals 0.42" in att["text"]


@pytest.mark.parametrize("data,code", [("not base64!!", 400), (base64.b64encode(b"hello").decode(), 400)])
def test_read_attachment_rejects_bad_input(data, code):
    with pytest.raises(HTTPException) as e:
        run(_read_attachment(AgentAttachment(name="x.pdf", data=data)))
    assert e.value.status_code == code


def test_attachment_is_readable_but_never_compiled():
    compiled = []

    async def compiler(files, main):
        compiled.append([f["name"] for f in files])
        return True, ""

    async def llm(prompt):
        return {"thought": "", "action": "finish", "args": {"explanation": "ok"}}, 0

    att = {"name": "paper.pdf.txt", "text": "--- page 1 ---\nalpha", "pdf": "", "pages": 1}
    loop = build_loop(llm, compiler, document="\\documentclass{article}", instruction="i", file_name="main.tex",
                      project_files=[], main_file="main.tex", attachment=att, pdf_visible=True)
    assert "paper.pdf.txt" in loop._t_search({"pattern": "alpha"}) and "original PDF is also attached" in loop._prompt()

    async def drive():
        return [e async for e in loop.run()]

    run(drive())
    assert compiled == [["main.tex"]]


def test_compile_check_drops_pending_figure_errors_only():
    from api.routers.projects import _compile_check
    tex = "\\documentclass{article}\\usepackage{graphicx}\\begin{document}\\includegraphics{figure1}\\undefinedmacro\\end{document}"
    errs = run(_compile_check([{"name": "main.tex", "content": tex, "type": "tex"}], ["figure1.png"]))
    if errs is None:
        pytest.skip("pdflatex not installed")
    assert len(errs) == 1 and "Undefined control sequence" in errs[0]
