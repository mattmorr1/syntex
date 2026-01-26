import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  IconButton,
  TextField,
  InputAdornment,
  Menu,
  MenuItem,
  Chip,
  Skeleton,
  Alert,
  Tooltip,
  FormControl,
  Select,
  InputLabel,
} from '@mui/material';
import {
  Search,
  MoreVert,
  Edit,
  ContentCopy,
  Delete,
  Download,
  Description,
  SortByAlpha,
} from '@mui/icons-material';
import { api } from '../services/api';
import { Project } from '../store/editorStore';

export function History() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; project: Project } | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
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
    if (!confirm('Delete this project? This cannot be undone.')) return;
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
    .sort((a, b) => {
      const aVal = sortBy === 'date' ? new Date(a.updatedAt).getTime() : a.name.toLowerCase();
      const bVal = sortBy === 'date' ? new Date(b.updatedAt).getTime() : b.name.toLowerCase();
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <Box sx={{ p: 4, maxWidth: 1400, mx: 'auto' }}>
      <Typography variant="h4" fontWeight={600} mb={1}>
        Your Documents
      </Typography>
      <Typography color="text.secondary" mb={4}>
        {projects.length} document{projects.length !== 1 ? 's' : ''}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
        <TextField
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flexGrow: 1, maxWidth: 400 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Sort by</InputLabel>
          <Select
            value={sortBy}
            label="Sort by"
            onChange={(e) => setSortBy(e.target.value as 'date' | 'name')}
          >
            <MenuItem value="date">Date</MenuItem>
            <MenuItem value="name">Name</MenuItem>
          </Select>
        </FormControl>
        <Tooltip title={`Sort ${sortOrder === 'asc' ? 'descending' : 'ascending'}`}>
          <IconButton onClick={() => setSortOrder((o) => o === 'asc' ? 'desc' : 'asc')}>
            <SortByAlpha sx={{ transform: sortOrder === 'desc' ? 'scaleY(-1)' : 'none' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {loading ? (
        <Grid container spacing={3}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Grid item xs={12} sm={6} md={4} key={i}>
              <Skeleton variant="rounded" height={180} />
            </Grid>
          ))}
        </Grid>
      ) : filteredProjects.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Description sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography color="text.secondary">
            {search ? 'No documents match your search' : 'No documents yet'}
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {filteredProjects.map((project) => (
            <Grid item xs={12} sm={6} md={4} key={project.id}>
              <Card
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': { transform: 'translateY(-4px)', boxShadow: 4 },
                }}
                onClick={() => navigate(`/editor/${project.id}`)}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Typography variant="h6" noWrap sx={{ flex: 1 }}>
                      {project.name}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, project)}
                    >
                      <MoreVert />
                    </IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
                    <Chip label={project.theme} size="small" />
                    <Chip label={`${project.files.length} files`} size="small" variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Updated {formatDate(project.updatedAt)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => { navigate(`/editor/${menuAnchor?.project.id}`); handleMenuClose(); }}>
          <Edit sx={{ mr: 1 }} fontSize="small" /> Edit
        </MenuItem>
        <MenuItem onClick={handleDuplicate}>
          <ContentCopy sx={{ mr: 1 }} fontSize="small" /> Duplicate
        </MenuItem>
        <MenuItem onClick={() => { window.open(`/api/download-pdf/${menuAnchor?.project.id}`); handleMenuClose(); }}>
          <Download sx={{ mr: 1 }} fontSize="small" /> Download PDF
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
          <Delete sx={{ mr: 1 }} fontSize="small" /> Delete
        </MenuItem>
      </Menu>
    </Box>
  );
}
