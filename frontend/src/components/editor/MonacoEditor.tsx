import { useRef, useState, useEffect, useCallback } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { Box, Typography } from '@mui/material';
import { useThemeStore } from '../../store/themeStore';
import { api } from '../../services/api';

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  fileName: string;
  projectId: string;
}

export function MonacoEditor({ value, onChange, fileName, projectId }: MonacoEditorProps) {
  const { mode } = useThemeStore();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [ghostText, setGhostText] = useState('');
  const [ghostPosition, setGhostPosition] = useState<{ lineNumber: number; column: number } | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const autocompleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    }, 500); // 500ms debounce
  }, []);

  const fetchAutocomplete = async () => {
    if (!editorRef.current) return;
    
    const editor = editorRef.current;
    const position = editor.getPosition();
    const model = editor.getModel();
    
    if (!position || !model) return;
    
    // Get context (text before cursor)
    const textUntilPosition = model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });
    
    // Skip if line is empty or just whitespace
    const currentLine = model.getLineContent(position.lineNumber);
    if (!currentLine.trim()) return;
    
    try {
      const result = await api.autocomplete(textUntilPosition, textUntilPosition.length, fileName);
      
      if (result.suggestion && result.suggestion.trim()) {
        showGhostText(result.suggestion, position);
      }
    } catch (err) {
      // Silent fail for autocomplete
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
    };
  }, []);

  return (
    <Box sx={{ height: '100%', position: 'relative' }}>
      <style>
        {`
          .ghost-text-decoration {
            color: #6b6b6b !important;
            font-style: italic;
            opacity: 0.6;
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
          // Define custom themes
          monaco.editor.defineTheme('uea-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
              { token: 'keyword.latex', foreground: 'B388FF' },
              { token: 'command.latex', foreground: '82B1FF' },
              { token: 'comment.latex', foreground: '6A9955' },
              { token: 'math.latex', foreground: 'FFD700' },
            ],
            colors: {
              'editor.background': '#0D0D0D',
              'editor.foreground': '#FFFFFF',
              'editorLineNumber.foreground': '#5A5A5A',
              'editorCursor.foreground': '#B388FF',
              'editor.selectionBackground': '#3d3d6b50',
            },
          });
          
          monaco.editor.defineTheme('uea-light', {
            base: 'vs',
            inherit: true,
            rules: [
              { token: 'keyword.latex', foreground: '6750A4' },
              { token: 'command.latex', foreground: '1976D2' },
              { token: 'comment.latex', foreground: '6A9955' },
              { token: 'math.latex', foreground: 'B8860B' },
            ],
            colors: {
              'editor.background': '#FFFBFE',
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
