import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  LinearProgress,
  Alert,
  Chip,
} from '@mui/material';
import {
  CloudUpload,
  Description,
  Science,
  School,
  Article,
  Email,
  Add,
} from '@mui/icons-material';
import { api } from '../services/api';

const PRESET_THEMES = [
  { id: 'journal', label: 'Academic Journal', icon: <Article />, desc: 'IEEE, ACM style papers' },
  { id: 'problem_set', label: 'Problem Set', icon: <Science />, desc: 'Homework and exercises' },
  { id: 'thesis', label: 'Thesis/Report', icon: <School />, desc: 'Long-form documents' },
  { id: 'letter', label: 'Formal Letter', icon: <Email />, desc: 'Business correspondence' },
  { id: 'custom', label: 'Custom Theme', icon: <Add />, desc: 'Describe your own' },
];

export function Home() {
  const navigate = useNavigate();
  const [selectedTheme, setSelectedTheme] = useState('journal');
  const [customTheme, setCustomTheme] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

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
    
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && (droppedFile.name.endsWith('.docx') || droppedFile.name.endsWith('.doc'))) {
      setFile(droppedFile);
      setError('');
    } else {
      setError('Please upload a .docx or .doc file');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    setError('');

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 10, 90));
    }, 200);

    try {
      const result = await api.uploadFile(
        file,
        selectedTheme,
        selectedTheme === 'custom' ? customTheme : undefined
      );
      setUploadProgress(100);
      clearInterval(progressInterval);
      navigate(`/editor/${result.project_id}`);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      clearInterval(progressInterval);
    } finally {
      setUploading(false);
    }
  };

  const handleCreateBlank = async () => {
    try {
      const result = await api.createProject({
        name: 'Untitled Document',
        theme: selectedTheme,
        customTheme: selectedTheme === 'custom' ? customTheme : undefined,
      });
      navigate(`/editor/${result.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    }
  };

  return (
    <Box sx={{ p: 4, maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h4" fontWeight={600} mb={1}>
        Create New Document
      </Typography>
      <Typography color="text.secondary" mb={4}>
        Upload a Word document or start from scratch with AI-powered LaTeX conversion
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Grid container spacing={4}>
        <Grid item xs={12} md={7}>
          <Paper
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            sx={{
              p: 4,
              border: 2,
              borderStyle: 'dashed',
              borderColor: dragActive ? 'primary.main' : 'divider',
              bgcolor: dragActive ? 'action.hover' : 'transparent',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
            }}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".doc,.docx"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" mb={1}>
              {file ? file.name : 'Drop your document here'}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Supports .docx and .doc files'}
            </Typography>
          </Paper>

          {uploading && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress variant="determinate" value={uploadProgress} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Converting to LaTeX... {uploadProgress}%
              </Typography>
            </Box>
          )}

          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              size="large"
              onClick={handleUpload}
              disabled={!file || uploading}
              startIcon={<CloudUpload />}
            >
              Convert to LaTeX
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={handleCreateBlank}
              startIcon={<Description />}
            >
              Start Blank
            </Button>
          </Box>
        </Grid>

        <Grid item xs={12} md={5}>
          <Typography variant="h6" mb={2}>Select Document Theme</Typography>
          <Grid container spacing={1.5}>
            {PRESET_THEMES.map((theme) => (
              <Grid item xs={6} key={theme.id}>
                <Card
                  onClick={() => setSelectedTheme(theme.id)}
                  sx={{
                    cursor: 'pointer',
                    border: 2,
                    borderColor: selectedTheme === theme.id ? 'primary.main' : 'transparent',
                    transition: 'all 0.2s',
                    '&:hover': { borderColor: 'primary.light' },
                  }}
                >
                  <CardContent sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      {theme.icon}
                      <Typography variant="body2" fontWeight={500}>
                        {theme.label}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {theme.desc}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {selectedTheme === 'custom' && (
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Describe your theme"
              placeholder="e.g., Modern minimalist design with sans-serif fonts, wide margins..."
              value={customTheme}
              onChange={(e) => setCustomTheme(e.target.value)}
              sx={{ mt: 2 }}
            />
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
