import { useRef, useState, useEffect, useCallback } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { Box, Typography } from '@mui/material';
import { useThemeStore } from '../../store/themeStore';
import { api } from '../../services/api';

export interface EditorSelection {
  text: string;
  startLine: number;
  endLine: number;
}

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  fileName: string;
  projectId: string;
  onSelectionChange?: (selection: EditorSelection | null) => void;
}

export function MonacoEditor({ value, onChange, fileName, projectId, onSelectionChange }: MonacoEditorProps) {
  const { mode } = useThemeStore();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [ghostText, setGhostText] = useState('');
  const [ghostPosition, setGhostPosition] = useState<{ lineNumber: number; column: number } | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const autocompleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Register LaTeX language
    registerLaTeXLanguage(monaco);
    
    // Set up ghost text widget
    editor.onDidChangeModelContent(() => {
      clearGhostText();
      scheduleAutocomplete();
    });
    
    editor.onDidChangeCursorPosition(() => {
      clearGhostText();
    });
    
    // Tab key handler for accepting ghost text
    editor.addCommand(monaco.KeyCode.Tab, () => {
      if (ghostText && ghostPosition) {
        acceptGhostText();
      } else {
        // Default tab behavior
        editor.trigger('keyboard', 'tab', null);
      }
    });
    
    // Escape to dismiss ghost text
    editor.addCommand(monaco.KeyCode.Escape, () => {
      clearGhostText();
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

  const clearGhostText = useCallback(() => {
    if (editorRef.current && decorationsRef.current.length > 0) {
      decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, []);
    }
    setGhostText('');
    setGhostPosition(null);
  }, []);

  const scheduleAutocomplete = useCallback(() => {
    if (autocompleteTimeoutRef.current) {
      clearTimeout(autocompleteTimeoutRef.current);
    }
    
    autocompleteTimeoutRef.current = setTimeout(async () => {
      await fetchAutocomplete();
    }, 800);
  }, []);

  const fetchAutocomplete = async () => {
    if (!editorRef.current) return;

    const editor = editorRef.current;
    const position = editor.getPosition();
    const model = editor.getModel();

    if (!position || !model) return;

    // Skip if line is empty or just whitespace
    const currentLine = model.getLineContent(position.lineNumber);
    if (!currentLine.trim()) return;

    // Skip trivial triggers: comments, closing braces/brackets, very short input
    const trimmed = currentLine.trimStart();
    if (trimmed.startsWith('%') || /^[}\])]$/.test(trimmed)) return;
    if (trimmed.length < 3) return;

    // Send only ~50 lines before cursor instead of entire document
    const startLine = Math.max(1, position.lineNumber - 50);
    const context = model.getValueInRange({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await api.autocomplete(context, context.length, fileName, controller.signal);

      if (!controller.signal.aborted && result.suggestion && result.suggestion.trim()) {
        showGhostText(result.suggestion, position);
      }
    } catch (err) {
      // Silent fail for autocomplete (including aborted requests)
    }
  };

  const showGhostText = (suggestion: string, position: { lineNumber: number; column: number }) => {
    if (!editorRef.current || !monacoRef.current) return;
    
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    
    // Clean suggestion
    const cleanSuggestion = suggestion.replace(/^\n+/, '');
    if (!cleanSuggestion) return;
    
    setGhostText(cleanSuggestion);
    setGhostPosition(position);
    
    // Create inline decoration for ghost text
    const newDecorations = [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column
        ),
        options: {
          after: {
            content: cleanSuggestion.split('\n')[0], // First line only for inline
            inlineClassName: 'ghost-text-decoration',
          },
        },
      },
    ];
    
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  };

  const acceptGhostText = useCallback(() => {
    if (!editorRef.current || !ghostText || !ghostPosition) return;
    
    const editor = editorRef.current;
    
    // Insert the ghost text
    editor.executeEdits('autocomplete', [
      {
        range: {
          startLineNumber: ghostPosition.lineNumber,
          startColumn: ghostPosition.column,
          endLineNumber: ghostPosition.lineNumber,
          endColumn: ghostPosition.column,
        },
        text: ghostText,
      },
    ]);
    
    // Move cursor to end of inserted text
    const lines = ghostText.split('\n');
    const newLine = ghostPosition.lineNumber + lines.length - 1;
    const newColumn = lines.length === 1 
      ? ghostPosition.column + ghostText.length 
      : lines[lines.length - 1].length + 1;
    
    editor.setPosition({ lineNumber: newLine, column: newColumn });
    
    clearGhostText();
  }, [ghostText, ghostPosition, clearGhostText]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (autocompleteTimeoutRef.current) {
        clearTimeout(autocompleteTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <Box sx={{ height: '100%', position: 'relative' }}>
      <style>
        {`
          .ghost-text-decoration {
            color: #52525b !important;
            font-style: italic;
            opacity: 0.5;
          }
        `}
      </style>
      
      <Editor
        height="100%"
        language={getLanguageFromFileName(fileName)}
        value={value}
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
              'editorCursor.foreground': '#7c3aed',
              'editor.selectionBackground': '#7c3aed30',
              'editor.lineHighlightBackground': '#18181b',
              'editorGutter.background': '#0e0e11',
              'editorWidget.background': '#18181b',
              'editorWidget.border': '#3f3f46',
              'editorSuggestWidget.background': '#18181b',
              'editorSuggestWidget.border': '#3f3f46',
              'editorSuggestWidget.selectedBackground': '#27272a',
            },
          });
          
          monaco.editor.defineTheme('uea-light', {
            base: 'vs',
            inherit: true,
            rules: [
              { token: 'keyword.latex', foreground: '6d28d9' },
              { token: 'command.latex', foreground: '7c3aed' },
              { token: 'comment.latex', foreground: 'a1a1aa', fontStyle: 'italic' },
              { token: 'math.latex', foreground: 'b45309' },
            ],
            colors: {
              'editor.background': '#fafafa',
              'editor.selectionBackground': '#6d28d920',
              'editorCursor.foreground': '#6d28d9',
            },
          });
        }}
      />
      
      {ghostText && (
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
            fontSize: 12,
            color: 'text.secondary',
          }}
        >
          <Typography variant="caption">
            Press <strong>Tab</strong> to accept | <strong>Esc</strong> to dismiss
          </Typography>
        </Box>
      )}
    </Box>
  );
}

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
  if (languages.some(l => l.id === 'latex')) return;
  
  monaco.languages.register({ id: 'latex' });
  
  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
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
    provideCompletionItems: (model, position) => {
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
