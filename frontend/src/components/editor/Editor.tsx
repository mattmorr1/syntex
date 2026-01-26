import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  IconButton,
  Typography,
  Tooltip,
  CircularProgress,
  Snackbar,
  Alert,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Button,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  Save,
  PlayArrow,
  DarkMode,
  LightMode,
  Add,
  Description,
  Code,
  MenuBook,
  ChevronLeft,
  ChevronRight,
  AutoFixHigh,
  ZoomIn,
  ZoomOut,
  Download,
  MoreVert,
} from '@mui/icons-material';
import { useThemeStore } from '../../store/themeStore';
import { useEditorStore, ProjectFile } from '../../store/editorStore';
import { api } from '../../services/api';
import { MonacoEditor } from './MonacoEditor';
import { AgentPanel } from '../ai/AgentPanel';
import { PdfViewer } from './PdfViewer';

const FILE_ICONS: Record<string, React.ReactNode> = {
  tex: <Description />,
  bib: <MenuBook />,
  cls: <Code />,
  sty: <Code />,
};

export function Editor() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { mode, toggleTheme } = useThemeStore();
  const {
    currentProject,
    activeFile,
    pdfUrl,
    isCompiling,
    compileError,
    unsavedChanges,
    setProject,
    setActiveFile,
    updateFileContent,
    setPdfUrl,
    setCompiling,
    setCompileError,
    setUnsavedChanges,
    addFile,
  } = useEditorStore();

  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [zoom, setZoom] = useState(100);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    }
  }, [projectId]);

  const loadProject = async (id: string) => {
    try {
      const project = await api.getProject(id);
      setProject({
        id: project.id,
        name: project.name,
        files: project.files,
        mainFile: project.main_file,
        theme: project.theme,
        customTheme: project.custom_theme,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
      navigate('/history');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!currentProject) return;
    
    try {
      await api.saveProject(currentProject.id, currentProject.files);
      setUnsavedChanges(false);
      setSnackbar({ open: true, message: 'Project saved', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  }, [currentProject, setUnsavedChanges]);

  const handleCompile = useCallback(async () => {
    if (!currentProject) return;
    
    setCompiling(true);
    setCompileError(null);
    
    try {
      const result = await api.compile(
        currentProject.id,
        currentProject.mainFile,
        currentProject.files
      );
      
      if (result.pdf_url) {
        setPdfUrl(result.pdf_url);
      }
    } catch (err: any) {
      setCompileError(err.message);
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setCompiling(false);
    }
  }, [currentProject, setCompiling, setCompileError, setPdfUrl]);

  const handleAddFile = (type: 'tex' | 'bib' | 'cls') => {
    const names: Record<string, string> = {
      tex: 'newfile.tex',
      bib: 'references.bib',
      cls: 'custom.cls',
    };
    
    const templates: Record<string, string> = {
      tex: '% New LaTeX file\n',
      bib: '% BibTeX references\n',
      cls: '% Custom class file\n\\ProvidesClass{custom}[2024/01/01]\n\\LoadClass{article}\n',
    };
    
    const name = prompt('File name:', names[type]);
    if (name) {
      addFile({ name, content: templates[type], type });
      setActiveFile(name);
    }
    setAddMenuAnchor(null);
  };

  const activeFileContent = currentProject?.files.find(f => f.name === activeFile)?.content || '';

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        handleCompile();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleCompile]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
      {/* File Sidebar */}
      <Drawer
        variant="persistent"
        open={sidebarOpen}
        sx={{
          width: sidebarOpen ? 240 : 0,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: 240,
            boxSizing: 'border-box',
            position: 'relative',
            border: 'none',
            bgcolor: 'background.paper',
          },
        }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle2" color="text.secondary">
            EXPLORER
          </Typography>
          <IconButton size="small" onClick={(e) => setAddMenuAnchor(e.currentTarget)}>
            <Add fontSize="small" />
          </IconButton>
        </Box>
        
        <List dense>
          {currentProject?.files.map((file) => (
            <ListItem key={file.name} disablePadding>
              <ListItemButton
                selected={activeFile === file.name}
                onClick={() => setActiveFile(file.name)}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  {FILE_ICONS[file.type] || <Description />}
                </ListItemIcon>
                <ListItemText 
                  primary={file.name}
                  primaryTypographyProps={{ 
                    variant: 'body2',
                    noWrap: true,
                    fontWeight: file.name === currentProject.mainFile ? 600 : 400
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        
        <Menu anchorEl={addMenuAnchor} open={Boolean(addMenuAnchor)} onClose={() => setAddMenuAnchor(null)}>
          <MenuItem onClick={() => handleAddFile('tex')}>LaTeX File (.tex)</MenuItem>
          <MenuItem onClick={() => handleAddFile('bib')}>Bibliography (.bib)</MenuItem>
          <MenuItem onClick={() => handleAddFile('cls')}>Class File (.cls)</MenuItem>
        </Menu>
      </Drawer>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1, 
          p: 1, 
          borderBottom: 1, 
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}>
          <IconButton onClick={() => setSidebarOpen(!sidebarOpen)} size="small">
            {sidebarOpen ? <ChevronLeft /> : <ChevronRight />}
          </IconButton>
          
          <Typography variant="body2" sx={{ flex: 1 }} noWrap>
            {currentProject?.name}
            {unsavedChanges && ' *'}
          </Typography>
          
          <Tooltip title="AI Agent (Ctrl+K)">
            <IconButton onClick={() => setAgentOpen(!agentOpen)} color={agentOpen ? 'primary' : 'default'}>
              <AutoFixHigh />
            </IconButton>
          </Tooltip>
          
          <Divider orientation="vertical" flexItem />
          
          <Tooltip title="Save (Ctrl+S)">
            <IconButton onClick={handleSave} disabled={!unsavedChanges}>
              <Save />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Compile (Ctrl+B)">
            <IconButton onClick={handleCompile} disabled={isCompiling} color="primary">
              {isCompiling ? <CircularProgress size={20} /> : <PlayArrow />}
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Download PDF">
            <IconButton 
              onClick={() => window.open(`/api/download-pdf/${projectId}`)}
              disabled={!pdfUrl}
            >
              <Download />
            </IconButton>
          </Tooltip>
          
          <Divider orientation="vertical" flexItem />
          
          <Tooltip title="Toggle theme">
            <IconButton onClick={toggleTheme}>
              {mode === 'dark' ? <LightMode /> : <DarkMode />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Editor & Preview */}
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Code Editor */}
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            {activeFile && (
              <MonacoEditor
                value={activeFileContent}
                onChange={(value) => updateFileContent(activeFile, value || '')}
                fileName={activeFile}
                projectId={currentProject?.id || ''}
              />
            )}
          </Box>

          {/* PDF Preview */}
          <Box sx={{ 
            width: '50%', 
            borderLeft: 1, 
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: mode === 'dark' ? '#1a1a1a' : '#f5f5f5'
          }}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              p: 1, 
              borderBottom: 1, 
              borderColor: 'divider',
              bgcolor: 'background.paper'
            }}>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                Preview
              </Typography>
              <IconButton size="small" onClick={() => setZoom(z => Math.max(50, z - 10))}>
                <ZoomOut fontSize="small" />
              </IconButton>
              <Typography variant="caption">{zoom}%</Typography>
              <IconButton size="small" onClick={() => setZoom(z => Math.min(200, z + 10))}>
                <ZoomIn fontSize="small" />
              </IconButton>
            </Box>
            
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
              {compileError ? (
                <Alert severity="error" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
                  {compileError}
                </Alert>
              ) : pdfUrl ? (
                <PdfViewer url={pdfUrl} zoom={zoom} />
              ) : (
                <Box sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  height: '100%',
                  color: 'text.secondary'
                }}>
                  <Typography>Click Compile to preview PDF</Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* AI Agent Panel */}
      <AgentPanel 
        open={agentOpen} 
        onClose={() => setAgentOpen(false)}
        projectId={currentProject?.id || ''}
        document={activeFileContent}
        onApplyChanges={(newContent) => {
          if (activeFile) {
            updateFileContent(activeFile, newContent);
          }
        }}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
      >
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
