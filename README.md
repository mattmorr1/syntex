# Syntex

An AI-assisted LaTeX editor for academic writing. Upload a Word document and get back a
compiled, structured LaTeX paper — then keep editing it in a browser editor that compiles
to PDF, jumps between source and output, and can rewrite selections on request.

---

## What it does

**Turns a `.docx` or `.pdf` into a real LaTeX project.** Upload a draft; Syntex extracts the
text and embedded images, plans a document skeleton, fills each section, and returns a project with
`main.tex`, a bibliography, and the images already wired up with `\includegraphics`.

**Edits alongside you.** Inline completions suggest the next line or two as you type
(<kbd>Tab</kbd> to accept). An agent panel rewrites a selection or the whole file from an
instruction, streaming its changes back as a reviewable diff.

**Compiles and cross-references.** <kbd>Ctrl</kbd>+<kbd>B</kbd> compiles to PDF. Click
anywhere in the PDF to put the cursor on the source line that produced it, or press
<kbd>Ctrl</kbd>+<kbd>J</kbd> to go the other way. Compile errors appear as clickable rows
and as markers in the gutter.

**Organises and shares.** Documents group into folders and reorder by dragging. With a
collaboration hub configured, several people edit one project at once with live cursors.

Starting templates: `report`, `journal`, `problem_set`, `thesis`, `letter`.

---

## How generation works

Long documents are not generated in one shot — a single pass runs out of output tokens
partway through a paper and truncates.

```
.docx/.pdf ─► extract text + images (python-docx, PyMuPDF)
      ─► PASS 1  skeleton: preamble, section list, postamble        (Flash)
      ─► PASS 2  fill each section in parallel, bounded             (Pro)
      ─► PASS 3  reconcile \label / \ref across sections            (Flash)
      ─► stitch ─► artifact cleanup ─► compile
```

Extraction reads `paragraphs` and `tables` only, so Word's native equation objects do not
survive the conversion — worth knowing before pointing a maths-heavy paper at it.

**Sections are located by anchor, not offset.** Pass 1 returns, for each section, a
verbatim quote of the source text where that section begins. Python then finds those
anchors with a forward-only, whitespace-flexible search and slices between them. Asking a
model for character offsets instead produces invented numbers, and the resulting slices
overlap or leave gaps — text duplicated across two sections, or dropped entirely.

Pass 2 is bounded by `SECTION_CONCURRENCY` (default 4). Unbounded fan-out on a long paper
collects rate limits, which the truncation path then turns into silently shortened
sections. If fewer than half the anchors resolve, or more than half the sections fail, the
chunked path is abandoned for a single-pass generation rather than stitching a document
out of guesses.

---

## Layout

```
api/          FastAPI backend
  routers/    auth, projects, upload, compile, ai, admin
  services/   gemini (generation), latex (compile + SyncTeX),
              firestore (persistence), storage (GCS), email, llm_provider
frontend/     React + Vite + MUI, Monaco editor, react-pdf viewer
collab/       Yjs collaboration hub — stateful, deploys separately
config/       settings, requirements, Cloud Build
docker/       production image (TeX Live + Python + built frontend)
templates/    starting LaTeX documents
```

API routes are mounted under `/auth`, `/projects`, `/ai`, `/admin`, plus `/upload`,
`/compile`, `/compiled-pdf/{id}`, `/synctex/{id}` and `/health` at the root.

---

## Running locally

Requires Python 3.11+, Node 20+, and a TeX distribution providing `pdflatex`, `bibtex` and
`synctex` (TeX Live or MacTeX).

```bash
# backend — dev mode: in-memory store, no cloud credentials needed
python3 -m venv .venv && .venv/bin/pip install -r config/requirements.txt
DEBUG=true JWT_SECRET=dev ADMIN_PASSWORD=dev \
  .venv/bin/python -m uvicorn api.main:app --port 8000

# frontend
cd frontend && npm install && npm run dev     # http://localhost:3000
```

With `DEBUG=true` and no Firebase key, the backend runs against an in-memory store and
accepts any email and password at sign-in. Without `GEMINI_API_KEY` the AI endpoints
return canned responses, so the editor is still exercisable. Compilation is real — it
shells out to your local `pdflatex`.

Optional: copy `frontend/.env.example` to `frontend/.env` to point at Firebase or a
collaboration hub.

```bash
# collaboration hub (optional)
cd collab && npm install && npm start          # ws://localhost:1234
# then set VITE_COLLAB_URL=ws://localhost:1234 in frontend/.env
```

### Checks

```bash
cd frontend && npx tsc --noEmit && npm run build
```

---

## Deploying

```bash
gcloud builds submit --config=config/cloudbuild.yaml
```

Builds the image (Kaniko, cached — TeX Live is a slow layer) and deploys to Cloud Run.

The collaboration hub is **not** part of that deploy. It holds long-lived websocket
connections and in-memory document state, which the API's configuration is wrong for:
`min-instances=0` drops sockets on cold start, and several instances without session
affinity put two collaborators on different machines. Deploy `collab/` as its own service
with `min-instances=1` and session affinity enabled.

The hub needs the **same `JWT_SECRET`** as the API and refuses to start without it. Access
is decided by the API — which knows project ownership — and asserted to the hub as a signed
token naming the room it admits, so the hub needs no database connection and a token for
one project cannot open another.

---

## Configuration

Non-secret settings live in `config/env.yaml`, which is **not** tracked in git — start
from `config/envexample.yaml`.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Generation, autocomplete and agent edits |
| `GEMINI_FLASH_MODEL` / `GEMINI_PRO_MODEL` | Model ids for the fast and capable passes |
| `SECTION_CONCURRENCY` | Parallel section fills (default 4) |
| `GEMINI_MAX_RETRIES` | Retries on 429/503 (default 4) |
| `FIREBASE_KEY_PATH` / `FIREBASE_STORAGE_BUCKET` | Persistence and binary storage |
| `FERNET_KEY` | Encrypts user-supplied provider API keys at rest |
| `LATEX_COMPILER` / `LATEX_TIMEOUT` / `LATEX_CONCURRENCY` | Compilation; concurrency should match the deployed vCPU count |
| `INVITE_ONLY`, `ADMIN_EMAIL`, `ADMIN_USERNAME` | Registration and the bootstrap admin |
| `RESEND_API_KEY` | Email via HTTP API — preferred; falls back to SMTP when unset |
| `EMAIL_FROM` | Sender address for both transports |
| `SMTP_*`, `APP_URL` | SMTP fallback and link base for access-request email |
| `DEFAULT_TOKEN_CAP` | Per-user monthly token allowance |
| `COLLAB_TOKEN_HOURS` | Collaboration admission lifetime (default 8) |
| `COLLAB_ALLOWED_ORIGINS` | Hub origin allowlist, comma-separated |

**Secrets are injected from Secret Manager at deploy time, never from a file:**

```
JWT_SECRET       jwt-secret        signs session tokens
ADMIN_PASSWORD   admin-password    bootstrap admin sign-in
                 firebase-admin-key mounted at /secrets/firebase-key.json
```

`JWT_SECRET` and `ADMIN_PASSWORD` have no fallback values. The app refuses to start
without them unless `DEBUG=true`, in which case it generates an ephemeral per-process
secret. That is deliberate: a default signing key is a default that signs valid tokens.

Rotating `FERNET_KEY` makes every stored user API key permanently undecryptable. Move it
between environments; do not regenerate it.

### Bucket lifecycle

Compiled PDFs and SyncTeX data are written to `builds/` in the storage bucket so that any
instance can serve a build any instance produced. Nothing expires them — set a lifecycle
rule on that prefix (a day is generous) or the bucket grows without bound.

---

## Notes

- The editor bundles Monaco rather than loading it from a CDN, so a blocked or slow CDN
  cannot take the editor down. It is code-split: opening a document fetches it, the
  sign-in and home screens do not.
- Compilation runs `pdflatex`, conditionally `bibtex`, then further passes so citations
  resolve. It is offloaded to a worker thread and gated by a semaphore — `pdflatex` is
  CPU-bound, so more concurrent runs than cores thrashes rather than parallelises.
- Email prefers an HTTP API over SMTP. Not because SMTP is insecure — both are
  TLS-encrypted — but because an API key is scoped to sending and revocable on its own,
  where a mailbox app password carries the whole account. Deliverability from a verified
  sending domain is the other reason.
- Saves carry the `updated_at` the client last read. A write whose baseline has moved is
  rejected with `409` rather than silently overwriting another editor. When live
  collaboration is on, the CRDT guarantees convergence and the baseline is omitted.
