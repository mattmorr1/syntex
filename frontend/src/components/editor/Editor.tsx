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
  Avatar,
} from '@mui/material';
import {
  Save,
  PlayArrow,
  Add,
  Description,
  Code,
  MenuBook,
  Download,
  Home,
  Chat,
  ZoomIn,
  ZoomOut,
  Check,
  Close,
  Edit,
  Delete,
  MoreVert,
  Settings,
} from '@mui/icons-material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useThemeStore } from '../../store/themeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useEditorStore } from '../../store/editorStore';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';
import { MonacoEditor, EditorSelection } from './MonacoEditor';
import { AgentPanel } from '../ai/AgentPanel';
import { PdfViewer } from './PdfViewer';

const FILE_ICONS: Record<string, React.ReactNode> = {
  tex: <Description fontSize="small" />,
  bib: <MenuBook fontSize="small" />,
  cls: <Code fontSize="small" />,
  sty: <Code fontSize="small" />,
};

export function Editor() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { mode } = useThemeStore();
  const { aiModel, toggleAiModel } = useSettingsStore();
  const { user } = useAuth();
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
    removeFile,
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
  const [fileMenuAnchor, setFileMenuAnchor] = useState<{ el: HTMLElement; fileName: string } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null);

  const isDark = mode === 'dark';
  const purpleBorder = isDark ? '#4c1d95' : '#ddd6fe';
  const accentBorder = isDark ? '#3f3f46' : '#e4e4e7';
  const surfaceBg = isDark ? '#18181b' : '#ffffff';
  const surfaceActive = isDark ? '#27272a' : '#f4f4f5';
  const editorBg = isDark ? '#0e0e11' : '#fafafa';
  const pdfBg = isDark ? '#525659' : '#e4e4e7';

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
      navigate('/');
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
    const names: Record<string, string> = { tex: 'newfile.tex', bib: 'references.bib', cls: 'custom.cls' };
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

  const handleDeleteFile = (fileName: string) => {
    if (fileName === currentProject?.mainFile) {
      setSnackbar({ open: true, message: 'Cannot delete main file', severity: 'error' });
      return;
    }
    if (currentProject && currentProject.files.length <= 1) {
      setSnackbar({ open: true, message: 'Cannot delete last file', severity: 'error' });
      return;
    }
    if (!confirm(`Delete ${fileName}?`)) return;
    removeFile(fileName);
    setFileMenuAnchor(null);
    setSnackbar({ open: true, message: 'File deleted', severity: 'success' });
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
    if (e.key === 'Enter') handleTitleSave();
    else if (e.key === 'Escape') {
      setTitleValue(currentProject?.name || '');
      setEditingTitle(false);
    }
  };

  const activeFileContent = currentProject?.files.find((f: { name: string }) => f.name === activeFile)?.content || '';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); handleCompile(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleCompile]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: 'background.default' }}>
        <CircularProgress size={24} sx={{ color: 'primary.main' }} />
      </Box>
    );
  }

  const resizeHandle = (
    <PanelResizeHandle style={{ width: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'col-resize' }}>
      <Box sx={{
        width: 3, height: 32, borderRadius: 2,
        bgcolor: `${purpleBorder}80`,
        transition: 'background 0.15s',
        '&:hover': { bgcolor: 'primary.main' },
      }} />
    </PanelResizeHandle>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      {/* Top Header */}
      <Box sx={{
        height: 40,
        bgcolor: 'background.default',
        borderBottom: `1px solid ${purpleBorder}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.5,
        flexShrink: 0,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <img src="/syntex.svg" alt="syntex" style={{ width: 18, height: 18 }} />
            <Typography sx={{ fontWeight: 600, fontSize: 12, letterSpacing: '-0.01em' }}>
              syntex
            </Typography>
          </Box>

          <Box sx={{ width: 1, height: 16, bgcolor: accentBorder }} />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11 }}>
            <Typography
              sx={{ fontSize: 11, color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'text.primary' } }}
              onClick={() => navigate('/')}
            >
              {currentProject?.name}
            </Typography>
            <Typography sx={{ fontSize: 11, color: accentBorder }}>/</Typography>
            {editingTitle ? (
              <TextField
                inputRef={titleInputRef}
                value={titleValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitleValue(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                size="small"
                variant="standard"
                sx={{ '& input': { fontSize: 11, py: 0, fontWeight: 500 }, maxWidth: 200 }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={handleTitleSave} sx={{ p: 0.25 }}>
                        <Check sx={{ fontSize: 12 }} />
                      </IconButton>
                      <IconButton size="small" onClick={() => { setTitleValue(currentProject?.name || ''); setEditingTitle(false); }} sx={{ p: 0.25 }}>
                        <Close sx={{ fontSize: 12 }} />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            ) : (
              <Box
                sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', '&:hover .edit-icon': { opacity: 1 } }}
                onClick={() => { setTitleValue(currentProject?.name || ''); setEditingTitle(true); }}
              >
                <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                  {activeFile || 'main.tex'}
                  {unsavedChanges && <span style={{ opacity: 0.4 }}> *</span>}
                </Typography>
                <Edit className="edit-icon" sx={{ fontSize: 10, ml: 0.5, opacity: 0, transition: 'opacity 0.15s' }} />
              </Box>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Compile (Ctrl+B)">
            <Box
              component="button"
              onClick={handleCompile}
              disabled={isCompiling}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.5, py: 0.5, borderRadius: '8px',
                bgcolor: 'primary.main', color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: 11, fontWeight: 500, fontFamily: 'inherit',
                transition: 'background 0.15s',
                '&:hover': { bgcolor: 'primary.dark' },
                '&:disabled': { opacity: 0.5 },
              }}
            >
              {isCompiling ? <CircularProgress size={12} sx={{ color: '#fff' }} /> : <PlayArrow sx={{ fontSize: 14 }} />}
              Compile
            </Box>
          </Tooltip>

          <Tooltip title="Save (Ctrl+S)">
            <IconButton size="small" onClick={handleSave} disabled={!unsavedChanges} sx={{ p: 0.5 }}>
              <Save sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Download PDF">
            <IconButton
              size="small"
              onClick={() => window.open(`/download-pdf/${projectId}`)}
              disabled={!pdfUrl}
              sx={{ p: 0.5 }}
            >
              <Download sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Settings">
            <IconButton size="small" onClick={() => navigate('/settings')} sx={{ p: 0.5 }}>
              <Settings sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          <Avatar
            sx={{ width: 24, height: 24, fontSize: 10, fontWeight: 700, bgcolor: 'primary.main', ml: 0.5, cursor: 'pointer' }}
            onClick={() => navigate('/settings')}
          >
            {user?.username?.[0]?.toUpperCase() ?? 'U'}
          </Avatar>
        </Box>
      </Box>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', p: 1, gap: 1, bgcolor: 'background.default' }}>
        {/* Icon Sidebar — fixed width */}
        <Box sx={{
          width: 48,
          bgcolor: surfaceBg,
          border: `1px solid ${purpleBorder}`,
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          py: 1.5,
          gap: 1,
          flexShrink: 0,
        }}>
          <Tooltip title="Files" placement="right">
            <IconButton
              size="small"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              sx={{ p: 1, color: sidebarOpen ? 'primary.main' : 'text.secondary' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>folder_open</span>
            </IconButton>
          </Tooltip>
          <Tooltip title="Home" placement="right">
            <IconButton size="small" onClick={() => navigate('/')} sx={{ p: 1, color: 'text.secondary' }}>
              <Home sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Settings" placement="right">
            <IconButton size="small" onClick={() => navigate('/settings')} sx={{ p: 1, color: 'text.secondary' }}>
              <Settings sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Box sx={{ width: 32, height: 1, bgcolor: accentBorder, my: 0.5 }} />
          <Tooltip title="AI Chat" placement="right">
            <IconButton
              size="small"
              onClick={() => setAiPanelOpen(!aiPanelOpen)}
              sx={{ p: 1, color: aiPanelOpen ? 'primary.main' : 'text.secondary' }}
            >
              <Chat sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={`Model: ${aiModel === 'pro' ? 'Pro' : 'Flash'} (click to toggle)`} placement="right">
            <Box
              onClick={toggleAiModel}
              sx={{
                fontSize: 9, fontWeight: 700, cursor: 'pointer',
                color: aiModel === 'pro' ? 'primary.main' : 'text.secondary',
                textTransform: 'uppercase', letterSpacing: 0.5, userSelect: 'none',
              }}
            >
              {aiModel}
            </Box>
          </Tooltip>
        </Box>

        {/* Resizable panel group: file sidebar + editor + pdf + AI */}
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <PanelGroup direction="horizontal" style={{ height: '100%' }}>
            {/* File Sidebar Panel */}
            {sidebarOpen && (
              <>
                <Panel defaultSize={14} minSize={8} maxSize={28}>
                  <Box sx={{
                    height: '100%',
                    bgcolor: surfaceBg,
                    border: `1px solid ${purpleBorder}`,
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}>
                    <Box sx={{
                      px: 1.5, py: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      borderBottom: `1px solid ${accentBorder}`,
                    }}>
                      <Typography sx={{ fontSize: 10, color: 'text.secondary', fontWeight: 500, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        Files
                      </Typography>
                      <IconButton size="small" onClick={(e: React.MouseEvent<HTMLButtonElement>) => setAddMenuAnchor(e.currentTarget)} sx={{ p: 0.25 }}>
                        <Add sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>

                    <List dense sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
                      {currentProject?.files.map((file: { name: string; type: string }) => (
                        <ListItem
                          key={file.name}
                          disablePadding
                          sx={{ px: 0.5, '&:hover .file-actions': { opacity: 1 } }}
                          secondaryAction={
                            <IconButton
                              className="file-actions"
                              size="small"
                              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                                e.stopPropagation();
                                setFileMenuAnchor({ el: e.currentTarget, fileName: file.name });
                              }}
                              sx={{ opacity: 0, transition: 'opacity 0.15s', p: 0.25 }}
                            >
                              <MoreVert sx={{ fontSize: 14 }} />
                            </IconButton>
                          }
                        >
                          <ListItemButton
                            selected={activeFile === file.name}
                            onClick={() => setActiveFile(file.name)}
                            sx={{ borderRadius: '4px', py: 0.25, minHeight: 28, pr: 4 }}
                          >
                            <ListItemIcon sx={{ minWidth: 22 }}>
                              {FILE_ICONS[file.type] || <Description fontSize="small" />}
                            </ListItemIcon>
                            <ListItemText
                              primary={file.name}
                              primaryTypographyProps={{
                                variant: 'caption',
                                noWrap: true,
                                fontWeight: file.name === currentProject.mainFile ? 600 : 400,
                                fontSize: 11,
                              }}
                            />
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>

                    <Menu anchorEl={addMenuAnchor} open={Boolean(addMenuAnchor)} onClose={() => setAddMenuAnchor(null)}>
                      <MenuItem onClick={() => handleAddFile('tex')} sx={{ fontSize: 12 }}>LaTeX (.tex)</MenuItem>
                      <MenuItem onClick={() => handleAddFile('bib')} sx={{ fontSize: 12 }}>Bibliography (.bib)</MenuItem>
                      <MenuItem onClick={() => handleAddFile('cls')} sx={{ fontSize: 12 }}>Class (.cls)</MenuItem>
                    </Menu>

                    <Menu
                      anchorEl={fileMenuAnchor?.el}
                      open={Boolean(fileMenuAnchor)}
                      onClose={() => setFileMenuAnchor(null)}
                    >
                      <MenuItem
                        onClick={() => fileMenuAnchor && handleDeleteFile(fileMenuAnchor.fileName)}
                        sx={{ fontSize: 12, color: 'error.main' }}
                      >
                        <Delete sx={{ mr: 1, fontSize: 14 }} />
                        Delete
                      </MenuItem>
                    </Menu>
                  </Box>
                </Panel>
                {resizeHandle}
              </>
            )}

            {/* Code Editor Panel */}
            <Panel defaultSize={sidebarOpen ? (aiPanelOpen ? 37 : 47) : (aiPanelOpen ? 45 : 60)} minSize={20}>
              <Box sx={{
                height: '100%',
                bgcolor: surfaceBg,
                border: `1px solid ${purpleBorder}`,
                borderRadius: '12px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}>
                {/* Editor tabs */}
                <Box sx={{
                  display: 'flex', alignItems: 'center',
                  borderBottom: `1px solid ${accentBorder}`,
                  height: 36, flexShrink: 0, overflowX: 'auto',
                }}>
                  {currentProject?.files.map((file: { name: string }) => (
                    <Box
                      key={file.name}
                      onClick={() => setActiveFile(file.name)}
                      sx={{
                        px: 1.5, height: '100%',
                        display: 'flex', alignItems: 'center', gap: 0.75,
                        cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
                        borderRight: `1px solid ${accentBorder}`,
                        bgcolor: activeFile === file.name ? surfaceActive : 'transparent',
                        borderTop: activeFile === file.name ? '2px solid' : '2px solid transparent',
                        borderTopColor: activeFile === file.name ? 'primary.main' : 'transparent',
                        color: activeFile === file.name ? 'text.primary' : 'text.secondary',
                        fontWeight: activeFile === file.name ? 500 : 400,
                        transition: 'all 0.1s',
                        '&:hover': { bgcolor: surfaceActive },
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14, color: activeFile === file.name ? '#7c3aed' : undefined }}>description</span>
                      {file.name}
                    </Box>
                  ))}
                </Box>

                <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: editorBg }}>
                  {activeFile && (
                    <MonacoEditor
                      value={activeFileContent}
                      onChange={(value) => updateFileContent(activeFile, value || '')}
                      fileName={activeFile}
                      projectId={currentProject?.id || ''}
                      onSelectionChange={setEditorSelection}
                    />
                  )}
                </Box>
              </Box>
            </Panel>

            {resizeHandle}

            {/* PDF Preview Panel */}
            <Panel defaultSize={aiPanelOpen ? 30 : 40} minSize={18}>
              <Box sx={{
                height: '100%',
                border: `1px solid ${purpleBorder}`,
                borderRadius: '12px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}>
                {/* PDF toolbar */}
                <Box sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderBottom: `1px solid ${accentBorder}`,
                  bgcolor: surfaceBg, height: 36, px: 1, flexShrink: 0,
                }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 500, ml: 0.5 }}>output.pdf</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <IconButton size="small" onClick={() => setZoom((z: number) => Math.max(50, z - 10))} sx={{ p: 0.5 }}>
                      <ZoomOut sx={{ fontSize: 14 }} />
                    </IconButton>
                    <Typography sx={{ fontSize: 10, minWidth: 28, textAlign: 'center', fontFamily: 'monospace' }}>{zoom}%</Typography>
                    <IconButton size="small" onClick={() => setZoom((z: number) => Math.min(200, z + 10))} sx={{ p: 0.5 }}>
                      <ZoomIn sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                </Box>

                <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: pdfBg }}>
                  {compileError ? (
                    <Alert
                      severity="error"
                      sx={{ m: 1, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, '& .MuiAlert-message': { width: '100%' } }}
                    >
                      {compileError}
                    </Alert>
                  ) : pdfUrl ? (
                    <PdfViewer url={pdfUrl} zoom={zoom} />
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                        Press Ctrl+B to compile
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Panel>

            {/* AI Panel */}
            {aiPanelOpen && (
              <>
                {resizeHandle}
                <Panel defaultSize={22} minSize={18} maxSize={40}>
                  <AgentPanel
                    projectId={currentProject?.id || ''}
                    document={activeFileContent}
                    selection={editorSelection}
                    onApplyChanges={(newContent) => {
                      if (activeFile) updateFileContent(activeFile, newContent);
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
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ fontSize: 12 }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
