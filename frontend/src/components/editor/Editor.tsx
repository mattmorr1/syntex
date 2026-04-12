import { useState, useEffect, useCallback, useRef } from 'react';
import SyntexLogo from '../common/SyntexLogo';
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
  Chat,
  ZoomIn,
  ZoomOut,
  Delete,
  MoreVert,
  Settings,
  ChevronLeft,
  ChevronRight,
} from '@mui/icons-material';
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels';
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
  const { aiModel } = useSettingsStore();
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
    setUpdatedAt,
    addFile,
    removeFile,
  } = useEditorStore();

  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
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
  const filePanelRef = useRef<ImperativePanelHandle>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentProjectRef = useRef(currentProject);
  currentProjectRef.current = currentProject;
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null);

  const isDark = mode === 'dark';
  const purpleBorder = isDark ? '#262626' : '#e4e4e7';
  const accentBorder = isDark ? '#2d2d2d' : '#e4e4e7';
  const surfaceBg = isDark ? '#121212' : '#ffffff';
  const editorBg = isDark ? '#0a0a0a' : '#fafafa';
  const pdfBg = isDark ? '#525659' : '#e4e4e7';

  useEffect(() => {
    if (projectId) loadProject(projectId);
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
      const result = await api.saveProject(currentProject.id, currentProject.files);
      setUnsavedChanges(false);
      if (result?.updated_at) setUpdatedAt(result.updated_at);
      setSnackbar({ open: true, message: 'Saved', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  }, [currentProject, setUnsavedChanges, setUpdatedAt]);

  const handleCompile = useCallback(async () => {
    if (!currentProject) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const result = await api.compile(currentProject.id, currentProject.mainFile, currentProject.files);
      if (result.pdf_url) setPdfUrl(result.pdf_url);
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

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleTitleSave();
    else if (e.key === 'Escape') {
      setTitleValue(currentProject?.name || '');
      setEditingTitle(false);
    }
  };

  const toggleSidebar = () => {
    if (sidebarCollapsed) {
      filePanelRef.current?.expand();
    } else {
      filePanelRef.current?.collapse();
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

  useEffect(() => {
    if (!unsavedChanges) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const proj = currentProjectRef.current;
      if (!proj) return;
      try {
        const result = await api.saveProject(proj.id, proj.files);
        setUnsavedChanges(false);
        if (result?.updated_at) setUpdatedAt(result.updated_at);
      } catch {
        // silent
      }
    }, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [activeFileContent, unsavedChanges]);

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
        width: '3px', height: '32px', borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.08)',
        transition: 'background 0.15s',
        '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' },
      }} />
    </PanelResizeHandle>
  );

  const titleText = currentProject?.name || 'Untitled Document';

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
        minWidth: 0,
      }}>
        {/* Left: Logo + title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, overflow: 'hidden' }}>
          {/* Logo → home */}
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', flexShrink: 0, '&:hover': { opacity: 0.75 } }}
            onClick={() => navigate('/')}
          >
            <SyntexLogo size="sm" />
            <Typography sx={{ fontWeight: 600, fontSize: 12, letterSpacing: '-0.01em' }}>
              syntex
            </Typography>
          </Box>

          {/* Separator */}
          <Box sx={{ width: '1px', height: '16px', bgcolor: accentBorder, flexShrink: 0 }} />

          {/* Editable title */}
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={handleTitleKeyDown}
              style={{
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'inherit',
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${accentBorder}`,
                outline: 'none',
                color: 'inherit',
                padding: '0 2px',
                lineHeight: '20px',
                width: `${Math.max(80, titleValue.length * 7.5)}px`,
                maxWidth: 220,
              }}
            />
          ) : (
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'text', minWidth: 0, overflow: 'hidden' }}
              onClick={() => { setTitleValue(titleText); setEditingTitle(true); }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {titleText}{unsavedChanges ? <span style={{ opacity: 0.4 }}> *</span> : null}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Right: actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 1 }}>
          <Tooltip title="Compile (Ctrl+B)">
            <Box
              component="button"
              onClick={handleCompile}
              disabled={isCompiling}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.5, py: 0.5, borderRadius: '8px',
                bgcolor: 'primary.main', color: '#000', border: 'none',
                cursor: 'pointer', fontSize: 11, fontWeight: 500, fontFamily: 'inherit',
                transition: 'opacity 0.15s',
                '&:hover': { opacity: 0.85 },
                '&:disabled': { opacity: 0.5 },
              }}
            >
              {isCompiling ? <CircularProgress size={12} sx={{ color: '#000' }} /> : <PlayArrow sx={{ fontSize: 14 }} />}
              Compile
            </Box>
          </Tooltip>

          <Tooltip title="Save (Ctrl+S)">
            <IconButton size="small" onClick={handleSave} disabled={!unsavedChanges} sx={{ p: 0.5 }}>
              <Save sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Download PDF">
            <IconButton size="small" onClick={() => window.open(`/download-pdf/${projectId}`)} disabled={!pdfUrl} sx={{ p: 0.5 }}>
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
        <PanelGroup direction="horizontal" style={{ height: '100%' }}>

          {/* File Sidebar — always present, collapsible */}
          <Panel
            ref={filePanelRef}
            defaultSize={14}
            minSize={10}
            maxSize={28}
            collapsible
            collapsedSize={3}
            onCollapse={() => setSidebarCollapsed(true)}
            onExpand={() => setSidebarCollapsed(false)}
          >
            <Box sx={{
              height: '100%',
              bgcolor: surfaceBg,
              border: `1px solid ${purpleBorder}`,
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              {/* Sidebar header */}
              <Box sx={{
                px: sidebarCollapsed ? 0.5 : 1.5,
                py: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: sidebarCollapsed ? 'center' : 'space-between',
                borderBottom: `1px solid ${accentBorder}`,
                flexShrink: 0,
              }}>
                {!sidebarCollapsed && (
                  <Typography sx={{ fontSize: 10, color: 'text.secondary', fontWeight: 500, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    Files
                  </Typography>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  {!sidebarCollapsed && (
                    <IconButton size="small" onClick={(e: React.MouseEvent<HTMLButtonElement>) => setAddMenuAnchor(e.currentTarget)} sx={{ p: 0.25 }}>
                      <Add sx={{ fontSize: 14 }} />
                    </IconButton>
                  )}
                  <Tooltip title={sidebarCollapsed ? 'Expand files' : 'Collapse files'} placement="right">
                    <IconButton size="small" onClick={toggleSidebar} sx={{ p: 0.25 }}>
                      {sidebarCollapsed
                        ? <ChevronRight sx={{ fontSize: 14 }} />
                        : <ChevronLeft sx={{ fontSize: 14 }} />}
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* File list — hidden when collapsed */}
              {!sidebarCollapsed && (
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
              )}
            </Box>

            <Menu anchorEl={addMenuAnchor} open={Boolean(addMenuAnchor)} onClose={() => setAddMenuAnchor(null)}>
              <MenuItem onClick={() => handleAddFile('tex')} sx={{ fontSize: 12 }}>LaTeX (.tex)</MenuItem>
              <MenuItem onClick={() => handleAddFile('bib')} sx={{ fontSize: 12 }}>Bibliography (.bib)</MenuItem>
              <MenuItem onClick={() => handleAddFile('cls')} sx={{ fontSize: 12 }}>Class (.cls)</MenuItem>
            </Menu>

            <Menu anchorEl={fileMenuAnchor?.el} open={Boolean(fileMenuAnchor)} onClose={() => setFileMenuAnchor(null)}>
              <MenuItem
                onClick={() => fileMenuAnchor && handleDeleteFile(fileMenuAnchor.fileName)}
                sx={{ fontSize: 12, color: 'error.main' }}
              >
                <Delete sx={{ mr: 1, fontSize: 14 }} />
                Delete
              </MenuItem>
            </Menu>
          </Panel>

          {resizeHandle}

          {/* Code Editor */}
          <Panel defaultSize={aiPanelOpen ? 30 : 40} minSize={20}>
            <Box sx={{
              height: '100%',
              bgcolor: surfaceBg,
              border: `1px solid ${purpleBorder}`,
              borderRadius: '12px',
              overflow: 'hidden',
            }}>
              <Box sx={{ height: '100%', overflow: 'hidden', bgcolor: editorBg }}>
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

          {/* PDF Preview */}
          <Panel defaultSize={aiPanelOpen ? 36 : 46} minSize={25}>
            <Box sx={{
              height: '100%',
              border: `1px solid ${purpleBorder}`,
              borderRadius: '12px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: `1px solid ${accentBorder}`,
                bgcolor: surfaceBg, height: 36, px: 1, flexShrink: 0,
              }}>
                <Typography sx={{ fontSize: 11, fontWeight: 500, ml: 0.5 }}>output.pdf</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  <IconButton size="small" onClick={() => setZoom((z) => Math.max(50, z - 10))} sx={{ p: 0.5 }}>
                    <ZoomOut sx={{ fontSize: 14 }} />
                  </IconButton>
                  <Typography sx={{ fontSize: 10, minWidth: 28, textAlign: 'center', fontFamily: 'monospace' }}>{zoom}%</Typography>
                  <IconButton size="small" onClick={() => setZoom((z) => Math.min(200, z + 10))} sx={{ p: 0.5 }}>
                    <ZoomIn sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              </Box>

              <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: pdfBg }}>
                {compileError ? (
                  <Alert severity="error" sx={{ m: 1, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, '& .MuiAlert-message': { width: '100%' } }}>
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
              <Panel defaultSize={20} minSize={16} maxSize={40}>
                <AgentPanel
                  projectId={currentProject?.id || ''}
                  document={activeFileContent}
                  selection={editorSelection}
                  onApplyChanges={(newContent) => {
                    if (activeFile) updateFileContent(activeFile, newContent);
                  }}
                  onClose={() => setAiPanelOpen(false)}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      </Box>

      {/* Floating AI button — only visible when panel is closed */}
      {!aiPanelOpen && (
        <Tooltip title={`AI Assistant${aiModel === 'pro' ? ' (Pro)' : ' (Flash)'}`} placement="left">
          <Box
            onClick={() => setAiPanelOpen(true)}
            sx={{
              position: 'fixed',
              bottom: 30,
              right: 30,
              width: 40,
              height: 40,
              borderRadius: '50%',
              bgcolor: surfaceBg,
              border: `1px solid ${purpleBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              transition: 'all 0.15s',
              zIndex: 200,
              '&:hover': {
                bgcolor: 'primary.main',
                borderColor: 'primary.main',
                '& .chat-icon': { color: '#fff' },
              },
            }}
          >
            <Chat className="chat-icon" sx={{ fontSize: 18, color: 'text.secondary', transition: 'color 0.15s' }} />
          </Box>
        </Tooltip>
      )}

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
