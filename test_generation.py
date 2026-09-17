"""Self-check for document generation plumbing. Run: python test_generation.py"""
from api.services.gemini import GeminiService, MAX_SOURCE_CHARS

locate = GeminiService._locate_sections
figures_for = GeminiService._section_figures
refs = GeminiService._extract_image_references

SOURCE = (
    "Introduction\nWe study the effect of heat on steel beams under load.\n"
    "Methods\nSpecimens were heated to 600C and measured every 30 seconds.\n"
    "Results\nYield strength fell by 42 percent at the highest temperature.\n"
)


def test_anchors_resolve_in_document_order():
    sections = [
        {"heading": "Introduction", "anchor": "We study the effect of heat on steel"},
        {"heading": "Methods", "anchor": "Specimens were heated to 600C and measured"},
        {"heading": "Results", "anchor": "Yield strength fell by 42 percent at the"},
    ]
    spans, resolved = locate(SOURCE, sections)
    assert resolved == 3
    assert [a for a, _ in spans] == sorted(a for a, _ in spans)
    assert "Specimens were heated" in SOURCE[spans[1][0]:spans[1][1]]


def test_unresolved_anchor_still_yields_a_usable_span():
    sections = [
        {"heading": "Introduction", "anchor": "We study the effect of heat on steel"},
        {"heading": "Ghost", "anchor": "text that never appears in the source at all"},
        {"heading": "Results", "anchor": "Yield strength fell by 42 percent at the"},
    ]
    spans, resolved = locate(SOURCE, sections)
    assert resolved == 2
    assert all(b > a for a, b in spans), "every section needs a non-empty span"


def test_invented_figure_names_are_dropped():
    by_name = {"figure1.png": "data:image/png;base64,AAA"}
    assert figures_for({"figures": ["figure1.png"]}, by_name) == ["figure1.png"]
    assert figures_for({"figures": ["plot_of_results.png"]}, by_name) == []
    assert figures_for({}, by_name) == []


def test_every_figure_reaches_exactly_one_section():
    by_name = {"figure1.png": "a", "figure2.png": "b", "figure3.png": "c"}
    sections = [
        {"figures": ["figure1.png"]},
        {"figures": []},
        {"figures": ["figure2.png", "figure3.png"]},
    ]
    assigned = [n for sec in sections for n in figures_for(sec, by_name)]
    assert sorted(assigned) == sorted(by_name), "a figure assigned nowhere is a dropped figure"
    assert len(assigned) == len(set(assigned)), "a figure must not be placed twice"


def test_generated_references_match_saved_filenames():
    latex = r"\begin{figure}\includegraphics[width=0.7\textwidth]{figure1.png}\end{figure}"
    saved = {"figure1.png", "figure2.png"}
    assert refs(latex) == ["figure1.png"]
    assert [r for r in refs(latex) if r not in saved] == [], "no spurious missing_images"


def test_truncation_threshold_is_shared():
    assert MAX_SOURCE_CHARS == 40000
    assert len("x" * (MAX_SOURCE_CHARS + 1)) > MAX_SOURCE_CHARS
    assert not len("x" * MAX_SOURCE_CHARS) > MAX_SOURCE_CHARS


def test_pdf_passes_through_the_part_builder_unchanged():
    # Phase 2 rests on this: the existing image-part builder already emits a PDF correctly,
    # so nothing special is needed to attach the source document itself.
    build = GeminiService._build_image_parts
    parts = build(None, ["data:application/pdf;base64,JVBERi0xLjQK"])
    assert parts == [{"inline_data": {"mime_type": "application/pdf", "data": "JVBERi0xLjQK"}}]
    assert build(None, ["AAAA"])[0]["inline_data"]["mime_type"] == "image/jpeg"
    assert build(None, None) == []


def test_cache_ttl_is_expressed_in_seconds():
    from api.services.gemini import gemini_service
    ttl = gemini_service.prompt_cache.ttl_seconds
    assert isinstance(ttl, int) and ttl > 0
    assert f"{ttl}s".endswith("s"), "the API wants a duration string, not a bare number"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
