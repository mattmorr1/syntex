import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  CircularProgress,
  Chip,
  Collapse,
  Alert,
  Paper,
} from '@mui/material';
import {
  Send,
  Check,
  Clear,
  Close,
  ExpandMore,
  ExpandLess,
  SmartToy,
  ErrorOutline,
  AttachFile,
} from '@mui/icons-material';
import { useThemeStore } from '../../store/themeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { api, AgentStep, AgentResult } from '../../services/api';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

interface DiffChange {
  start_line: number;
  end_line: number;
  original: string;
  replacement: string;
  reason: string;
}

interface HistoryEntry {
  instruction: string;
  explanation: string;
  appliedCount: number;
  tokensUsed: number;
}

interface SelectionInfo {
  text: string;
  startLine: number;
  endLine: number;
}

interface ProjectFile {
  name: string;
  content: string;
  type: string;
}

interface AgentPanelProps {
  projectId: string;
  document: string;
  fileName?: string;
  selection?: SelectionInfo | null;
  cursorLine?: number;
  projectFiles?: ProjectFile[];
  compileError?: string | null;
  mainFile?: string;
  onApplyChanges: (newContent: string) => void;
  onClose?: () => void;
}

/** Extract \label, \section, \subsection, \newcommand from a LaTeX document. */
function extractLatexStructure(doc: string): string {
  const sections: string[] = [];
  const labels: string[] = [];
  const commands: string[] = [];

  for (const line of doc.split('\n')) {
    const secMatch = line.match(/\\(?:sub)*section\*?\{([^}]+)\}/);
    if (secMatch) sections.push(secMatch[1]);
    const labelMatch = line.match(/\\label\{([^}]+)\}/);
    if (labelMatch) labels.push(labelMatch[1]);
    const cmdMatch = line.match(/\\(?:re)?newcommand\{?\\(\w+)/);
    if (cmdMatch) commands.push('\\' + cmdMatch[1]);
  }

  const parts: string[] = [];
  if (sections.length) parts.push(`Sections: ${sections.slice(0, 20).join(', ')}`);
  if (labels.length) parts.push(`Labels: ${labels.slice(0, 30).join(', ')}`);
  if (commands.length) parts.push(`Custom commands: ${[...new Set(commands)].slice(0, 20).join(', ')}`);
  if (!parts.length) return '';
  return `\n[DOCUMENT STRUCTURE]\n${parts.join('\n')}\n`;
}

export function AgentPanel({
  projectId,
  document,
  fileName,
  selection,
  cursorLine,
  projectFiles,
  compileError,
  mainFile,
  onApplyChanges,
  onClose,
}: AgentPanelProps) {
  const { mode } = useThemeStore();
  const { aiModel } = useSettingsStore();
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [explanation, setExplanation] = useState('');
  const [changes, setChanges] = useState<DiffChange[]>([]);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [status, setStatus] = useState<AgentResult['status'] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastInstruction, setLastInstruction] = useState('');
  const [dismissedError, setDismissedError] = useState(false);
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // @file autocomplete
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atQuery, setAtQuery] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDark = mode === 'dark';
  const purpleBorder = isDark ? '#262626' : '#e4e4e7';
  const accentBorder = isDark ? '#2d2d2d' : '#e4e4e7';
  const surfaceActive = isDark ? '#1e1e1e' : '#f4f4f5';

  // Reset dismissed state when a new compile error arrives
  useEffect(() => {
    if (compileError) setDismissedError(false);
  }, [compileError]);

  useEffect(() => {
    if (scrollRef.current && (explanation || changes.length > 0)) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [explanation, changes]);

  // Handle @file autocomplete in textarea
  const handleInstructionChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInstruction(val);

    // Detect @<query> at end of text
    const atMatch = val.match(/@(\w*)$/);
    if (atMatch && projectFiles?.length) {
      const query = atMatch[1].toLowerCase();
      setAtQuery(atMatch[0]);
      setAtSuggestions(
        projectFiles
          .filter(f => f.name.toLowerCase().includes(query) && f.type !== 'png' && f.type !== 'jpg' && f.type !== 'pdf')
          .map(f => f.name)
          .slice(0, 6)
      );
    } else {
      setAtSuggestions([]);
      setAtQuery('');
    }
  };

  const handleAtSelect = (fileName: string) => {
    setInstruction(prev => prev.slice(0, prev.length - atQuery.length) + `@${fileName} `);
    setAtSuggestions([]);
    setAtQuery('');
    inputRef.current?.focus();
  };

  const handlePickPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { setError('Only PDF files can be attached.'); return; }
    if (file.size > PDF_MAX_BYTES) { setError('PDF must be 10MB or smaller.'); return; }
    const reader = new FileReader();
    reader.onload = () => setPdf({ name: file.name, data: String(reader.result).split(',', 2)[1] ?? '' });
    reader.onerror = () => setError(`Could not read ${file.name}.`);
    reader.readAsDataURL(file);
  };

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim()) return;

    // Archive current result to history before starting a new request
    if (explanation || changes.length > 0) {
      setHistory(prev => [...prev, {
        instruction: lastInstruction,
        explanation,
        appliedCount: 0,
        tokensUsed,
      }]);
    }

    setLoading(true);
    setError('');
    setChanges([]);
    setExplanation('');
    setTokensUsed(0);
    setSteps([]);
    setStatus(null);
    setLastInstruction(instruction);

    const selectionPayload = selection
      ? { text: selection.text, start_line: selection.startLine, end_line: selection.endLine }
      : undefined;

    // Build enriched instruction: prepend compile error + structure metadata
    const structureBlock = extractLatexStructure(document);
    const errorPrefix = (compileError && !dismissedError)
      ? `[Last compilation error: ${compileError.slice(0, 500)}]\n\n`
      : '';
    const enrichedInstruction = errorPrefix + instruction + structureBlock;

    // Supporting files: exclude active document content, exclude binaries
    const supportingFiles = projectFiles?.filter(
      f => f.content !== document && !['png', 'jpg', 'pdf'].includes(f.type)
    );

    try {
      await api.agentEditStream(
        projectId,
        enrichedInstruction,
        document,
        aiModel,
        selectionPayload,
        (chunk) => {
          setExplanation((prev) => prev + chunk);
        },
        (result) => {
          setExplanation(result.explanation);
          setChanges(result.changes.map((c: any) => ({ ...c })));
          setTokensUsed(result.tokens);
          setStatus(result.status);
        },
        (message) => {
          setError(message);
        },
        supportingFiles,
        fileName,
        cursorLine,
        mainFile,
        (step) => setSteps(prev => [...prev, step]),
        pdf ?? undefined,
      );
    } catch (err: any) {
      setError(err.message || 'Failed to process request');
    } finally {
      setLoading(false);
    }
  }, [instruction, lastInstruction, explanation, changes, tokensUsed, projectId, document, fileName, mainFile, aiModel, selection, cursorLine, compileError, dismissedError, projectFiles, pdf]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (atSuggestions.length > 0 && (e.key === 'Escape')) {
      setAtSuggestions([]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && atSuggestions.length === 0) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleAcceptChange = (index: number) => {
    const change = changes[index];
    const lines = document.split('\n');
    const beforeLines = lines.slice(0, change.start_line - 1);
    const afterLines = lines.slice(change.end_line);
    const replacementLines = change.replacement.split('\n');
    const newLines = [...beforeLines, ...replacementLines, ...afterLines];
    onApplyChanges(newLines.join('\n'));
    const delta = replacementLines.length - (change.end_line - change.start_line + 1);
    setChanges(prev => prev.filter((_, i) => i !== index).map(c =>
      c.start_line > change.end_line ? { ...c, start_line: c.start_line + delta, end_line: c.end_line + delta } : c));
  };

  const handleRejectChange = (index: number) => {
    setChanges(prev => prev.filter((_, i) => i !== index));
  };

  const pendingCount = changes.length;
  const showErrorChip = !!compileError && !dismissedError;

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      bgcolor: 'background.paper',
      border: `1px solid ${purpleBorder}`,
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <Box sx={{
        height: 36,
        px: 1.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${accentBorder}`,
        flexShrink: 0,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ color: 'primary.main', display: 'flex', alignItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
          </Box>
          <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}>
            AI Assistant
          </Typography>
          {projectFiles && projectFiles.length > 1 && (
            <Chip
              icon={<AttachFile sx={{ fontSize: 10 }} />}
              label={`${projectFiles.length} files`}
              size="small"
              sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
            />
          )}
        </Box>
        {onClose && (
          <IconButton size="small" onClick={onClose} sx={{ p: 0.25, color: 'text.secondary' }}>
            <Close sx={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>

      {/* Messages */}
      <Box
        ref={scrollRef}
        sx={{ flex: 1, overflow: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        {/* Chat history — previous turns */}
        {history.map((entry, i) => (
          <Box key={i} sx={{ opacity: 0.6 }}>
            <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, justifyContent: 'flex-end' }}>
              <Box sx={{
                px: 1.5, py: 0.75,
                bgcolor: 'primary.main',
                borderRadius: '10px 10px 2px 10px',
                maxWidth: '85%',
              }}>
                <Typography sx={{ fontSize: 11, color: 'primary.contrastText', lineHeight: 1.4 }}>
                  {entry.instruction}
                </Typography>
              </Box>
            </Box>
            <Box sx={{
              bgcolor: surfaceActive,
              borderRadius: '2px 10px 10px 10px',
              border: `1px solid ${accentBorder}`,
              p: 1,
              mb: 1,
            }}>
              <Typography sx={{ fontSize: 11, lineHeight: 1.5, color: 'text.primary', whiteSpace: 'pre-wrap' }}>
                {entry.explanation}
              </Typography>
              {entry.tokensUsed > 0 && (
                <Typography sx={{ mt: 0.5, fontSize: 10, color: 'text.disabled' }}>
                  {entry.tokensUsed} tokens
                </Typography>
              )}
            </Box>
          </Box>
        ))}

        {error && (
          <Alert severity="error" sx={{ py: 0.5, fontSize: 11 }}>{error}</Alert>
        )}

        {(explanation || loading) && lastInstruction && (
          <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, justifyContent: 'flex-end' }}>
            <Box sx={{
              px: 1.5, py: 0.75,
              bgcolor: 'primary.main',
              borderRadius: '10px 10px 2px 10px',
              maxWidth: '85%',
            }}>
              <Typography sx={{ fontSize: 11, color: 'primary.contrastText', lineHeight: 1.4 }}>
                {lastInstruction}
              </Typography>
            </Box>
          </Box>
        )}

        {steps.length > 0 && <AgentTrace steps={steps} live={loading} accentBorder={accentBorder} />}

        {explanation && (
          <Box sx={{
            bgcolor: surfaceActive,
            borderRadius: '2px 10px 10px 10px',
            border: `1px solid ${accentBorder}`,
            p: 1.5,
            mb: 1,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
              <SmartToy sx={{ fontSize: 12, color: 'primary.main' }} />
              <Typography sx={{ fontSize: 10, fontWeight: 600 }}>syntex</Typography>
              {status && status !== 'no_changes' && (
                <Chip
                  label={status === 'verified' ? 'compile-verified' : 'not verified'}
                  size="small"
                  color={status === 'verified' ? 'success' : 'warning'}
                  variant="outlined"
                  sx={{ height: 16, fontSize: 9, ml: 'auto' }}
                />
              )}
            </Box>
            <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'text.primary', whiteSpace: 'pre-wrap' }}>
              {explanation}
            </Typography>
            {tokensUsed > 0 && (
              <Typography sx={{ mt: 1, fontSize: 10, color: 'text.secondary', opacity: 0.6 }}>
                {tokensUsed} tokens
              </Typography>
            )}
          </Box>
        )}

        {changes.length > 0 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: 10, color: 'text.secondary', fontWeight: 500 }}>
                Changes ({changes.length})
              </Typography>
              {pendingCount > 0 && (
                <Chip label={pendingCount} size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />
              )}
            </Box>
            {changes.map((change, index) => (
              <CompactDiffCard
                key={index}
                change={change}
                isDark={isDark}
                accentBorder={accentBorder}
                onAccept={() => handleAcceptChange(index)}
                onReject={() => handleRejectChange(index)}
              />
            ))}
          </Box>
        )}

        {!explanation && !error && changes.length === 0 && !loading && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'center' }}>
              Ask me to help edit your document
            </Typography>
          </Box>
        )}

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
            <CircularProgress size={12} sx={{ color: 'primary.main' }} />
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Thinking...</Typography>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box sx={{ p: 1.5, bgcolor: 'background.default' }}>
        <Box sx={{
          bgcolor: surfaceActive,
          borderRadius: '8px',
          border: `1px solid ${accentBorder}`,
          overflow: 'visible',
          transition: 'border-color 0.15s',
          '&:focus-within': { borderColor: 'rgba(124, 58, 237, 0.5)' },
          position: 'relative',
        }}>
          {/* @file autocomplete dropdown */}
          {atSuggestions.length > 0 && (
            <Paper
              elevation={4}
              sx={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                mb: 0.5,
                borderRadius: '8px',
                overflow: 'hidden',
                zIndex: 10,
              }}
            >
              {atSuggestions.map(name => (
                <Box
                  key={name}
                  onMouseDown={(e) => { e.preventDefault(); handleAtSelect(name); }}
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    '&:hover': { bgcolor: surfaceActive },
                  }}
                >
                  @{name}
                </Box>
              ))}
            </Paper>
          )}

          {/* Context chips */}
          {(selection || showErrorChip) && (
            <Box sx={{ px: 1, pt: 0.75, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selection && (
                <Chip
                  label={`Lines ${selection.startLine}–${selection.endLine}`}
                  size="small"
                  sx={{ height: 20, fontSize: 10, bgcolor: 'rgba(124, 58, 237, 0.1)' }}
                />
              )}
              {showErrorChip && (
                <Chip
                  icon={<ErrorOutline sx={{ fontSize: 11 }} />}
                  label="compile error included"
                  size="small"
                  color="error"
                  variant="outlined"
                  onDelete={() => setDismissedError(true)}
                  sx={{ height: 20, fontSize: 10 }}
                />
              )}
            </Box>
          )}

          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={4}
            placeholder={projectFiles && projectFiles.length > 1
              ? 'Ask AI to edit… Type @ to reference a project file'
              : 'Ask AI to edit or generate code...'}
            value={instruction}
            onChange={handleInstructionChange}
            onKeyDown={handleKeyDown}
            disabled={loading}
            size="small"
            sx={{
              '& .MuiInputBase-root': {
                fontSize: 12,
                bgcolor: 'transparent',
                '& fieldset': { border: 'none' },
              },
              '& textarea': { lineHeight: 1.4, px: 1, py: 1 },
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pb: 1 }}>
            <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={handlePickPdf} />
            <IconButton size="small" onClick={() => fileRef.current?.click()} disabled={loading} title="Attach a PDF" sx={{ p: 0.5, color: 'text.secondary' }}>
              <AttachFile sx={{ fontSize: 14 }} />
            </IconButton>
            {pdf && (
              <Chip label={pdf.name} size="small" variant="outlined" onDelete={() => setPdf(null)}
                sx={{ height: 20, fontSize: 10, maxWidth: 160, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
            )}
            <Box sx={{ flex: 1 }} />
            <IconButton
              onClick={handleSubmit}
              disabled={loading || !instruction.trim()}
              size="small"
              sx={{
                p: 0.5,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                borderRadius: '6px',
                '&:hover': { bgcolor: 'primary.dark' },
                '&:disabled': { bgcolor: accentBorder, color: 'text.disabled' },
              }}
            >
              {loading
                ? <CircularProgress size={12} sx={{ color: 'primary.contrastText' }} />
                : <Send sx={{ fontSize: 14, transform: 'rotate(-45deg)' }} />}
            </IconButton>
          </Box>
        </Box>
        <Typography sx={{ fontSize: 10, color: 'text.secondary', textAlign: 'center', mt: 1, opacity: 0.5 }}>
          AI can make mistakes. Please verify important info.
        </Typography>
      </Box>
    </Box>
  );
}

const ACTION_LABEL: Record<string, string> = {
  read_file: 'read', search: 'search', edit: 'edit', compile: 'compile', inspect_log: 'inspect log', finish: 'finish',
};

function AgentTrace({ steps, live, accentBorder }: { steps: AgentStep[]; live: boolean; accentBorder: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { if (!live) setExpanded(false); }, [live]);

  return (
    <Box sx={{ border: `1px solid ${accentBorder}`, borderRadius: '6px', overflow: 'hidden' }}>
      <Box onClick={() => setExpanded(!expanded)} sx={{ px: 1, py: 0.5, display: 'flex', alignItems: 'center', cursor: 'pointer', bgcolor: 'action.hover' }}>
        <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'text.primary', flex: 1 }}>
          {live ? 'Working' : 'Reasoning trace'} · {steps.length} step{steps.length === 1 ? '' : 's'}
        </Typography>
        {expanded ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
      </Box>
      <Collapse in={expanded}>
        {steps.map(s => (
          <Box key={s.step} sx={{ px: 1, py: 0.5, borderTop: `1px solid ${accentBorder}` }}>
            <Box onClick={() => setOpen(open === s.step ? null : s.step)} sx={{ cursor: 'pointer' }}>
              <Typography sx={{ fontSize: 10, fontFamily: 'monospace', color: 'text.primary' }}>
                {s.step}. {ACTION_LABEL[s.action] ?? s.action} <Box component="span" sx={{ color: 'text.secondary' }}>{s.args}</Box>
              </Typography>
              {s.thought && <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>{s.thought}</Typography>}
            </Box>
            <Collapse in={open === s.step}>
              <Box component="pre" sx={{ m: 0, mt: 0.5, p: 0.75, fontSize: 9.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', bgcolor: 'background.default', color: 'text.primary', borderRadius: '4px' }}>
                {s.observation}
              </Box>
            </Collapse>
          </Box>
        ))}
      </Collapse>
    </Box>
  );
}

interface CompactDiffCardProps {
  change: DiffChange;
  isDark: boolean;
  accentBorder: string;
  onAccept: () => void;
  onReject: () => void;
}

function CompactDiffCard({ change, isDark, accentBorder, onAccept, onReject }: CompactDiffCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Box sx={{
      mb: 1,
      borderRadius: '4px',
      border: '1px solid',
      borderColor: accentBorder,
      overflow: 'hidden',
    }}>
      <Box
        sx={{
          px: 1, py: 0.5,
          bgcolor: isDark ? '#1e1e22' : '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, fontFamily: 'monospace' }}>
            L{change.start_line}-{change.end_line}
          </Typography>
          <Typography sx={{ fontSize: 10, color: 'text.secondary', ml: 0.5 }} noWrap>
            {change.reason}
          </Typography>
        </Box>
        {expanded ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }}>
          <Box sx={{ bgcolor: 'rgba(239, 68, 68, 0.15)', px: 1, py: 0.5 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#ef4444' }}>
              - {change.original.substring(0, 200)}{change.original.length > 200 ? '...' : ''}
            </pre>
          </Box>
          <Box sx={{ bgcolor: 'rgba(34, 197, 94, 0.15)', px: 1, py: 0.5 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#22c55e' }}>
              + {change.replacement.substring(0, 200)}{change.replacement.length > 200 ? '...' : ''}
            </pre>
          </Box>
        </Box>

        <Box sx={{ p: 0.5, display: 'flex', gap: 0.5, justifyContent: 'flex-end', bgcolor: 'background.paper' }}>
          <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); onReject(); }} sx={{ p: 0.25 }}>
            <Clear sx={{ fontSize: 14 }} />
          </IconButton>
          <IconButton size="small" color="success" onClick={(e) => { e.stopPropagation(); onAccept(); }} sx={{ p: 0.25 }}>
            <Check sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      </Collapse>
    </Box>
  );
}
