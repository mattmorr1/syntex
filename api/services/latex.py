import os
import tempfile
import subprocess
import shutil
from pathlib import Path
from typing import Tuple, Optional, List, Dict
from config import Config

class LaTeXService:
    def __init__(self):
        self.compiler = Config.LATEX_COMPILER
        self.timeout = Config.LATEX_TIMEOUT
        self.compilers = ["pdflatex", "xelatex", "lualatex"]
    
    @staticmethod
    def _safe_path(base_dir: str, name: str) -> str:
        """Resolve path ensuring it stays within base_dir (prevents path traversal)."""
        base = Path(base_dir).resolve()
        target = (base / name).resolve()
        if not str(target).startswith(str(base) + os.sep) and target != base:
            raise ValueError("Invalid file path: path traversal detected")
        return str(target)

    async def compile(self, files: List[Dict], main_file: str) -> Tuple[bool, Optional[bytes], Optional[str]]:
        temp_dir = tempfile.mkdtemp()

        try:

            for f in files:
                file_path = self._safe_path(temp_dir, f["name"])

                # Create subdirectories if needed
                os.makedirs(os.path.dirname(file_path), exist_ok=True) if os.path.dirname(file_path) else None
                
                # Handle binary vs text files
                if f.get("type") in ["png", "jpg", "pdf"]:
                    import base64
                    raw = f["content"]
                    from api.services.storage import is_gcs_ref, download_image
                    if is_gcs_ref(raw):
                        bin_content = download_image(raw)
                    else:
                        bin_content = base64.b64decode(raw)
                    with open(file_path, "wb") as fp:
                        fp.write(bin_content)
                else:
                    text = f["content"]
                    if f.get("type") == "cls" or file_path.endswith(".cls"):
                        text = self._patch_cls(text)
                    if file_path.endswith(".tex"):
                        text = self._clean_tex_artifacts(text)
                    with open(file_path, "w", encoding="utf-8") as fp:
                        fp.write(text)
            
            main_path = self._safe_path(temp_dir, main_file)
            if not os.path.exists(main_path):
                return False, None, f"Main file not found: {main_file}"

            # Determine compiler based on document
            compiler = self._detect_compiler(files, main_file)
            aux_file = self._safe_path(temp_dir, main_file.replace(".tex", ".aux"))

            # First pass
            result = subprocess.run(
                [compiler, "-interaction=nonstopmode", "-halt-on-error", main_file],
                cwd=temp_dir,
                capture_output=True,
                text=True,
                timeout=self.timeout
            )

            # Check if bibtex is needed (plain bibtex: \citation; biblatex+bibtex: \abx@aux@cite)
            needs_rerun = False
            if os.path.exists(aux_file):
                with open(aux_file, "r") as f:
                    aux_content = f.read()
                if "\\citation" in aux_content or "\\abx@aux@cite" in aux_content:
                    subprocess.run(
                        ["bibtex", main_file.replace(".tex", "")],
                        cwd=temp_dir,
                        capture_output=True,
                        timeout=self.timeout
                    )
                    needs_rerun = True

            # Only run second pass if references/citations exist
            if needs_rerun or (result.stdout and "Rerun" in result.stdout):
                result = subprocess.run(
                    [compiler, "-interaction=nonstopmode", "-halt-on-error", main_file],
                    cwd=temp_dir,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout
                )
            
            # Check for PDF output
            pdf_path = self._safe_path(temp_dir, main_file.replace(".tex", ".pdf"))

            if os.path.exists(pdf_path):
                with open(pdf_path, "rb") as f:
                    pdf_content = f.read()
                return True, pdf_content, None
            else:
                # Extract error from log
                log_path = self._safe_path(temp_dir, main_file.replace(".tex", ".log"))
                error_msg = self._extract_error(log_path) if os.path.exists(log_path) else result.stderr
                return False, None, error_msg or "PDF generation failed"
                
        except subprocess.TimeoutExpired:
            return False, None, f"Compilation timed out after {self.timeout} seconds"
        except FileNotFoundError as e:
            return False, None, f"LaTeX compiler not found: {compiler}. Install TeX Live or MiKTeX."
        except Exception as e:
            return False, None, str(e)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    @staticmethod
    def _clean_tex_artifacts(text: str) -> str:
        """
        Strip model-generated LaTeX artifacts that cause compilation errors or
        silently drop characters at render time.  Mirrors _fix_latex_artifacts in
        gemini.py so that pre-existing (already-stored) documents are cleaned on
        every compile, not just at generation time.
        """
        import re

        # --- \t tie-after accent (model uses \t as a tab/indent) ---
        # \t{X} → X  (braced form, e.g. \t{T}his → This)
        text = re.sub(r'\\t\{(.)\}', r'\1', text)
        # \t <lowercase> → uppercase  (e.g. \t his → His)
        text = re.sub(r'\\t\s+([a-z])', lambda m: m.group(1).upper(), text)
        # \t <uppercase or non-letter> → just remove the \t + whitespace
        text = re.sub(r'\\t\s+', '', text)
        # \t immediately before a capital letter with no space  (e.g. \tThis)
        # — LaTeX would parse this as undefined \tThis, so safe to strip
        text = re.sub(r'\\t([A-Z])', r'\1', text)

        # --- Decorative first-letter commands (no package available at compile) ---
        # \lettrine{T}{his} → This,  \dropcap{T}his → This,  etc.
        for _dc in ['lettrine', 'Lettrine', 'dropcap', 'initial', 'drop', 'yinipar']:
            # two-arg form: \cmd{T}{his} → This
            text = re.sub(rf'\\{_dc}\{{([A-Za-z])\}}\{{([^}}]*)\}}', r'\1\2', text)
            # one-arg form: \cmd{T}his → This
            text = re.sub(rf'\\{_dc}\{{([A-Za-z])\}}', r'\1', text)

        return text

    @staticmethod
    def _patch_cls(text: str) -> str:
        """
        Fix common compatibility errors in user-supplied .cls files before compilation.
        """
        # \newcommand\newblock errors if \newblock is already defined (it is, by LaTeX core).
        # \providecommand is a safe no-op when the command already exists.
        text = text.replace(r'\newcommand\newblock', r'\providecommand\newblock')

        # Some cls files call \captionstyle (e.g. BUUEJ) without defining it.
        # Inject a no-op definition just before \makeatother so it doesn't crash.
        if r'\captionstyle' in text and r'\captionstyle{' not in text and r'\newcommand{\captionstyle}' not in text:
            text = text.replace(
                r'\makeatother',
                r'\providecommand{\captionstyle}{}' + '\n' + r'\makeatother',
                1
            )

        return text

    def _detect_compiler(self, files: List[Dict], main_file: str) -> str:
        main_content = ""
        for f in files:
            if f["name"] == main_file:
                main_content = f.get("content", "")
                break
        
        # XeLaTeX indicators
        if any(pkg in main_content for pkg in ["fontspec", "unicode-math", "polyglossia"]):
            return "xelatex"
        
        # LuaLaTeX indicators
        if "luacode" in main_content or "directlua" in main_content:
            return "lualatex"
        
        return self.compiler
    
    def _extract_error(self, log_path: str) -> str:
        try:
            with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            
            # Look for error patterns
            errors = []
            lines = content.split("\n")
            
            for i, line in enumerate(lines):
                if line.startswith("!"):
                    # Found an error
                    error_lines = [line]
                    # Get context
                    for j in range(1, min(5, len(lines) - i)):
                        if lines[i + j].startswith("l."):
                            error_lines.append(lines[i + j])
                            break
                        error_lines.append(lines[i + j])
                    errors.append("\n".join(error_lines))
            
            if errors:
                return "\n\n".join(errors[:3])  # Return first 3 errors
            
            # Look for warnings if no errors
            if "Output written on" not in content:
                return "Compilation failed. Check LaTeX syntax."
            
            return None
        except:
            return "Could not read compilation log"
    
    def get_sample_templates(self) -> Dict[str, str]:
        return {
            "journal": self._journal_template(),
            "problem_set": self._problem_set_template(),
            "thesis": self._thesis_template(),
            "report": self._report_template(),
            "letter": self._letter_template()
        }
    
    def _journal_template(self) -> str:
        return r"""\documentclass[twocolumn]{article}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage[margin=1in]{geometry}
\usepackage[backend=bibtex,style=authoryear]{biblatex}
\addbibresource{references.bib}

\title{Your Paper Title}
\author{Author Name\\
\small Institution\\
\small \texttt{email@example.com}}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Your abstract here.
\end{abstract}

\section{Introduction}
Introduction text.

\section{Methods}
Methods description.

\section{Results}
Results presentation.

\section{Conclusion}
Conclusions.

\printbibliography

\end{document}"""

    def _problem_set_template(self) -> str:
        return r"""\documentclass{article}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{enumitem}
\usepackage[margin=1in]{geometry}

\newtheorem{problem}{Problem}
\newenvironment{solution}{\begin{proof}[Solution]}{\end{proof}}

\title{Problem Set}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\begin{problem}
State the problem here.
\end{problem}

\begin{solution}
Your solution here.
\end{solution}

\end{document}"""

    def _thesis_template(self) -> str:
        return r"""\documentclass[12pt]{report}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage[margin=1.25in]{geometry}
\usepackage{setspace}
\usepackage[backend=bibtex,style=authoryear]{biblatex}
\addbibresource{references.bib}
\doublespacing

\title{Thesis Title}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle
\tableofcontents

\chapter{Introduction}
Introduction content.

\chapter{Literature Review}
Review content.

\chapter{Methodology}
Methods.

\chapter{Results}
Results.

\chapter{Conclusion}
Conclusions.

\printbibliography

\end{document}"""

    def _report_template(self) -> str:
        return r"""\documentclass{article}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage[margin=1in]{geometry}

\title{Technical Report}
\author{Author Name}
\date{\today}

\begin{document}
\maketitle

\section*{Executive Summary}
Brief overview.

\section{Introduction}
Introduction.

\section{Analysis}
Analysis content.

\section{Recommendations}
Recommendations.

\end{document}"""

    def _letter_template(self) -> str:
        return r"""\documentclass{letter}
\usepackage[margin=1in]{geometry}

\signature{Your Name}
\address{Your Address\\City, State ZIP}

\begin{document}
\begin{letter}{Recipient Name\\Address\\City, State ZIP}

\opening{Dear Sir/Madam,}

Letter body text.

\closing{Sincerely,}

\end{letter}
\end{document}"""

latex_service = LaTeXService()
