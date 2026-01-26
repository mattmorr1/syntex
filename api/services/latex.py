import os
import tempfile
import subprocess
import shutil
from typing import Tuple, Optional, List, Dict
from config import Config

class LaTeXService:
    def __init__(self):
        self.compiler = Config.LATEX_COMPILER
        self.timeout = Config.LATEX_TIMEOUT
        self.compilers = ["pdflatex", "xelatex", "lualatex"]
    
    async def compile(self, files: List[Dict], main_file: str) -> Tuple[bool, Optional[bytes], Optional[str]]:
        temp_dir = tempfile.mkdtemp()
        
        try:
            # Write all files to temp directory
            for f in files:
                file_path = os.path.join(temp_dir, f["name"])
                
                # Create subdirectories if needed
                os.makedirs(os.path.dirname(file_path), exist_ok=True) if os.path.dirname(file_path) else None
                
                # Handle binary vs text files
                if f.get("type") in ["png", "jpg", "pdf"]:
                    # For binary files, content should be base64
                    import base64
                    content = base64.b64decode(f["content"])
                    with open(file_path, "wb") as fp:
                        fp.write(content)
                else:
                    with open(file_path, "w", encoding="utf-8") as fp:
                        fp.write(f["content"])
            
            main_path = os.path.join(temp_dir, main_file)
            if not os.path.exists(main_path):
                return False, None, f"Main file not found: {main_file}"
            
            # Determine compiler based on document
            compiler = self._detect_compiler(files, main_file)
            
            # Run compilation (twice for references)
            for _ in range(2):
                result = subprocess.run(
                    [compiler, "-interaction=nonstopmode", "-halt-on-error", main_file],
                    cwd=temp_dir,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout
                )
            
            # Check for bibtex
            aux_file = os.path.join(temp_dir, main_file.replace(".tex", ".aux"))
            if os.path.exists(aux_file):
                with open(aux_file, "r") as f:
                    if "\\citation" in f.read():
                        subprocess.run(
                            ["bibtex", main_file.replace(".tex", "")],
                            cwd=temp_dir,
                            capture_output=True,
                            timeout=self.timeout
                        )
                        # Recompile after bibtex
                        for _ in range(2):
                            subprocess.run(
                                [compiler, "-interaction=nonstopmode", main_file],
                                cwd=temp_dir,
                                capture_output=True,
                                timeout=self.timeout
                            )
            
            # Check for PDF output
            pdf_path = os.path.join(temp_dir, main_file.replace(".tex", ".pdf"))
            
            if os.path.exists(pdf_path):
                with open(pdf_path, "rb") as f:
                    pdf_content = f.read()
                return True, pdf_content, None
            else:
                # Extract error from log
                log_path = os.path.join(temp_dir, main_file.replace(".tex", ".log"))
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

\bibliographystyle{plain}
\bibliography{references}

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

\bibliographystyle{plain}
\bibliography{references}

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
