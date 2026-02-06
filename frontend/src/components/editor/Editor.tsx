import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  IconButton,
  Typography,
  Tooltip,
  CircularProgress,
  Snackbar,
  Alert,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  InputAdornment,
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
  Download,
  Home,
  Chat,
  ZoomIn,
  ZoomOut,
  Check,
  Close,
  Edit,
  Search,
} from '@mui/icons-material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useThemeStore } from '../../store/themeStore';
import { useEditorStore, ProjectFile } from '../../store/editorStore';
import { api } from '../../services/api';
import { MonacoEditor } from './MonacoEditor';
import { AgentPanel } from '../ai/AgentPanel';
import { PdfViewer, PdfViewerHandle } from './PdfViewer';

const FILE_ICONS: Record<string, React.ReactNode> = {
  tex: <Description fontSize="small" />,
  bib: <MenuBook fontSize="small" />,
  cls: <Code fontSize="small" />,
  sty: <Code fontSize="small" />,
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
    setProjectName,
    setPdfUrl,
    setCompiling,
    setCompileError,
    setUnsavedChanges,
    addFile,
  } = useEditorStore();

  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [zoom, setZoom] = useState(100);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const pdfViewerRef = useRef<import('./PdfViewer').PdfViewerHandle>(null);

  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

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
      setTitleValue(project.name);
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
      setSnackbar({ open: true, message: 'Saved', severity: 'success' });
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

  const handleTitleSave = async () => {
    if (!currentProject || !titleValue.trim()) {
      setTitleValue(currentProject?.name || '');
      setEditingTitle(false);
      return;
    }
    
    try {
      await api.renameProject(currentProject.id, titleValue.trim());
      setProjectName(titleValue.trim());
      setEditingTitle(false);
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setTitleValue(currentProject?.name || '');
      setEditingTitle(false);
    }
  };

  const activeFileContent = currentProject?.files.find(f => f.name === activeFile)?.content || '';

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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: 'background.default' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const borderColor = mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
      {/* File Sidebar */}
      {sidebarOpen && (
        <Box sx={{ 
          width: 200, 
          borderRight: `1px solid ${borderColor}`,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
        }}>
          <Box sx={{ 
            px: 1.5, 
            py: 1,
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            borderBottom: `1px solid ${borderColor}`,
          }}>
            <Typography variant="caption" color="text.secondary" fontWeight={500} letterSpacing={0.5}>
              FILES
            </Typography>
            <IconButton size="small" onClick={(e) => setAddMenuAnchor(e.currentTarget)} sx={{ p: 0.25 }}>
              <Add sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          
          <List dense sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
            {currentProject?.files.map((file) => (
              <ListItem key={file.name} disablePadding sx={{ px: 0.5 }}>
                <ListItemButton
                  selected={activeFile === file.name}
                  onClick={() => setActiveFile(file.name)}
                  sx={{ 
                    borderRadius: 0.5, 
                    py: 0.25,
                    minHeight: 28,
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 24 }}>
                    {FILE_ICONS[file.type] || <Description fontSize="small" />}
                  </ListItemIcon>
                  <ListItemText 
                    primary={file.name}
                    primaryTypographyProps={{ 
                      variant: 'caption',
                      noWrap: true,
                      fontWeight: file.name === currentProject.mainFile ? 600 : 400,
                      fontSize: 12,
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          
          <Menu anchorEl={addMenuAnchor} open={Boolean(addMenuAnchor)} onClose={() => setAddMenuAnchor(null)}>
            <MenuItem onClick={() => handleAddFile('tex')} sx={{ fontSize: 13 }}>LaTeX (.tex)</MenuItem>
            <MenuItem onClick={() => handleAddFile('bib')} sx={{ fontSize: 13 }}>Bibliography (.bib)</MenuItem>
            <MenuItem onClick={() => handleAddFile('cls')} sx={{ fontSize: 13 }}>Class (.cls)</MenuItem>
          </Menu>
        </Box>
      )}

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Compact Header */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 0.5, 
          px: 1,
          py: 0.5,
          borderBottom: `1px solid ${borderColor}`,
          bgcolor: 'background.paper',
          minHeight: 36,
        }}>
          <Tooltip title="Home">
            <IconButton size="small" onClick={() => navigate('/')} sx={{ p: 0.5 }}>
              <Home sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          
          <IconButton size="small" onClick={() => setSidebarOpen(!sidebarOpen)} sx={{ p: 0.5 }}>
            {sidebarOpen ? <ChevronLeft sx={{ fontSize: 18 }} /> : <ChevronRight sx={{ fontSize: 18 }} />}
          </IconButton>
          
          {/* Editable Title */}
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', ml: 1 }}>
            {editingTitle ? (
              <TextField
                inputRef={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                size="small"
                variant="standard"
                sx={{ 
                  '& input': { fontSize: 13, py: 0 },
                  maxWidth: 300,
                }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={handleTitleSave} sx={{ p: 0.25 }}>
                        <Check sx={{ fontSize: 14 }} />
                      </IconButton>
                      <IconButton size="small" onClick={() => { setTitleValue(currentProject?.name || ''); setEditingTitle(false); }} sx={{ p: 0.25 }}>
                        <Close sx={{ fontSize: 14 }} />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            ) : (
              <Box 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  '&:hover .edit-icon': { opacity: 1 },
                }}
                onClick={() => { setTitleValue(currentProject?.name || ''); setEditingTitle(true); }}
              >
                <Typography variant="body2" sx={{ fontSize: 13 }} noWrap>
                  {currentProject?.name}
                  {unsavedChanges && <span style={{ opacity: 0.5 }}> *</span>}
                </Typography>
                <Edit className="edit-icon" sx={{ fontSize: 12, ml: 0.5, opacity: 0, transition: 'opacity 0.2s' }} />
              </Box>
            )}
          </Box>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Tooltip title="Save (Ctrl+S)">
              <IconButton size="small" onClick={handleSave} disabled={!unsavedChanges} sx={{ p: 0.5 }}>
                <Save sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Compile (Ctrl+B)">
              <IconButton size="small" onClick={handleCompile} disabled={isCompiling} color="primary" sx={{ p: 0.5 }}>
                {isCompiling ? <CircularProgress size={16} /> : <PlayArrow sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Download PDF">
              <IconButton 
                size="small"
                onClick={() => window.open(`/api/download-pdf/${projectId}`)}
                disabled={!pdfUrl}
                sx={{ p: 0.5 }}
              >
                <Download sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            
            <Box sx={{ width: 1, height: 16, bgcolor: borderColor, mx: 0.5 }} />
            
            <Tooltip title="Zoom Out">
              <IconButton size="small" onClick={() => setZoom(z => Math.max(50, z - 10))} sx={{ p: 0.5 }}>
                <ZoomOut sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Typography variant="caption" sx={{ fontSize: 11, minWidth: 32, textAlign: 'center' }}>{zoom}%</Typography>
            <Tooltip title="Zoom In">
              <IconButton size="small" onClick={() => setZoom(z => Math.min(200, z + 10))} sx={{ p: 0.5 }}>
                <ZoomIn sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>

            <Tooltip title="Search PDF (Ctrl+F)">
              <IconButton
                size="small"
                onClick={() => pdfViewerRef.current?.openSearch()}
                disabled={!pdfUrl}
                sx={{ p: 0.5 }}
              >
                <Search sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>

            <Box sx={{ width: 1, height: 16, bgcolor: borderColor, mx: 0.5 }} />

            <Tooltip title="Toggle Theme">
              <IconButton size="small" onClick={toggleTheme} sx={{ p: 0.5 }}>
                {mode === 'dark' ? <LightMode sx={{ fontSize: 18 }} /> : <DarkMode sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="AI Chat">
              <IconButton 
                size="small" 
                onClick={() => setAiPanelOpen(!aiPanelOpen)} 
                color={aiPanelOpen ? 'primary' : 'default'}
                sx={{ p: 0.5 }}
              >
                <Chat sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Editor, Preview, AI Panel */}
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <PanelGroup direction="horizontal" style={{ height: '100%' }}>
            {/* Code Editor Panel */}
            <Panel defaultSize={aiPanelOpen ? 40 : 50} minSize={25}>
              <Box sx={{ height: '100%', overflow: 'hidden' }}>
                {activeFile && (
                  <MonacoEditor
                    value={activeFileContent}
                    onChange={(value) => updateFileContent(activeFile, value || '')}
                    fileName={activeFile}
                    projectId={currentProject?.id || ''}
                  />
                )}
              </Box>
            </Panel>

            <PanelResizeHandle style={{ width: 1, background: borderColor, cursor: 'col-resize' }} />

            {/* PDF Preview Panel */}
            <Panel defaultSize={aiPanelOpen ? 35 : 50} minSize={20}>
              <Box sx={{ 
                height: '100%', 
                overflow: 'auto',
                bgcolor: mode === 'dark' ? '#1e1e1e' : '#f0f0f0',
              }}>
                {compileError ? (
                  <Alert 
                    severity="error" 
                    sx={{ 
                      m: 1, 
                      whiteSpace: 'pre-wrap', 
                      fontFamily: 'monospace', 
                      fontSize: 11,
                      '& .MuiAlert-message': { width: '100%' }
                    }}
                  >
                    {compileError}
                  </Alert>
                ) : pdfUrl ? (
                  <PdfViewer ref={pdfViewerRef} url={pdfUrl} zoom={zoom} />
                ) : (
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    height: '100%',
                  }}>
                    <Typography variant="caption" color="text.secondary">
                      Press Ctrl+B to compile
                    </Typography>
                  </Box>
                )}
              </Box>
            </Panel>

            {/* AI Panel */}
            {aiPanelOpen && (
              <>
                <PanelResizeHandle style={{ width: 1, background: borderColor, cursor: 'col-resize' }} />
                <Panel defaultSize={25} minSize={20} maxSize={40}>
                  <AgentPanel 
                    projectId={currentProject?.id || ''}
                    document={activeFileContent}
                    onApplyChanges={(newContent) => {
                      if (activeFile) {
                        updateFileContent(activeFile, newContent);
                      }
                    }}
                  />
                </Panel>
              </>
            )}
          </PanelGroup>
        </Box>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={2000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ fontSize: 12 }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
