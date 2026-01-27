import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  TextField,
  LinearProgress,
  Alert,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Skeleton,
  Tooltip,
} from '@mui/material';
import {
  Add,
  CloudUpload,
  Description,
  Article,
  Assignment,
  School,
  Mail,
  Tune,
  Close,
  Search,
  MoreVert,
  Edit,
  ContentCopy,
  Delete,
  Download,
} from '@mui/icons-material';
import { api } from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { Project } from '../store/editorStore';

const TEMPLATES = [
  { id: 'blank', label: 'Blank', icon: Add },
  { id: 'report', label: 'Report', icon: Description },
  { id: 'journal', label: 'Journal', icon: Article },
  { id: 'problem_set', label: 'Problem Set', icon: Assignment },
  { id: 'thesis', label: 'Thesis', icon: School },
  { id: 'letter', label: 'Letter', icon: Mail },
];

export function Home() {
  const navigate = useNavigate();
  const { mode } = useThemeStore();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; project: Project } | null>(null);

  const borderColor = mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const hoverBg = mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
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
      const result = await api.uploadFile(file, 'report', undefined);
      setUploadProgress(100);
      clearInterval(progressInterval);
      navigate(`/editor/${result.project_id}`);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      clearInterval(progressInterval);
      setUploading(false);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    try {
      const result = await api.createProject({
        name: 'Untitled Document',
        theme: templateId === 'blank' ? 'report' : templateId,
      });
      navigate(`/editor/${result.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create document');
    }
  };

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, project: Project) => {
    e.stopPropagation();
    setMenuAnchor({ el: e.currentTarget, project });
  };

  const handleMenuClose = () => setMenuAnchor(null);

  const handleDuplicate = async () => {
    if (!menuAnchor) return;
    try {
      await api.duplicateProject(menuAnchor.project.id);
      loadProjects();
    } catch (err: any) {
      setError(err.message);
    }
    handleMenuClose();
  };

  const handleDelete = async () => {
    if (!menuAnchor) return;
    if (!confirm('Delete this document?')) return;
    try {
      await api.deleteProject(menuAnchor.project.id);
      setProjects((prev) => prev.filter((p) => p.id !== menuAnchor.project.id));
    } catch (err: any) {
      setError(err.message);
    }
    handleMenuClose();
  };

  const filteredProjects = projects
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Create Section */}
      <Box sx={{ 
        borderBottom: `1px solid ${borderColor}`,
        bgcolor: mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
      }}>
        <Box sx={{ maxWidth: 900, mx: 'auto', px: 3, py: 3 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', fontSize: 11 }}>
            Start a new document
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {TEMPLATES.map((template) => {
              const Icon = template.icon;
              return (
                <Tooltip key={template.id} title={template.label} arrow>
                  <Box
                    onClick={() => handleCreateFromTemplate(template.id)}
                    sx={{
                      width: 72,
                      height: 88,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.5,
                      cursor: 'pointer',
                      bgcolor: 'background.paper',
                      transition: 'all 0.15s',
                      '&:hover': { 
                        borderColor: 'primary.main',
                        bgcolor: hoverBg,
                      },
                    }}
                  >
                    <Icon sx={{ fontSize: 24, color: template.id === 'blank' ? 'primary.main' : 'text.secondary' }} />
                    <Typography variant="caption" sx={{ fontSize: 10 }}>
                      {template.label}
                    </Typography>
                  </Box>
                </Tooltip>
              );
            })}
            
            {/* Upload Box */}
            <Box
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => !file && document.getElementById('file-input')?.click()}
              sx={{
                width: 72,
                height: 88,
                border: `1px dashed ${dragActive ? 'primary.main' : borderColor}`,
                borderRadius: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.5,
                cursor: 'pointer',
                bgcolor: dragActive ? hoverBg : 'transparent',
                transition: 'all 0.15s',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <input
                id="file-input"
                type="file"
                accept=".doc,.docx"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <CloudUpload sx={{ fontSize: 24, color: 'text.disabled' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                Upload
              </Typography>
            </Box>
          </Box>

          {/* File selected */}
          {file && (
            <Box sx={{ 
              mt: 2, 
              p: 1.5, 
              border: `1px solid ${borderColor}`,
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              bgcolor: 'background.paper',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Description sx={{ fontSize: 18, color: 'primary.main' }} />
                <Typography variant="body2" sx={{ fontSize: 12 }}>{file.name}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button 
                  size="small" 
                  variant="contained" 
                  onClick={handleUpload}
                  disabled={uploading}
                  sx={{ fontSize: 11, py: 0.5 }}
                >
                  Convert
                </Button>
                <IconButton size="small" onClick={() => setFile(null)} sx={{ p: 0.25 }}>
                  <Close sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            </Box>
          )}

          {uploading && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress variant="determinate" value={uploadProgress} sx={{ height: 2 }} />
            </Box>
          )}
        </Box>
      </Box>

      {/* Documents Section */}
      <Box sx={{ maxWidth: 900, mx: 'auto', px: 3, py: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2, py: 0.5, fontSize: 12 }}>{error}</Alert>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            Recent documents
          </Typography>
          <TextField
            size="small"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ 
              width: 180,
              '& .MuiInputBase-root': { fontSize: 12, height: 32 },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 16, color: 'text.disabled' }} />
                </InputAdornment>
              ),
            }}
          />
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="rounded" height={44} />
            ))}
          </Box>
        ) : filteredProjects.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Description sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
              {search ? 'No documents found' : 'No documents yet'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {filteredProjects.map((project) => (
              <Box
                key={project.id}
                onClick={() => navigate(`/editor/${project.id}`)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 1.5,
                  py: 1,
                  borderRadius: 0.5,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                  '&:hover': { bgcolor: hoverBg },
                  '&:hover .actions': { opacity: 1 },
                }}
              >
                <Description sx={{ fontSize: 18, color: 'primary.main', opacity: 0.8 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontSize: 13 }} noWrap>
                    {project.name}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, minWidth: 60 }}>
                  {formatDate(project.updatedAt)}
                </Typography>
                <IconButton
                  className="actions"
                  size="small"
                  onClick={(e) => handleMenuOpen(e, project)}
                  sx={{ opacity: 0, transition: 'opacity 0.1s', p: 0.5 }}
                >
                  <MoreVert sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        PaperProps={{ sx: { minWidth: 140 } }}
      >
        <MenuItem onClick={() => { navigate(`/editor/${menuAnchor?.project.id}`); handleMenuClose(); }} sx={{ fontSize: 13 }}>
          <Edit sx={{ mr: 1.5, fontSize: 16 }} /> Open
        </MenuItem>
        <MenuItem onClick={handleDuplicate} sx={{ fontSize: 13 }}>
          <ContentCopy sx={{ mr: 1.5, fontSize: 16 }} /> Duplicate
        </MenuItem>
        <MenuItem onClick={() => { window.open(`/api/download-pdf/${menuAnchor?.project.id}`); handleMenuClose(); }} sx={{ fontSize: 13 }}>
          <Download sx={{ mr: 1.5, fontSize: 16 }} /> Download
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ fontSize: 13, color: 'error.main' }}>
          <Delete sx={{ mr: 1.5, fontSize: 16 }} /> Delete
        </MenuItem>
      </Menu>
    </Box>
  );
}
