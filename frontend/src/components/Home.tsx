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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  Tabs,
  Tab,
  Chip,
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
  Settings,
  Image as ImageIcon,
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
  
  // Upload customization
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadTab, setUploadTab] = useState(0);
  const [uploadTheme, setUploadTheme] = useState('report');
  const [customPrompt, setCustomPrompt] = useState('');
  const [customCls, setCustomCls] = useState('');
  const [customPreamble, setCustomPreamble] = useState('');
  const [referenceImages, setReferenceImages] = useState<{ file: File; preview: string }[]>([]);
  
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
    if (droppedFile && (droppedFile.name.endsWith('.docx') || droppedFile.name.endsWith('.doc') || droppedFile.name.endsWith('.pdf'))) {
      setFile(droppedFile);
      setError('');
      setUploadDialogOpen(true);
    } else {
      setError('Please upload a .docx, .doc, or .pdf file');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
      setUploadDialogOpen(true);
    }
  };

  const handleCloseUploadDialog = () => {
    setUploadDialogOpen(false);
    setFile(null);
    setUploadTab(0);
    setUploadTheme('report');
    setCustomPrompt('');
    setCustomCls('');
    setCustomPreamble('');
    // Clean up image previews
    referenceImages.forEach(img => URL.revokeObjectURL(img.preview));
    setReferenceImages([]);
  };

  const handleAddReferenceImages = (files: FileList | null) => {
    if (!files) return;
    const newImages: { file: File; preview: string }[] = [];
    for (let i = 0; i < files.length && referenceImages.length + newImages.length < 10; i++) {
      const f = files[i];
      if (f.type.startsWith('image/')) {
        newImages.push({ file: f, preview: URL.createObjectURL(f) });
      }
    }
    if (newImages.length > 0) {
      setReferenceImages(prev => [...prev, ...newImages]);
    }
  };

  const handleRemoveReferenceImage = (index: number) => {
    setReferenceImages(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const fileToBase64 = (f: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(f);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
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
      // Convert reference images to base64
      const imageData: string[] = [];
      for (const img of referenceImages) {
        const base64 = await fileToBase64(img.file);
        imageData.push(base64);
      }

      const result = await api.uploadFile(file, uploadTheme, undefined, {
        customPrompt: customPrompt || undefined,
        customCls: customCls || undefined,
        customPreamble: customPreamble || undefined,
        images: imageData.length > 0 ? imageData : undefined,
      });
      setUploadProgress(100);
      clearInterval(progressInterval);
      handleCloseUploadDialog();
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
                accept=".doc,.docx,.pdf"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <CloudUpload sx={{ fontSize: 24, color: 'text.disabled' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                Upload
              </Typography>
            </Box>
          </Box>

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

      {/* Upload Customization Dialog */}
      <Dialog 
        open={uploadDialogOpen} 
        onClose={handleCloseUploadDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <Settings sx={{ fontSize: 20 }} />
          <Typography variant="h6" sx={{ fontSize: 16, flex: 1 }}>Convert Document</Typography>
          {file && (
            <Typography variant="caption" color="text.secondary">
              {file.name}
            </Typography>
          )}
        </DialogTitle>
        
        <DialogContent>
          {uploading && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress variant="determinate" value={uploadProgress} sx={{ height: 3, borderRadius: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Converting document...
              </Typography>
            </Box>
          )}
          
          {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>{error}</Alert>}
          
          <Tabs value={uploadTab} onChange={(_, v) => setUploadTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label="Template" sx={{ fontSize: 12 }} />
            <Tab label="AI Instructions" sx={{ fontSize: 12 }} />
            <Tab label="Reference Images" sx={{ fontSize: 12 }} icon={referenceImages.length > 0 ? <Chip size="small" label={referenceImages.length} sx={{ height: 16, fontSize: 10, ml: 0.5 }} /> : undefined} iconPosition="end" />
            <Tab label="Custom Class" sx={{ fontSize: 12 }} />
            <Tab label="Preamble" sx={{ fontSize: 12 }} />
          </Tabs>
          
          {/* Template Tab */}
          {uploadTab === 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
                Select a LaTeX template style for your converted document.
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel sx={{ fontSize: 13 }}>Template</InputLabel>
                <Select
                  value={uploadTheme}
                  label="Template"
                  onChange={(e) => setUploadTheme(e.target.value)}
                  sx={{ fontSize: 13 }}
                >
                  <MenuItem value="report" sx={{ fontSize: 13 }}>Report</MenuItem>
                  <MenuItem value="journal" sx={{ fontSize: 13 }}>Journal Article</MenuItem>
                  <MenuItem value="thesis" sx={{ fontSize: 13 }}>Thesis</MenuItem>
                  <MenuItem value="problem_set" sx={{ fontSize: 13 }}>Problem Set</MenuItem>
                  <MenuItem value="letter" sx={{ fontSize: 13 }}>Letter</MenuItem>
                </Select>
              </FormControl>
            </Box>
          )}
          
          {/* AI Instructions Tab */}
          {uploadTab === 1 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
                Provide custom instructions for the AI when converting your document.
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={8}
                placeholder="Example: Focus on mathematical notation. Use theorem environments for proofs. Include a table of contents. Preserve all code blocks with listings package..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                sx={{ '& textarea': { fontSize: 12, fontFamily: 'monospace' } }}
              />
            </Box>
          )}
          
          {/* Reference Images Tab */}
          {uploadTab === 2 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
                Add reference images (diagrams, screenshots, handwritten notes) to help the AI understand your document better.
              </Typography>
              
              <Box
                sx={{
                  border: '2px dashed',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 3,
                  textAlign: 'center',
                  cursor: 'pointer',
                  mb: 2,
                  '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                }}
                onClick={() => document.getElementById('reference-image-input')?.click()}
              >
                <input
                  id="reference-image-input"
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => handleAddReferenceImages(e.target.files)}
                />
                <ImageIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                  Click or drag images here (max 10)
                </Typography>
              </Box>
              
              {referenceImages.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {referenceImages.map((img, index) => (
                    <Box
                      key={index}
                      sx={{
                        position: 'relative',
                        width: 80,
                        height: 80,
                        borderRadius: 1,
                        overflow: 'hidden',
                        border: 1,
                        borderColor: 'divider',
                      }}
                    >
                      <img
                        src={img.preview}
                        alt={`Reference ${index + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveReferenceImage(index)}
                        sx={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          bgcolor: 'rgba(0,0,0,0.6)',
                          color: 'white',
                          p: 0.25,
                          '&:hover': { bgcolor: 'error.main' },
                        }}
                      >
                        <Close sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
          
          {/* Custom Class Tab */}
          {uploadTab === 3 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
                Paste custom document class (.cls) content. This will be included as a separate file.
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={8}
                placeholder="% Custom document class&#10;\NeedsTeXFormat{LaTeX2e}&#10;\ProvidesClass{myclass}[2024/01/01]&#10;..."
                value={customCls}
                onChange={(e) => setCustomCls(e.target.value)}
                sx={{ '& textarea': { fontSize: 11, fontFamily: 'monospace' } }}
              />
            </Box>
          )}
          
          {/* Preamble Tab */}
          {uploadTab === 4 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
                Add custom LaTeX preamble (packages, macros, settings) to be included in the document.
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={8}
                placeholder="% Custom packages&#10;\usepackage{tikz}&#10;\usepackage{algorithm2e}&#10;&#10;% Custom macros&#10;\newcommand{\R}{\mathbb{R}}&#10;..."
                value={customPreamble}
                onChange={(e) => setCustomPreamble(e.target.value)}
                sx={{ '& textarea': { fontSize: 11, fontFamily: 'monospace' } }}
              />
            </Box>
          )}
        </DialogContent>
        
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseUploadDialog} size="small" disabled={uploading}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleUpload}
            disabled={uploading}
            size="small"
          >
            {uploading ? 'Converting...' : 'Convert to LaTeX'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
