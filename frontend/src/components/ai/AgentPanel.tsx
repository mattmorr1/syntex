import { useState, useCallback } from 'react';
import {
  Drawer,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Divider,
  CircularProgress,
  Chip,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Collapse,
  Alert,
} from '@mui/material';
import {
  Close,
  Send,
  Check,
  Clear,
  ExpandMore,
  ExpandLess,
  AutoFixHigh,
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
  open: boolean;
  onClose: () => void;
  projectId: string;
  document: string;
  onApplyChanges: (newContent: string) => void;
}

export function AgentPanel({ open, onClose, projectId, document, onApplyChanges }: AgentPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState<'flash' | 'pro'>('pro');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [explanation, setExplanation] = useState('');
  const [changes, setChanges] = useState<DiffChange[]>([]);
  const [tokensUsed, setTokensUsed] = useState(0);

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
    
    // Apply changes in reverse order to preserve line numbers
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
    
    // Reset state
    setChanges([]);
    setExplanation('');
    setInstruction('');
  };

  const acceptedCount = changes.filter(c => c.accepted === true).length;
  const pendingCount = changes.filter(c => c.accepted === undefined).length;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
      sx={{
        '& .MuiDrawer-paper': {
          width: 400,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box sx={{ 
          p: 2, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          borderBottom: 1,
          borderColor: 'divider'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoFixHigh color="primary" />
            <Typography variant="h6">AI Agent</Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <Close />
          </IconButton>
        </Box>

        {/* Input */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            fullWidth
            multiline
            rows={3}
            placeholder="Describe what you want to change..."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={loading}
            sx={{ mb: 2 }}
          />
          
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Model</InputLabel>
              <Select
                value={model}
                label="Model"
                onChange={(e) => setModel(e.target.value as 'flash' | 'pro')}
                disabled={loading}
              >
                <MenuItem value="flash">Flash</MenuItem>
                <MenuItem value="pro">Pro</MenuItem>
              </Select>
            </FormControl>
            
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={loading || !instruction.trim()}
              startIcon={loading ? <CircularProgress size={16} /> : <Send />}
              sx={{ flex: 1 }}
            >
              {loading ? 'Processing...' : 'Send'}
            </Button>
          </Box>
        </Box>

        {/* Results */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
          )}
          
          {explanation && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Agent Response
              </Typography>
              <Typography variant="body2">{explanation}</Typography>
              {tokensUsed > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Tokens used: {tokensUsed}
                </Typography>
              )}
            </Box>
          )}
          
          {changes.length > 0 && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Proposed Changes ({changes.length})
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {pendingCount > 0 && (
                    <Chip label={`${pendingCount} pending`} size="small" color="warning" variant="outlined" />
                  )}
                  {acceptedCount > 0 && (
                    <Chip label={`${acceptedCount} accepted`} size="small" color="success" variant="outlined" />
                  )}
                </Box>
              </Box>
              
              {changes.map((change, index) => (
                <DiffCard
                  key={index}
                  change={change}
                  onAccept={() => handleAcceptChange(index)}
                  onReject={() => handleRejectChange(index)}
                />
              ))}
            </>
          )}
        </Box>

        {/* Footer */}
        {acceptedCount > 0 && (
          <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
            <Button
              fullWidth
              variant="contained"
              color="success"
              onClick={handleApplyAll}
              startIcon={<Check />}
            >
              Apply {acceptedCount} Change{acceptedCount !== 1 ? 's' : ''}
            </Button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}

interface DiffCardProps {
  change: DiffChange;
  onAccept: () => void;
  onReject: () => void;
}

function DiffCard({ change, onAccept, onReject }: DiffCardProps) {
  const [expanded, setExpanded] = useState(true);
  
  const getBorderColor = () => {
    if (change.accepted === true) return 'success.main';
    if (change.accepted === false) return 'error.main';
    return 'divider';
  };
  
  return (
    <Box
      sx={{
        mb: 2,
        borderRadius: 1,
        border: 2,
        borderColor: getBorderColor(),
        overflow: 'hidden',
        opacity: change.accepted === false ? 0.5 : 1,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Box>
          <Typography variant="body2" fontWeight={500}>
            Lines {change.start_line}-{change.end_line}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {change.reason}
          </Typography>
        </Box>
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </Box>
      
      <Collapse in={expanded}>
        {/* Diff View */}
        <Box sx={{ fontFamily: 'monospace', fontSize: 12 }}>
          {/* Removed */}
          <Box sx={{ bgcolor: 'error.dark', color: 'error.contrastText', p: 1.5, opacity: 0.8 }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, opacity: 0.7 }}>
              - Remove
            </Typography>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {change.original}
            </pre>
          </Box>
          
          {/* Added */}
          <Box sx={{ bgcolor: 'success.dark', color: 'success.contrastText', p: 1.5, opacity: 0.9 }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, opacity: 0.7 }}>
              + Add
            </Typography>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {change.replacement}
            </pre>
          </Box>
        </Box>
        
        {/* Actions */}
        {change.accepted === undefined && (
          <Box sx={{ p: 1, display: 'flex', gap: 1, justifyContent: 'flex-end', bgcolor: 'background.paper' }}>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<Clear />}
              onClick={(e) => { e.stopPropagation(); onReject(); }}
            >
              Reject
            </Button>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<Check />}
              onClick={(e) => { e.stopPropagation(); onAccept(); }}
            >
              Accept
            </Button>
          </Box>
        )}
        
        {change.accepted === true && (
          <Box sx={{ p: 1, bgcolor: 'success.light', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Check fontSize="small" color="success" />
            <Typography variant="caption" color="success.dark">Accepted</Typography>
          </Box>
        )}
        
        {change.accepted === false && (
          <Box sx={{ p: 1, bgcolor: 'error.light', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Clear fontSize="small" color="error" />
            <Typography variant="caption" color="error.dark">Rejected</Typography>
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
