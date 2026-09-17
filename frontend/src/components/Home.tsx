import { useState, useCallback, useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { useNavigate } from 'react-router-dom';
import { MissingImagesDialog } from './editor/MissingImagesDialog';
import { ConfirmDialog } from './common/ConfirmDialog';
import { ShareDialog } from './common/ShareDialog';
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
  List,
  ListItemButton,
  ListItemText,
} from '@mui/material';
import {
  Add,
  CloudUpload,
  Description,
  Article,
  Assignment,
  School,
  Mail,
  Close,
  Search,
  MoreVert,
  Edit,
  ContentCopy,
  Delete,
  Download,
  ChevronRight,
  FolderOutlined,
  PersonAdd,
} from '@mui/icons-material';
import { api } from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { ProjectSummary } from '../store/editorStore';

const ACCEPTED_UPLOADS = ['.pdf', '.docx', '.doc'];

const SHARED_GROUP = 'Shared with me';

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
  const { generationMaxTokens } = useSettingsStore();
  const [file, setFile] = useState<File | null>(null);
  const [clsFile, setClsFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [missingImagesDialog, setMissingImagesDialog] = useState<{ projectId: string; images: string[] } | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; project: ProjectSummary } | null>(null);
  const [shareProject, setShareProject] = useState<ProjectSummary | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [moveDialog, setMoveDialog] = useState<{ project: ProjectSummary } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ project: ProjectSummary } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const isDark = mode === 'dark';
  const purpleBorder = isDark ? '#262626' : '#e4e4e7';
  const accentBorder = isDark ? '#2d2d2d' : '#e4e4e7';
  const countBg = isDark ? '#1f1f22' : '#f0f0f1';
  const hoverBg = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)';
  const surfaceBg = isDark ? '#121212' : '#ffffff';

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      // api.getProjects already maps snake_case to camelCase; re-mapping here silently
      // dropped folder and sortOrder, so folders only survived until the next reload.
      setProjects(await api.getProjects(useAuthStore.getState().user?.uid));
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
    if (droppedFile && ACCEPTED_UPLOADS.some(ext => droppedFile.name.toLowerCase().endsWith(ext))) {
      setFile(droppedFile);
      setError('');
    } else {
      setError('Please upload a .pdf, .docx or .doc file');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    // Same check as the drop handler: browsing used to accept anything at all.
    if (!ACCEPTED_UPLOADS.some(ext => selectedFile.name.toLowerCase().endsWith(ext))) {
      setError('Please upload a .pdf, .docx or .doc file');
      return;
    }
    setFile(selectedFile);
    setError('');
  };

  const handleClsSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setClsFile(selected);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    setError('');

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 8, 90));
    }, 500);

    try {
      let clsContent: string | undefined;
      if (clsFile) {
        clsContent = await clsFile.text();
      }
      const result = await api.uploadFile(file, 'report', undefined, clsContent, generationMaxTokens);
      setUploadProgress(100);
      clearInterval(progressInterval);

      // Carried into the editor rather than shown here, which unmounts on navigate.
      const warning = result.truncated
        ? `Only the first ${Math.round(result.source_chars_used / 1000)}k characters of the source were converted.`
        : undefined;

      if (result.missing_images && result.missing_images.length > 0) {
        setMissingImagesDialog({ projectId: result.project_id, images: result.missing_images });
        setUploading(false);
      } else {
        navigate(`/editor/${result.project_id}`, warning ? { state: { warning } } : undefined);
      }
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

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, project: ProjectSummary) => {
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

  const handleDelete = () => {
    if (!menuAnchor) return;
    setDeleteDialog({ project: menuAnchor.project });
    handleMenuClose();
  };

  const handleConfirmDelete = async () => {
    const project = deleteDialog!.project;
    setDeleteDialog(null);
    try {
      await api.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredProjects = projects
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (new Date(b.updatedAt ?? 0).getTime() || 0) - (new Date(a.updatedAt ?? 0).getTime() || 0));

  // Group into folders. Explicit sort_order wins; ties and untouched projects fall back
  // to most-recent-first, which is what the list did before folders existed.
  const grouped = (() => {
    const byFolder = new Map<string, ProjectSummary[]>();
    for (const p of filteredProjects) {
      const key = p.shared ? SHARED_GROUP : (p.folder || '');
      const bucket = byFolder.get(key);
      if (bucket) bucket.push(p); else byFolder.set(key, [p]);
    }
    for (const list of byFolder.values()) {
      list.sort((a, b) => {
        const d = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        if (d !== 0) return d;
        return (new Date(b.updatedAt ?? 0).getTime() || 0) - (new Date(a.updatedAt ?? 0).getTime() || 0);
      });
    }
    // Root first, then folders alphabetically, with anything shared with me last.
    return [...byFolder.entries()].sort(([a], [b]) => {
      if (a === SHARED_GROUP) return 1;
      if (b === SHARED_GROUP) return -1;
      return a === '' ? -1 : b === '' ? 1 : a.localeCompare(b);
    });
  })();

  // Shared projects cannot be dragged into folders: placement is the owner's.
  const folderNames = [...new Set(projects.filter((p) => !p.shared)
    .map((p) => p.folder || '').filter(Boolean))].sort();

  const applyPlacement = async (id: string, placement: { folder?: string; sort_order?: number }) => {
    // Optimistic: the list reorders immediately, and reloads from the server on failure.
    setProjects((prev) => prev.map((p) => p.id === id ? {
      ...p,
      folder: placement.folder ?? p.folder,
      sortOrder: placement.sort_order ?? p.sortOrder,
    } : p));
    try {
      await api.setPlacement(id, placement);
    } catch (err: any) {
      setError(err.message || 'Could not move document');
      loadProjects();
    }
  };

  /** Drop `dragId` onto `targetId`: same folder, taking the target's slot. */
  const handleReorderDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const dragId = e.dataTransfer.getData('text/plain');
    setDragOverId(null);
    if (!dragId || dragId === targetId) return;
    const target = projects.find((p) => p.id === targetId);
    if (!target) return;

    const siblings = (grouped.find(([f]) => f === (target.folder || ''))?.[1] ?? [])
      .filter((p) => p.id !== dragId);
    const at = siblings.findIndex((p) => p.id === targetId);
    if (at < 0) return;
    const reordered = [...siblings.slice(0, at), { id: dragId }, ...siblings.slice(at)];
    // Renumber in tens so a later single move usually needs one write, not a full pass.
    reordered.forEach((p, i) => {
      const existing = projects.find((q) => q.id === p.id);
      const next = (i + 1) * 10;
      if (existing && (existing.sortOrder ?? 0) !== next) {
        applyPlacement(p.id, p.id === dragId
          ? { folder: target.folder || '', sort_order: next }
          : { sort_order: next });
      }
    });
  };

  const handleMoveToFolder = async (folder: string) => {
    if (!moveDialog) return;
    const id = moveDialog.project.id;
    setMoveDialog(null);
    await applyPlacement(id, { folder, sort_order: 0 });
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '—';
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
        borderBottom: `1px solid ${purpleBorder}`,
        bgcolor: isDark ? 'rgba(31, 31, 31, 0.02)' : 'rgba(37, 37, 37, 0.01)',
      }}>
        <Box sx={{ maxWidth: 900, mx: 'auto', px: 3, py: 3 }}>
          <Typography sx={{ mb: 1.5, fontSize: 11, color: 'text.secondary', fontWeight: 500, letterSpacing: 0.5, textTransform: 'uppercase' }}>
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
                      border: `1px solid ${accentBorder}`,
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.5,
                      cursor: 'pointer',
                      bgcolor: surfaceBg,
                      transition: 'all 0.15s',
                      '&:hover': {
                        borderColor: 'primary.main',
                        bgcolor: hoverBg,
                      },
                    }}
                  >
                    <Icon sx={{ fontSize: 24, color: template.id === 'blank' ? 'primary.main' : 'text.secondary' }} />
                    <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
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
                border: `1px dashed ${dragActive ? '#ffffff' : accentBorder}`,
                borderRadius: '8px',
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
                accept=".pdf,.doc,.docx"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <CloudUpload sx={{ fontSize: 24, color: 'text.disabled' }} />
              <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                Upload
              </Typography>
            </Box>
          </Box>

          {file && (
            <Box sx={{
              mt: 2,
              border: `1px solid ${purpleBorder}`,
              borderRadius: '8px',
              bgcolor: surfaceBg,
              overflow: 'hidden',
            }}>
              {/* Document row */}
              <Box sx={{
                p: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Description sx={{ fontSize: 18, color: 'primary.main' }} />
                  <Typography sx={{ fontSize: 12 }}>{file.name}</Typography>
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
                  <IconButton size="small" onClick={() => { setFile(null); setClsFile(null); }} sx={{ p: 0.25 }}>
                    <Close sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              </Box>

              {/* Optional .cls template row */}
              <Box sx={{
                px: 1.5,
                pb: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}>
                <input
                  id="cls-input"
                  type="file"
                  accept=".cls,.sty"
                  onChange={handleClsSelect}
                  style={{ display: 'none' }}
                />
                {clsFile ? (
                  <>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', flex: 1 }}>
                      Template: {clsFile.name}
                    </Typography>
                    <IconButton size="small" onClick={() => setClsFile(null)} sx={{ p: 0.25 }}>
                      <Close sx={{ fontSize: 14 }} />
                    </IconButton>
                  </>
                ) : (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => document.getElementById('cls-input')?.click()}
                    sx={{ fontSize: 11, color: 'text.secondary', p: 0, minWidth: 0, textTransform: 'none' }}
                  >
                    + attach .cls template (optional)
                  </Button>
                )}
              </Box>
            </Box>
          )}

          {uploading && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress
                variant="determinate"
                value={uploadProgress}
                sx={{
                  height: 2,
                  borderRadius: 1,
                  bgcolor: accentBorder,
                  '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' },
                }}
              />
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
          <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 500, letterSpacing: 0.5, textTransform: 'uppercase' }}>
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
              <Skeleton key={i} variant="rounded" height={44} sx={{ borderRadius: '8px' }} />
            ))}
          </Box>
        ) : filteredProjects.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Description sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {search ? 'No documents found' : 'No documents yet'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {grouped.map(([folder, items]) => (
              <Box key={folder || '__root__'} sx={{ display: 'flex', flexDirection: 'column' }}>
                {folder && (
                  <Box
                    onClick={() => setCollapsed((prev) => {
                      const next = new Set(prev);
                      next.has(folder) ? next.delete(folder) : next.add(folder);
                      return next;
                    })}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsed.has(folder)}
                    aria-label={`${folder} folder, ${items.length} documents`}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          next.has(folder) ? next.delete(folder) : next.add(folder);
                          return next;
                        });
                      }
                    }}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1,
                      px: 1.5, py: 0.75, mt: 1, cursor: 'pointer', borderRadius: '8px',
                      '&:hover': { bgcolor: hoverBg },
                    }}
                  >
                    <ChevronRight
                      sx={{
                        fontSize: 14, color: 'text.secondary',
                        transform: collapsed.has(folder) ? 'none' : 'rotate(90deg)',
                        transition: 'transform 0.15s',
                      }}
                    />
                    <FolderOutlined sx={{ fontSize: 15, color: 'text.secondary' }} />
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.primary', letterSpacing: '0.01em' }}>
                      {folder}
                    </Typography>
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 18, height: 18, px: 0.6, borderRadius: '9px',
                        bgcolor: countBg, color: 'text.secondary',
                        fontSize: 10.5, fontWeight: 600, lineHeight: 1,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {items.length}
                    </Box>
                  </Box>
                )}

                {!collapsed.has(folder) && items.map((project) => (
                  <Box
                    key={project.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', project.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverId(project.id); }}
                    onDragLeave={() => setDragOverId((cur) => cur === project.id ? null : cur)}
                    onDrop={handleReorderDrop(project.id)}
                    onDragEnd={() => setDragOverId(null)}
                    onClick={() => navigate(`/editor/${project.id}`)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${project.name}`}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/editor/${project.id}`);
                      }
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      px: 1.5,
                      py: 1,
                      ml: folder ? 2.5 : 0,
                      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                      borderLeft: folder ? `1px solid ${accentBorder}` : 'none',
                      borderRadius: folder ? '0 8px 8px 0' : '8px',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      boxShadow: dragOverId === project.id ? `inset 0 2px 0 ${accentBorder}` : 'none',
                      '&:hover': { bgcolor: hoverBg },
                      '&:hover .actions': { opacity: 1 },
                    }}
                  >
                    <Description sx={{ fontSize: 18, color: 'primary.main', opacity: 0.8 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13 }} noWrap>
                        {project.name}
                      </Typography>
                    </Box>
                    <Typography sx={{
                      fontSize: 11, color: 'text.secondary', minWidth: 68,
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                    }}>
                      {formatDate(project.updatedAt || project.createdAt)}
                    </Typography>
                    <IconButton
                      className="actions"
                      size="small"
                      aria-label={`Actions for ${project.name}`}
                      onClick={(e) => handleMenuOpen(e, project)}
                      sx={{ opacity: 0, transition: 'opacity 0.1s', p: 0.5 }}
                    >
                      <MoreVert sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                ))}
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
        <MenuItem onClick={() => { navigate(`/editor/${menuAnchor?.project.id}`); handleMenuClose(); }} sx={{ fontSize: 12 }}>
          <Edit sx={{ mr: 1.5, fontSize: 14 }} /> Open
        </MenuItem>
        <MenuItem onClick={handleDuplicate} sx={{ fontSize: 12 }}>
          <ContentCopy sx={{ mr: 1.5, fontSize: 14 }} /> Duplicate
        </MenuItem>
        <MenuItem
          onClick={() => { setShareProject(menuAnchor!.project); handleMenuClose(); }}
          sx={{ fontSize: 12 }}
        >
          <PersonAdd sx={{ mr: 1.5, fontSize: 14 }} /> {menuAnchor?.project.shared ? 'People' : 'Share'}
        </MenuItem>
        {!menuAnchor?.project.shared && (
          <MenuItem
            onClick={() => {
              setMoveDialog({ project: menuAnchor!.project });
              setNewFolderName('');
              handleMenuClose();
            }}
            sx={{ fontSize: 12 }}
          >
            <FolderOutlined sx={{ mr: 1.5, fontSize: 14 }} /> Move to folder
          </MenuItem>
        )}
        <MenuItem onClick={() => { api.downloadPdf(menuAnchor!.project.id, menuAnchor!.project.name); handleMenuClose(); }} sx={{ fontSize: 12 }}>
          <Download sx={{ mr: 1.5, fontSize: 14 }} /> Download
        </MenuItem>
        {!menuAnchor?.project.shared && (
          <MenuItem onClick={handleDelete} sx={{ fontSize: 12, color: 'error.main' }}>
            <Delete sx={{ mr: 1.5, fontSize: 14 }} /> Delete
          </MenuItem>
        )}
      </Menu>

      <ShareDialog
        projectId={shareProject?.id ?? null}
        projectName={shareProject?.name}
        onClose={() => { setShareProject(null); loadProjects(); }}
      />

      <Dialog open={Boolean(moveDialog)} onClose={() => setMoveDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>
          Move &ldquo;{moveDialog?.project.name}&rdquo;
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, pb: 1 }}>
          <List dense sx={{ py: 0 }}>
            <ListItemButton
              selected={!moveDialog?.project.folder}
              onClick={() => handleMoveToFolder('')}
              sx={{ borderRadius: '6px' }}
            >
              <Description sx={{ fontSize: 15, mr: 1.5, color: 'text.secondary' }} />
              <ListItemText primaryTypographyProps={{ fontSize: 13 }} primary="All documents" />
            </ListItemButton>
            {folderNames.map((name) => (
              <ListItemButton
                key={name}
                selected={moveDialog?.project.folder === name}
                onClick={() => handleMoveToFolder(name)}
                sx={{ borderRadius: '6px' }}
              >
                <FolderOutlined sx={{ fontSize: 15, mr: 1.5, color: 'text.secondary' }} />
                <ListItemText primaryTypographyProps={{ fontSize: 13 }} primary={name} />
              </ListItemButton>
            ))}
          </List>
          <TextField
            size="small"
            fullWidth
            sx={{ mt: 0.5 }}
            label="New folder"
            placeholder="e.g. thesis/chapters"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newFolderName.trim()) handleMoveToFolder(newFolderName.trim());
            }}
            InputProps={{ sx: { fontSize: 13 } }}
            InputLabelProps={{ sx: { fontSize: 13 } }}
            helperText="Use / to nest, e.g. thesis/chapters"
            FormHelperTextProps={{ sx: { fontSize: 11 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialog(null)} size="small" sx={{ fontSize: 12 }}>Cancel</Button>
          <Button
            onClick={() => handleMoveToFolder(newFolderName.trim())}
            disabled={!newFolderName.trim()}
            size="small"
            variant="contained"
            sx={{ fontSize: 12 }}
          >
            Move
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteDialog)}
        title="Delete document"
        message={`Delete "${deleteDialog?.project.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteDialog(null)}
      />

      {missingImagesDialog && (
        <MissingImagesDialog
          open={true}
          projectId={missingImagesDialog.projectId}
          missingImages={missingImagesDialog.images}
          onDone={() => {
            const id = missingImagesDialog.projectId;
            setMissingImagesDialog(null);
            navigate(`/editor/${id}`);
          }}
        />
      )}
    </Box>
  );
}
