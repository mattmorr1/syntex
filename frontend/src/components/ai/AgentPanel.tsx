import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  CircularProgress,
  FormControl,
  Select,
  MenuItem,
  Collapse,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Send,
  Check,
  Clear,
  ExpandMore,
  ExpandLess,
  SmartToy,
  Image as ImageIcon,
  Close,
  Layers,
} from '@mui/icons-material';
import { api } from '../../services/api';

interface DiffChange {
  start_line: number;
  end_line: number;
  original: string;
  replacement: string;
  reason: string;
}

interface AgentPanelProps {
  projectId: string;
  document: string;
  onApplyChanges: (newContent: string) => void;
}

export function AgentPanel({ projectId, document, onApplyChanges }: AgentPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState<'flash' | 'pro'>('pro');
  const [batchMode, setBatchMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [explanation, setExplanation] = useState('');
  const [changes, setChanges] = useState<DiffChange[]>([]);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current && (explanation || changes.length > 0)) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [explanation, changes]);

  // Cleanup image previews on unmount
  useEffect(() => {
    return () => {
      images.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, [images]);

  const handleImageAdd = useCallback((files: FileList | null) => {
    if (!files) return;
    const newImages: { file: File; preview: string }[] = [];
    for (let i = 0; i < files.length && images.length + newImages.length < 5; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        newImages.push({ file, preview: URL.createObjectURL(file) });
      }
    }
    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages]);
    }
  }, [images.length]);

  const handleImageRemove = (index: number) => {
    setImages(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleImageAdd(e.dataTransfer.files);
  }, [handleImageAdd]);

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim() && images.length === 0) return;
    
    setLoading(true);
    setError('');
    setChanges([]);
    setExplanation('');
    
    try {
      // Convert images to base64
      const imageData: string[] = [];
      for (const img of images) {
        const base64 = await fileToBase64(img.file);
        imageData.push(base64);
      }
      
      const result = await api.agentEdit(projectId, instruction, document, model, imageData, batchMode);
      setExplanation(result.explanation);
      setChanges(result.changes);
      setTokensUsed(result.tokens);
      // Clear images after successful submit
      images.forEach(img => URL.revokeObjectURL(img.preview));
      setImages([]);
    } catch (err: any) {
      setError(err.message || 'Failed to process request');
    } finally {
      setLoading(false);
    }
  }, [instruction, projectId, document, model, images, batchMode]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const applyChange = (change: DiffChange) => {
    const lines = document.split('\n');
    const beforeLines = lines.slice(0, change.start_line - 1);
    const afterLines = lines.slice(change.end_line);
    const replacementLines = change.replacement.split('\n');

    const newDoc = [...beforeLines, ...replacementLines, ...afterLines].join('\n');
    onApplyChanges(newDoc);
  };

  const handleAcceptChange = (index: number) => {
    const change = changes[index];

    // Apply the change immediately
    applyChange(change);

    // Remove this change from the list (it's been applied)
    // Adjust line numbers for remaining changes
    const lineDiff = change.replacement.split('\n').length - (change.end_line - change.start_line + 1);

    setChanges(prev => prev
      .filter((_, i) => i !== index)
      .map(c => {
        if (c.start_line > change.end_line) {
          return {
            ...c,
            start_line: c.start_line + lineDiff,
            end_line: c.end_line + lineDiff,
          };
        }
        return c;
      })
    );
  };

  const handleRejectChange = (index: number) => {
    // Just remove the change from the list
    setChanges(prev => prev.filter((_, i) => i !== index));
  };

  const handleAcceptAll = () => {
    // Apply all remaining changes at once (from bottom to top to preserve line numbers)
    let newDoc = document;
    const lines = newDoc.split('\n');

    const sortedChanges = [...changes].sort((a, b) => b.start_line - a.start_line);

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

  const handleRejectAll = () => {
    setChanges([]);
  };

  const pendingCount = changes.length;

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
                {changes.length} change{changes.length !== 1 ? 's' : ''} suggested
              </Typography>
              {changes.length > 1 && (
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Button
                    size="small"
                    variant="text"
                    color="error"
                    onClick={handleRejectAll}
                    sx={{ fontSize: 10, py: 0, minWidth: 'auto', px: 1 }}
                  >
                    Reject all
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="success"
                    onClick={handleAcceptAll}
                    sx={{ fontSize: 10, py: 0, minWidth: 'auto', px: 1 }}
                  >
                    Accept all
                  </Button>
                </Box>
              )}
            </Box>

            {changes.map((change, index) => (
              <CompactDiffCard
                key={`${change.start_line}-${change.end_line}-${index}`}
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

      {/* Input */}
      <Box 
        sx={{ 
          p: 1.5, 
          borderTop: 1, 
          borderColor: dragActive ? 'primary.main' : 'divider',
          bgcolor: dragActive ? 'action.hover' : 'background.default',
          transition: 'all 0.2s',
        }}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {/* Image previews */}
        {images.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
            {images.map((img, index) => (
              <Box
                key={index}
                sx={{
                  position: 'relative',
                  width: 48,
                  height: 48,
                  borderRadius: 0.5,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <img
                  src={img.preview}
                  alt={`Upload ${index + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <IconButton
                  size="small"
                  onClick={() => handleImageRemove(index)}
                  sx={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    bgcolor: 'background.paper',
                    p: 0.25,
                    '&:hover': { bgcolor: 'error.light' },
                  }}
                >
                  <Close sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}
        
        <TextField
          inputRef={inputRef}
          fullWidth
          multiline
          maxRows={4}
          placeholder={images.length > 0 ? "Describe what to do with these images..." : "What would you like to change? (drag images here)"}
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
        
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleImageAdd(e.target.files)}
        />
        
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <IconButton
            size="small"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || images.length >= 5}
            sx={{ p: 0.5 }}
          >
            <ImageIcon sx={{ fontSize: 18 }} />
          </IconButton>
          
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

          <Tooltip title="Batch mode - thorough analysis for large docs">
            <IconButton
              size="small"
              onClick={() => setBatchMode(!batchMode)}
              color={batchMode ? 'primary' : 'default'}
              disabled={loading}
              sx={{ p: 0.5 }}
            >
              <Layers sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading || (!instruction.trim() && images.length === 0)}
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

  return (
    <Box
      sx={{
        mb: 1,
        borderRadius: 0.5,
        border: 1,
        borderColor: 'divider',
        overflow: 'hidden',
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
          {expanded ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
        </Box>
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
      </Collapse>
    </Box>
  );
}
