import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
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
import { api } from '../../services/api';

interface DiffChange {
  start_line: number;
  end_line: number;
  original: string;
  replacement: string;
  reason: string;
  accepted?: boolean;
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
  selection?: SelectionInfo | null;
  projectFiles?: ProjectFile[];
  compileError?: string | null;
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
  selection,
  projectFiles,
  compileError,
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
  const [dismissedError, setDismissedError] = useState(false);
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

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim()) return;

    setLoading(true);
    setError('');
    setChanges([]);
    setExplanation('');
    setTokensUsed(0);

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
          setChanges(result.changes.map((c: any) => ({ ...c, accepted: undefined })));
          setTokensUsed(result.tokens);
        },
        (message) => {
          setError(message);
        },
        supportingFiles,
      );
    } catch (err: any) {
      setError(err.message || 'Failed to process request');
    } finally {
      setLoading(false);
    }
  }, [instruction, projectId, document, aiModel, selection, compileError, dismissedError, projectFiles]);

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
    setChanges(prev => prev.map((c, i) => i === index ? { ...c, accepted: true } : c));
  };

  const handleRejectChange = (index: number) => {
    setChanges(prev => prev.map((c, i) => i === index ? { ...c, accepted: false } : c));
  };

  const handleApplyAll = () => {
    const acceptedChanges = changes.filter(c => c.accepted === true);
    if (acceptedChanges.length === 0) return;

    let newDoc = document;
    const lines = newDoc.split('\n');
    const sortedChanges = [...acceptedChanges].sort((a, b) => b.start_line - a.start_line);

    for (const change of sortedChanges) {
      const beforeLines = lines.slice(0, change.start_line - 1);
      const afterLines = lines.slice(change.end_line);
      const replacementLines = change.replacement.split('\n');
      lines.splice(0, lines.length, ...beforeLines, ...replacementLines, ...afterLines);
    }

    onApplyChanges(lines.join('\n'));
    setChanges([]);
    setExplanation('');
    setInstruction('');
  };

  const acceptedCount = changes.filter(c => c.accepted === true).length;
  const pendingCount = changes.filter(c => c.accepted === undefined).length;
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
        {error && (
          <Alert severity="error" sx={{ py: 0.5, fontSize: 11 }}>{error}</Alert>
        )}

        {explanation && (
          <Box sx={{
            bgcolor: surfaceActive,
            borderRadius: '8px',
            border: `1px solid ${accentBorder}`,
            p: 1.5,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
              <SmartToy sx={{ fontSize: 12, color: 'primary.main' }} />
              <Typography sx={{ fontSize: 10, fontWeight: 600 }}>syntex</Typography>
            </Box>
            <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'text.secondary' }}>
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
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {pendingCount > 0 && (
                  <Chip label={pendingCount} size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />
                )}
                {acceptedCount > 0 && (
                  <Chip label={acceptedCount} size="small" color="success" sx={{ height: 18, fontSize: 10 }} />
                )}
              </Box>
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

      {/* Apply Button */}
      {acceptedCount > 0 && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <Button
            fullWidth
            variant="contained"
            color="success"
            size="small"
            onClick={handleApplyAll}
            startIcon={<Check sx={{ fontSize: 14 }} />}
            sx={{ fontSize: 11, py: 0.5 }}
          >
            Apply {acceptedCount} change{acceptedCount !== 1 ? 's' : ''}
          </Button>
        </Box>
      )}

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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', px: 1, pb: 1 }}>
            <IconButton
              onClick={handleSubmit}
              disabled={loading || !instruction.trim()}
              size="small"
              sx={{
                p: 0.5,
                bgcolor: 'primary.main',
                color: '#fff',
                borderRadius: '6px',
                '&:hover': { bgcolor: 'primary.dark' },
                '&:disabled': { bgcolor: accentBorder, color: 'text.disabled' },
              }}
            >
              {loading
                ? <CircularProgress size={12} sx={{ color: '#fff' }} />
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

interface CompactDiffCardProps {
  change: DiffChange;
  isDark: boolean;
  accentBorder: string;
  onAccept: () => void;
  onReject: () => void;
}

function CompactDiffCard({ change, isDark, accentBorder, onAccept, onReject }: CompactDiffCardProps) {
  const [expanded, setExpanded] = useState(true);

  const getBorderColor = () => {
    if (change.accepted === true) return 'success.main';
    if (change.accepted === false) return 'error.main';
    return accentBorder;
  };

  return (
    <Box sx={{
      mb: 1,
      borderRadius: '4px',
      border: '1px solid',
      borderColor: getBorderColor(),
      overflow: 'hidden',
      opacity: change.accepted === false ? 0.5 : 1,
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

        {change.accepted === undefined && (
          <Box sx={{ p: 0.5, display: 'flex', gap: 0.5, justifyContent: 'flex-end', bgcolor: 'background.paper' }}>
            <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); onReject(); }} sx={{ p: 0.25 }}>
              <Clear sx={{ fontSize: 14 }} />
            </IconButton>
            <IconButton size="small" color="success" onClick={(e) => { e.stopPropagation(); onAccept(); }} sx={{ p: 0.25 }}>
              <Check sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        )}
        {change.accepted === true && (
          <Box sx={{ px: 1, py: 0.25, bgcolor: 'rgba(34, 197, 94, 0.1)', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Check sx={{ fontSize: 12, color: 'success.main' }} />
            <Typography sx={{ fontSize: 10, color: 'success.main' }}>Accepted</Typography>
          </Box>
        )}
        {change.accepted === false && (
          <Box sx={{ px: 1, py: 0.25, bgcolor: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Clear sx={{ fontSize: 12, color: 'error.main' }} />
            <Typography sx={{ fontSize: 10, color: 'error.main' }}>Rejected</Typography>
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
