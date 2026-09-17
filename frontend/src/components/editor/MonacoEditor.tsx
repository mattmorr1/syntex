import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { Box, Typography, CircularProgress } from '@mui/material';
import '../../services/monacoSetup';  // configures the loader before the editor mounts
import { MonacoBinding } from 'y-monaco';
import { useThemeStore } from '../../store/themeStore';
import { api } from '../../services/api';
import type { CollabSession } from '../../services/collab';

export interface EditorSelection {
  text: string;
  startLine: number;
  endLine: number;
}

export interface MonacoEditorHandle {
  insertText: (text: string) => void;
  goToLine: (lineNumber: number) => void;
  getCursorLine: () => number;
}

export interface CompileError {
  line: number;
  message: string;
}

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  fileName: string;
  projectId: string;
  onSelectionChange?: (selection: EditorSelection | null) => void;
  clsContent?: string;
  compileErrors?: CompileError[];
  /** When present, the Y.Text for this file owns the buffer instead of `value`. */
  collab?: CollabSession | null;
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
function MonacoEditor({ value, onChange, fileName, onSelectionChange, clsContent, compileErrors, collab }, ref) {
  const { mode } = useThemeStore();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inlineDisposableRef = useRef<any>(null);
  // fileName changes as tabs switch; the provider is registered once, so it reads
  // the current name through a ref rather than closing over a stale value.
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const [suggesting, setSuggesting] = useState(false);
  const bindingRef = useRef<MonacoBinding | null>(null);

  // Register cls-defined commands as completion items whenever clsContent changes
  const clsDisposableRef = useRef<any>(null);
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !clsContent) return;

    // Extract \newcommand{\CmdName} and \def\CmdName patterns
    const cmdNames: string[] = [];
    for (const match of clsContent.matchAll(/\\(?:re)?newcommand\{?\\(\w+)|\\(?:long\\)?def\\(\w+)/g)) {
      const name = match[1] || match[2];
      if (name && !/^@/.test(name)) cmdNames.push(name);
    }
    const unique = [...new Set(cmdNames)];
    if (!unique.length) return;

    // Dispose previous registration
    clsDisposableRef.current?.dispose();

    clsDisposableRef.current = monaco.languages.registerCompletionItemProvider('latex', {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: unique.map(name => ({
            label: `\\${name}`,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `\\${name}`,
            detail: 'From custom.cls',
            range,
          })),
        };
      },
    });

    return () => { clsDisposableRef.current?.dispose(); };
  }, [clsContent]);

  // Set Monaco error markers from LaTeX compile errors
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (!compileErrors || compileErrors.length === 0) {
      monaco.editor.setModelMarkers(model, 'latex-compile', []);
      return;
    }

    const markers = compileErrors.map(({ line, message }) => ({
      severity: monaco.MarkerSeverity.Error,
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: model.getLineLength(Math.min(line, model.getLineCount())) + 1,
      message,
      source: 'LaTeX',
    }));

    monaco.editor.setModelMarkers(model, 'latex-compile', markers);
  }, [compileErrors]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register LaTeX language
    registerLaTeXLanguage(monaco);

    // Inline completions are Monaco's own ghost-text mechanism: it renders the
    // suggestion and owns Tab-to-accept, including how that interacts with the
    // suggest widget. The previous hand-rolled version bound Tab once at mount and
    // closed over the initial (empty) state, so it could never accept anything.
    inlineDisposableRef.current = monaco.languages.registerInlineCompletionsProvider('latex', {
      provideInlineCompletions: async (model: any, position: any, _ctx: any, token: any) => {
        const suggestion = await fetchAutocomplete(model, position, token);
        if (!suggestion) return { items: [] };
        return {
          items: [{
            insertText: suggestion,
            range: new monaco.Range(
              position.lineNumber, position.column, position.lineNumber, position.column
            ),
          }],
        };
      },
      freeInlineCompletions: () => {},
    });

    // Track selection for AI context
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) {
        onSelectionChange?.(null);
        return;
      }
      const model = editor.getModel();
      if (!model) return;
      const text = model.getValueInRange(sel);
      if (text.trim()) {
        onSelectionChange?.({
          text,
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
        });
      } else {
        onSelectionChange?.(null);
      }
    });
  };

  /**
   * Fetch one suggestion for the cursor position. Monaco calls this, renders the
   * result as ghost text, and handles acceptance; it also passes a cancellation
   * token when the user types on, which aborts the in-flight request.
   */
  const fetchAutocomplete = async (model: any, position: any, token: any): Promise<string | null> => {
    const currentLine = model.getLineContent(position.lineNumber);
    if (!currentLine.trim()) return null;

    // Skip trivial triggers: comments, closing braces/brackets, very short input
    const trimmed = currentLine.trimStart();
    if (trimmed.startsWith('%') || /^[}\])]$/.test(trimmed)) return null;
    if (trimmed.length < 3) return null;

    // Send only ~50 lines before cursor instead of entire document
    const startLine = Math.max(1, position.lineNumber - 50);
    const context = model.getValueInRange({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    token?.onCancellationRequested?.(() => controller.abort());

    setSuggesting(true);
    try {
      const result = await api.autocomplete(context, context.length, fileNameRef.current, controller.signal);
      if (controller.signal.aborted || token?.isCancellationRequested) return null;
      const suggestion = (result.suggestion || '').replace(/^\n+/, '');
      return suggestion.trim() ? suggestion : null;
    } catch {
      return null; // silent, including aborts
    } finally {
      setSuggesting(false);
    }
  };

  // Bind this file's Y.Text to the editor model. Rebinds when the tab changes, since
  // each file is a separate Y.Text inside the one project document.
  useEffect(() => {
    bindingRef.current?.destroy();
    bindingRef.current = null;

    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!collab || !editor || !model) return;

    const ytext = collab.text(fileName);
    // First client into an empty document seeds it from what was loaded from Firestore;
    // later joiners must not, or the text would be appended once per participant.
    // Only safe while alone: with a peer present the room already holds this file, and
    // a local seed would append a second copy of it.
    if (ytext.length === 0 && value && collab.peerCount() === 0) ytext.insert(0, value);

    bindingRef.current = new MonacoBinding(
      // No awareness: remote cursors through a polled relay would lag visibly.
      ytext, model, new Set([editor]), null
    );

    return () => { bindingRef.current?.destroy(); bindingRef.current = null; };
  }, [collab, fileName]);

  // Cleanup
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      inlineDisposableRef.current?.dispose();
      bindingRef.current?.destroy();
    };
  }, []);

  // Expose handle methods for parent components
  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const position = editor.getPosition() || { lineNumber: 1, column: 1 };
      editor.executeEdits('insert-text', [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          text,
        },
      ]);
      editor.focus();
    },
    goToLine: (lineNumber: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column: 1 });
      editor.focus();
    },
    getCursorLine: () => {
      return editorRef.current?.getPosition()?.lineNumber ?? 1;
    },
  }));

  return (
    <Box sx={{ height: '100%', position: 'relative' }}>
      <Editor
        height="100%"
        language={getLanguageFromFileName(fileName)}
        {...(collab ? {} : { value })}
        onChange={onChange}
        onMount={handleEditorMount}
        theme={mode === 'dark' ? 'uea-dark' : 'uea-light'}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          lineNumbers: 'on',
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          inlineSuggest: { enabled: true },
          tabSize: 2,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          padding: { top: 16 },
        }}
        beforeMount={(monaco) => {
          monaco.editor.defineTheme('uea-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
              { token: 'keyword.latex', foreground: 'c084fc' },
              { token: 'command.latex', foreground: 'a5b4fc' },
              { token: 'comment.latex', foreground: '52525b', fontStyle: 'italic' },
              { token: 'math.latex', foreground: 'fbbf24' },
              { token: 'delimiter.latex', foreground: 'e4e4e7' },
              { token: 'string', foreground: '86efac' },
            ],
            colors: {
              'editor.background': '#0e0e11',
              'editor.foreground': '#d4d4d8',
              'editorLineNumber.foreground': '#52525b',
              'editorLineNumber.activeForeground': '#a1a1aa',
              'editorCursor.foreground': '#ffffff',
              'editor.selectionBackground': '#ffffff25',
              'editor.lineHighlightBackground': '#18181b',
              'editorGutter.background': '#0e0e11',
              'editorWidget.background': '#18181b',
              'editorWidget.border': '#3f3f46',
              'editorSuggestWidget.background': '#18181b',
              'editorSuggestWidget.border': '#3f3f46',
              'editorSuggestWidget.selectedBackground': '#27272a',
              'editorGhostText.foreground': '#71717a',
            },
          });
          
          monaco.editor.defineTheme('uea-light', {
            base: 'vs',
            inherit: true,
            rules: [
              { token: 'keyword.latex', foreground: '7c3aed' },
              { token: 'command.latex', foreground: '1d4ed8' },
              { token: 'comment.latex', foreground: 'a1a1aa', fontStyle: 'italic' },
              { token: 'math.latex', foreground: 'b45309' },
              { token: 'delimiter.latex', foreground: '52525b' },
              { token: 'string', foreground: '15803d' },
              { token: 'string.latex', foreground: '52525b' },
            ],
            colors: {
              'editor.background': '#fafafa',
              'editor.foreground': '#0a0a0a',
              'editorLineNumber.foreground': '#8c8c94',
              'editorLineNumber.activeForeground': '#3f3f46',
              'editorCursor.foreground': '#0a0a0a',
              'editor.selectionBackground': '#0a0a0a18',
              'editor.lineHighlightBackground': '#f4f4f500',
              'editorGutter.background': '#fafafa',
              'editorWidget.background': '#ffffff',
              'editorWidget.border': '#e4e4e7',
              'editorSuggestWidget.background': '#ffffff',
              'editorSuggestWidget.border': '#e4e4e7',
              'editorSuggestWidget.foreground': '#0a0a0a',
              'editorSuggestWidget.selectedBackground': '#f4f4f5',
              'editorSuggestWidget.selectedForeground': '#0a0a0a',
              'editorHoverWidget.background': '#ffffff',
              'editorHoverWidget.border': '#e4e4e7',
              'input.background': '#ffffff',
              'input.border': '#e4e4e7',
              'focusBorder': '#0a0a0a',
              'scrollbarSlider.background': '#d4d4d840',
              'scrollbarSlider.hoverBackground': '#a1a1aa60',
              'editorGhostText.foreground': '#a1a1aa',
            },
          });
        }}
      />
      
      {suggesting && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            bgcolor: 'background.paper',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            boxShadow: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pointerEvents: 'none',
          }}
        >
          <CircularProgress size={10} thickness={6} />
          <Typography variant="caption" color="text.secondary">
            Suggesting&hellip; <strong>Tab</strong> to accept
          </Typography>
        </Box>
      )}
    </Box>
  );
});

function getLanguageFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    tex: 'latex',
    bib: 'bibtex',
    cls: 'latex',
    sty: 'latex',
  };
  return langMap[ext || ''] || 'plaintext';
}

function registerLaTeXLanguage(monaco: Monaco) {
  // Check if already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some((l: any) => l.id === 'latex')) return;
  
  monaco.languages.register({ id: 'latex' });
  
  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/\\%/, 'string.latex'],       // \% is a literal percent sign — must come before comment rule
        [/%.*$/, 'comment.latex'],
        [/\\[a-zA-Z]+/, 'command.latex'],
        [/\$\$/, { token: 'math.latex', next: '@mathDisplay' }],
        [/\$/, { token: 'math.latex', next: '@mathInline' }],
        [/\\begin\{[^}]+\}/, 'keyword.latex'],
        [/\\end\{[^}]+\}/, 'keyword.latex'],
        [/[{}[\]]/, 'delimiter.latex'],
      ],
      mathInline: [
        [/\$/, { token: 'math.latex', next: '@pop' }],
        [/./, 'math.latex'],
      ],
      mathDisplay: [
        [/\$\$/, { token: 'math.latex', next: '@pop' }],
        [/./, 'math.latex'],
      ],
    },
  });
  
  // LaTeX snippets
  monaco.languages.registerCompletionItemProvider('latex', {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      
      const suggestions = [
        { label: '\\section', kind: monaco.languages.CompletionItemKind.Snippet, insertText: '\\section{$1}\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Section heading' },
        { label: '\\subsection', kind: monaco.languages.CompletionItemKind.Snippet, insertText: '\\subsection{$1}\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Subsection heading' },
        { label: '\\begin{equation}', kind: monaco.languages.CompletionItemKind.Snippet, insertText: '\\begin{equation}\n\t$1\n\\end{equation}\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Equation environment' },
        { label: '\\begin{itemize}', kind: monaco.languages.CompletionItemKind.Snippet, insertText: '\\begin{itemize}\n\t\\item $1\n\\end{itemize}\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Bullet list' },
        { label: '\\begin{enumerate}', kind: monaco.languages.CompletionItemKind.Snippet, insertText: '\\begin{enumerate}\n\t\\item $1\n\\end{enumerate}\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Numbered list' },
        { label: '\\begin{figure}', kind: monaco.languages.CompletionItemKind.Snippet, insertText: '\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{$1}\n\t\\caption{$2}\n\t\\label{fig:$3}\n\\end{figure}\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Figure environment' },
        { label: '\\begin{table}', kind: monaco.languages.CompletionItemKind.Snippet, insertText: '\\begin{table}[htbp]\n\t\\centering\n\t\\begin{tabular}{$1}\n\t\t\\hline\n\t\t$2\n\t\t\\hline\n\t\\end{tabular}\n\t\\caption{$3}\n\t\\label{tab:$4}\n\\end{table}\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Table environment' },
        { label: '\\textbf', kind: monaco.languages.CompletionItemKind.Function, insertText: '\\textbf{$1}$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Bold text' },
        { label: '\\textit', kind: monaco.languages.CompletionItemKind.Function, insertText: '\\textit{$1}$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Italic text' },
        { label: '\\cite', kind: monaco.languages.CompletionItemKind.Function, insertText: '\\cite{$1}$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Citation' },
        { label: '\\ref', kind: monaco.languages.CompletionItemKind.Function, insertText: '\\ref{$1}$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Reference' },
        { label: '\\frac', kind: monaco.languages.CompletionItemKind.Function, insertText: '\\frac{$1}{$2}$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Fraction' },
        { label: '\\sum', kind: monaco.languages.CompletionItemKind.Function, insertText: '\\sum_{$1}^{$2} $0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Summation' },
        { label: '\\int', kind: monaco.languages.CompletionItemKind.Function, insertText: '\\int_{$1}^{$2} $0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'Integral' },
      ].map(s => ({ ...s, range }));
      
      return { suggestions };
    },
  });
}
