# Syntex — what it's for

*Paste-ready for Notion. Headings map to Notion blocks; tables and callouts convert cleanly.*

---

## The problem

Academic writing happens in two places that don't talk to each other.

**Drafting happens in Word.** It's where supervisors leave comments, where co-authors are
comfortable, and where most people actually think. **Submission happens in LaTeX**, because
journals and departments require it, and because equations, citations and cross-references
are unusable without it.

The gap between them is a day of tedious, error-prone work. Someone retypes equations,
rebuilds tables, rewires figure references, and fixes the citation style — and then does it
again after the next round of comments. Nothing about that work is intellectual. All of it
is easy to get subtly wrong.

The existing options each solve one half:

| | Drafting | LaTeX output | AI assistance |
| --- | --- | --- | --- |
| Word | Good | Manual conversion | Generic, not LaTeX-aware |
| Overleaf | Poor | Good | Limited |
| Local TeX editor | Poor | Good | None |

---

## What Syntex does

**Upload the Word draft. Get a compiled LaTeX paper.**

Syntex reads the `.docx` — body text, tables and embedded images — plans a document
structure, writes each section as LaTeX, and returns a project that compiles to PDF. Figures
arrive already wired up with `\includegraphics` and labels. Then you keep working in a
browser editor built for the rest of the job.

### The loop after conversion

**Write with completions that understand LaTeX.** Suggestions appear as you type and know
they're inside an `align` environment or a `tabular`, not just that you're writing English.

**Ask for a rewrite.** Select a paragraph and describe the change — tighten this, make the
notation consistent, convert this list to a table. Changes come back as a diff to review, not
an opaque replacement.

**Move between source and output.** Click a sentence in the PDF and the cursor lands on the
line that produced it. Press <kbd>Ctrl</kbd>+<kbd>J</kbd> and the PDF scrolls to wherever
you're editing. On a 40-page thesis this is the difference between finding a paragraph in
seconds and hunting for it.

**Compile in place.** Errors appear as clickable rows and as markers in the margin, on the
line that caused them.

**Work together.** Several people can edit one document simultaneously, with live cursors —
no check-in, check-out, or emailing `final_v3_REALFINAL.tex`.

---

## Who it's for

**Research students** converting a chapter draft into a submittable document, repeatedly,
under deadline.

**Academics** who draft in Word with collaborators but submit in LaTeX, and currently pay a
conversion tax on every round.

**Departments** standardising on a house style — a `.cls` file uploaded once applies to every
document, and its custom commands become editor autocompletions.

---

## Why the conversion holds up

Converting a long paper is not one big request to a language model. A single pass runs out of
output partway through and silently truncates — which is exactly the failure you cannot
afford, because a document that is 80% there looks finished until someone reads it closely.

Syntex works in three passes: plan the skeleton, fill each section separately in parallel,
then reconcile labels and references across the whole thing.

The part that matters most is how sections are located in your source. The planning pass
quotes the opening words of each section verbatim; the application then finds those quotes in
your document and slices between them. The obvious alternative — asking the model which
character each section starts at — produces confident, invented numbers, and the slices then
overlap or leave gaps. In practice that means a paragraph appearing twice under different
headings, or vanishing. Quoting is something a model does reliably; counting characters is
not.

If too few of those quotes can be found, Syntex abandons the section-by-section route and
falls back rather than assembling a document out of guesses.

---

## What it doesn't do

Worth being straight about, so expectations are set before someone's deadline depends on it:

- **It doesn't replace proofreading.** Converted documents need reading before submission.
  The pipeline reproduces content; it doesn't verify it.
- **Very long documents are capped.** Conversion works on roughly the first 40,000 characters
  — about twenty pages of academic text. Book-length work needs splitting by chapter.
- **Complex Word layouts degrade.** Multi-column text boxes, tracked changes and heavy styling
  don't map onto LaTeX cleanly.
- **Word equations are not carried across.** The extractor reads paragraphs and tables;
  Word's own equation objects are not exposed by it and will be missing from the conversion.
  Equations typed as plain text survive. This is the single biggest thing to check on a
  converted maths-heavy paper.
- **Input is `.docx`, `.doc` or `.pdf`.** Not Google Docs. PDF extraction recovers text but
  not layout, so it suits a preprint better than a formatted manuscript.
- **It's not a citation manager.** It emits a `.bib` and wires up `\cite`, but it doesn't
  fetch or verify references.

---

## Getting started

1. Sign in — access is invite-only.
2. Upload a `.docx`, or start from a template: report, journal article, problem set, thesis,
   or letter.
3. Wait for conversion, then review the compiled PDF beside the source.
4. Edit, compile with <kbd>Ctrl</kbd>+<kbd>B</kbd>, download when it's right.

Bring your own API key under Settings if you'd rather use your own model quota.
