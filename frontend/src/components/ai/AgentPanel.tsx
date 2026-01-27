import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  CircularProgress,
  Chip,
  FormControl,
  Select,
  MenuItem,
  Collapse,
  Alert,
} from '@mui/material';
import {
  Send,
  Check,
  Clear,
  ExpandMore,
  ExpandLess,
  SmartToy,
} from '@mui/icons-material';
import { api } from '../../services/api';

interface DiffChange {
  start_line: number;
  end_line: number;
  original: string;
  replacement: string;
  reason: string;
  accepted?: boolean;
}

interface AgentPanelProps {
  projectId: string;
  document: string;
  onApplyChanges: (newContent: string) => void;
}

export function AgentPanel({ projectId, document, onApplyChanges }: AgentPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState<'flash' | 'pro'>('pro');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [explanation, setExplanation] = useState('');
  const [changes, setChanges] = useState<DiffChange[]>([]);
  const [tokensUsed, setTokensUsed] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && (explanation || changes.length > 0)) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [explanation, changes]);

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim()) return;
    
    setLoading(true);
    setError('');
    setChanges([]);
    setExplanation('');
    
    try {
      const result = await api.agentEdit(projectId, instruction, document, model);
      setExplanation(result.explanation);
      setChanges(result.changes.map(c => ({ ...c, accepted: undefined })));
      setTokensUsed(result.tokens);
    } catch (err: any) {
      setError(err.message || 'Failed to process request');
    } finally {
      setLoading(false);
    }
  }, [instruction, projectId, document, model]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleAcceptChange = (index: number) => {
    setChanges(prev => prev.map((c, i) => 
      i === index ? { ...c, accepted: true } : c
    ));
  };

  const handleRejectChange = (index: number) => {
    setChanges(prev => prev.map((c, i) => 
      i === index ? { ...c, accepted: false } : c
    ));
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
    
    newDoc = lines.join('\n');
    onApplyChanges(newDoc);
    
    setChanges([]);
    setExplanation('');
    setInstruction('');
  };

  const acceptedCount = changes.filter(c => c.accepted === true).length;
  const pendingCount = changes.filter(c => c.accepted === undefined).length;

  return (
    <Box sx={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      bgcolor: 'background.paper',
    }}>
      {/* Header */}
      <Box sx={{ 
        px: 1.5, 
        py: 1,
        display: 'flex', 
        alignItems: 'center', 
        gap: 1,
        borderBottom: 1,
        borderColor: 'divider',
      }}>
        <SmartToy sx={{ fontSize: 16 }} color="primary" />
        <Typography variant="caption" fontWeight={600} letterSpacing={0.5}>
          AI ASSISTANT
        </Typography>
      </Box>

      {/* Messages */}
      <Box 
        ref={scrollRef}
        sx={{ 
          flex: 1, 
          overflow: 'auto', 
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {error && (
          <Alert severity="error" sx={{ py: 0.5, fontSize: 12 }}>{error}</Alert>
        )}
        
        {explanation && (
          <Box sx={{ 
            bgcolor: 'action.hover', 
            borderRadius: 1, 
            p: 1.5,
          }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Response
            </Typography>
            <Typography variant="body2" sx={{ fontSize: 12, lineHeight: 1.5 }}>
              {explanation}
            </Typography>
            {tokensUsed > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', fontSize: 10 }}>
                {tokensUsed} tokens
              </Typography>
            )}
          </Box>
        )}
        
        {changes.length > 0 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={500}>
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
                onAccept={() => handleAcceptChange(index)}
                onReject={() => handleRejectChange(index)}
              />
            ))}
          </Box>
        )}

        {!explanation && !error && changes.length === 0 && !loading && (
          <Box sx={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            opacity: 0.5,
          }}>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              Ask me to help edit your document
            </Typography>
          </Box>
        )}

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">Thinking...</Typography>
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
            startIcon={<Check sx={{ fontSize: 16 }} />}
            sx={{ fontSize: 12, py: 0.5 }}
          >
            Apply {acceptedCount} change{acceptedCount !== 1 ? 's' : ''}
          </Button>
        </Box>
      )}

      {/* Input */}
      <Box sx={{ 
        p: 1.5, 
        borderTop: 1, 
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          multiline
          maxRows={4}
          placeholder="What would you like to change?"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          size="small"
          sx={{ 
            mb: 1,
            '& .MuiInputBase-root': { fontSize: 12 },
            '& textarea': { lineHeight: 1.4 },
          }}
        />
        
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 70 }}>
            <Select
              value={model}
              onChange={(e) => setModel(e.target.value as 'flash' | 'pro')}
              disabled={loading}
              sx={{ fontSize: 11, '& .MuiSelect-select': { py: 0.5, px: 1 } }}
            >
              <MenuItem value="flash" sx={{ fontSize: 11 }}>Flash</MenuItem>
              <MenuItem value="pro" sx={{ fontSize: 11 }}>Pro</MenuItem>
            </Select>
          </FormControl>
          
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading || !instruction.trim()}
            size="small"
            sx={{ flex: 1, fontSize: 12, py: 0.5 }}
            endIcon={loading ? <CircularProgress size={12} /> : <Send sx={{ fontSize: 14 }} />}
          >
            Send
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

interface CompactDiffCardProps {
  change: DiffChange;
  onAccept: () => void;
  onReject: () => void;
}

function CompactDiffCard({ change, onAccept, onReject }: CompactDiffCardProps) {
  const [expanded, setExpanded] = useState(true);
  
  const getBorderColor = () => {
    if (change.accepted === true) return 'success.main';
    if (change.accepted === false) return 'error.main';
    return 'divider';
  };
  
  return (
    <Box
      sx={{
        mb: 1,
        borderRadius: 0.5,
        border: 1,
        borderColor: getBorderColor(),
        overflow: 'hidden',
        opacity: change.accepted === false ? 0.5 : 1,
        fontSize: 11,
      }}
    >
      <Box
        sx={{
          px: 1,
          py: 0.5,
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" fontWeight={500} sx={{ fontSize: 11 }}>
            L{change.start_line}-{change.end_line}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1, fontSize: 10 }} noWrap>
            {change.reason}
          </Typography>
        </Box>
        {expanded ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
      </Box>
      
      <Collapse in={expanded}>
        <Box sx={{ fontFamily: 'monospace', fontSize: 10 }}>
          <Box sx={{ bgcolor: 'error.dark', color: 'error.contrastText', px: 1, py: 0.5 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              - {change.original.substring(0, 200)}{change.original.length > 200 ? '...' : ''}
            </pre>
          </Box>
          
          <Box sx={{ bgcolor: 'success.dark', color: 'success.contrastText', px: 1, py: 0.5 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              + {change.replacement.substring(0, 200)}{change.replacement.length > 200 ? '...' : ''}
            </pre>
          </Box>
        </Box>
        
        {change.accepted === undefined && (
          <Box sx={{ p: 0.5, display: 'flex', gap: 0.5, justifyContent: 'flex-end', bgcolor: 'background.paper' }}>
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); onReject(); }}
              sx={{ p: 0.25 }}
            >
              <Clear sx={{ fontSize: 14 }} />
            </IconButton>
            <IconButton
              size="small"
              color="success"
              onClick={(e) => { e.stopPropagation(); onAccept(); }}
              sx={{ p: 0.25 }}
            >
              <Check sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        )}
        
        {change.accepted === true && (
          <Box sx={{ px: 1, py: 0.25, bgcolor: 'success.light', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Check sx={{ fontSize: 12 }} color="success" />
            <Typography variant="caption" color="success.dark" sx={{ fontSize: 10 }}>Accepted</Typography>
          </Box>
        )}
        
        {change.accepted === false && (
          <Box sx={{ px: 1, py: 0.25, bgcolor: 'error.light', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Clear sx={{ fontSize: 12 }} color="error" />
            <Typography variant="caption" color="error.dark" sx={{ fontSize: 10 }}>Rejected</Typography>
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
