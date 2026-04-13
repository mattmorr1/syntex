import { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  LinearProgress,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  CloudUpload,
  Image,
  Check,
  Close,
  Warning,
} from '@mui/icons-material';
import { useThemeStore } from '../../store/themeStore';
import { api } from '../../services/api';

interface MissingImagesDialogProps {
  open: boolean;
  projectId: string;
  missingImages: string[];   // filenames referenced in LaTeX but not uploaded
  onDone: () => void;        // called when user finishes (skip or after upload)
}

export function MissingImagesDialog({ open, projectId, missingImages, onDone }: MissingImagesDialogProps) {
  const { mode } = useThemeStore();
  const isDark = mode === 'dark';
  const accentBorder = isDark ? '#2d2d2d' : '#e4e4e7';

  const [dragActive, setDragActive] = useState(false);
  const [queued, setQueued] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'application/pdf'];

  const addFiles = (files: File[]) => {
    const valid = files.filter(f => allowedTypes.includes(f.type));
    setQueued(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragActive(true); };
  const handleDragLeave = () => setDragActive(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
  };

  const removeQueued = (name: string) => setQueued(prev => prev.filter(f => f.name !== name));

  const handleUpload = async () => {
    if (!queued.length) return;
    setUploading(true);
    setError('');
    setProgress(10);

    try {
      const result = await api.addProjectImages(projectId, queued);
      setUploaded(result.added);
      setProgress(100);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const isDone = uploaded.length > 0;

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '12px',
          border: `1px solid ${accentBorder}`,
          bgcolor: 'background.paper',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Warning sx={{ color: 'warning.main', fontSize: 20 }} />
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Missing Images</Typography>
        </Box>
        <IconButton size="small" onClick={onDone} sx={{ p: 0.5 }}>
          <Close sx={{ fontSize: 16 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 0 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
          The generated document references{' '}
          <strong>{missingImages.length}</strong> image{missingImages.length !== 1 ? 's' : ''} that
          weren't found in the source. Upload them now so the document compiles correctly.
        </Typography>

        {/* Required images list */}
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Required
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {missingImages.map(name => {
              const isUploaded = uploaded.some(u => u === name || queued.some(q => q.name === name && uploaded.includes(q.name)));
              const isQueued = queued.some(q => q.name === name);
              return (
                <Chip
                  key={name}
                  icon={isUploaded ? <Check sx={{ fontSize: 12 }} /> : isQueued ? <Image sx={{ fontSize: 12 }} /> : undefined}
                  label={name}
                  size="small"
                  color={isUploaded ? 'success' : isQueued ? 'primary' : 'default'}
                  variant={isQueued || isUploaded ? 'filled' : 'outlined'}
                  sx={{ fontFamily: 'monospace', fontSize: 10 }}
                />
              );
            })}
          </Box>
        </Box>

        {/* Drop zone */}
        {!isDone && (
          <Box
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
            sx={{
              border: `2px dashed ${dragActive ? 'primary.main' : accentBorder}`,
              borderRadius: '8px',
              p: 3,
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
              bgcolor: dragActive ? 'rgba(124, 58, 237, 0.05)' : 'transparent',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'rgba(124, 58, 237, 0.03)' },
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={handleInputChange}
            />
            <CloudUpload sx={{ fontSize: 32, color: 'text.secondary', mb: 1 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
              Drop images here or click to browse
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
              PNG, JPG, PDF — bulk upload supported
            </Typography>
          </Box>
        )}

        {/* Queued files */}
        {queued.length > 0 && !isDone && (
          <List dense sx={{ mt: 1 }}>
            {queued.map(f => (
              <ListItem
                key={f.name}
                sx={{ px: 0, py: 0.25 }}
                secondaryAction={
                  <IconButton size="small" onClick={() => removeQueued(f.name)} sx={{ p: 0.25 }}>
                    <Close sx={{ fontSize: 12 }} />
                  </IconButton>
                }
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Image sx={{ fontSize: 14, color: 'primary.main' }} />
                </ListItemIcon>
                <ListItemText
                  primary={f.name}
                  primaryTypographyProps={{ fontSize: 11, fontFamily: 'monospace' }}
                  secondary={`${(f.size / 1024).toFixed(0)} KB`}
                  secondaryTypographyProps={{ fontSize: 10 }}
                />
              </ListItem>
            ))}
          </List>
        )}

        {uploading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 4 }} />
            <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 0.5 }}>
              Uploading {queued.length} file{queued.length !== 1 ? 's' : ''}…
            </Typography>
          </Box>
        )}

        {isDone && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: 'rgba(34, 197, 94, 0.1)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Check sx={{ color: 'success.main', fontSize: 16 }} />
            <Typography sx={{ fontSize: 12, color: 'success.main' }}>
              {uploaded.length} image{uploaded.length !== 1 ? 's' : ''} uploaded successfully.
            </Typography>
          </Box>
        )}

        {error && (
          <Typography sx={{ mt: 1, fontSize: 11, color: 'error.main' }}>{error}</Typography>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, pb: 2, gap: 1 }}>
        {!isDone ? (
          <>
            <Button size="small" onClick={onDone} sx={{ fontSize: 12, color: 'text.secondary' }}>
              Skip for now
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleUpload}
              disabled={!queued.length || uploading}
              startIcon={<CloudUpload sx={{ fontSize: 14 }} />}
              sx={{ fontSize: 12 }}
            >
              Upload {queued.length > 0 ? `${queued.length} ` : ''}Image{queued.length !== 1 ? 's' : ''}
            </Button>
          </>
        ) : (
          <Button size="small" variant="contained" onClick={onDone} sx={{ fontSize: 12 }}>
            Open Document
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
