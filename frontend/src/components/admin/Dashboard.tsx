import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  TextField,
  InputAdornment,
  Alert,
  Skeleton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  Search,
  Refresh,
  Delete,
  RestartAlt,
  People,
  Token,
  Description,
  TrendingUp,
} from '@mui/icons-material';
import { api } from '../../services/api';

interface User {
  uid: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
  lastAccessed: string;
  tokensUsed: { total: number; flash: number; pro: number };
}

interface Stats {
  totalUsers: number;
  totalProjects: number;
  totalTokens: number;
  activeToday: number;
}

export function AdminDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ type: 'delete' | 'reset'; user: User } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, statsData] = await Promise.all([
        api.getUsers(),
        api.getStats(),
      ]);
      setUsers(usersData);
      setStats(statsData);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleResetTokens = async () => {
    if (!confirmDialog || confirmDialog.type !== 'reset') return;
    try {
      await api.resetUserTokens(confirmDialog.user.uid);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === confirmDialog.user.uid
            ? { ...u, tokensUsed: { total: 0, flash: 0, pro: 0 } }
            : u
        )
      );
      setConfirmDialog(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async () => {
    if (!confirmDialog || confirmDialog.type !== 'delete') return;
    try {
      await api.deleteUser(confirmDialog.user.uid);
      setUsers((prev) => prev.filter((u) => u.uid !== confirmDialog.user.uid));
      setConfirmDialog(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString();
  const formatNumber = (n: number) => n.toLocaleString();

  const StatCard = ({ title, value, icon, color }: { title: string; value: string | number; icon: React.ReactNode; color: string }) => (
    <Card>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: `${color}.main`, color: 'white', display: 'flex' }}>
          {icon}
        </Box>
        <Box>
          <Typography color="text.secondary" variant="body2">{title}</Typography>
          <Typography variant="h5" fontWeight={600}>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ p: 4, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>Admin Dashboard</Typography>
          <Typography color="text.secondary">Manage users and monitor usage</Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={loadData}>
            <Refresh />
          </IconButton>
        </Tooltip>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {loading ? (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[1, 2, 3, 4].map((i) => (
            <Grid item xs={12} sm={6} md={3} key={i}>
              <Skeleton variant="rounded" height={100} />
            </Grid>
          ))}
        </Grid>
      ) : stats && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard title="Total Users" value={formatNumber(stats.totalUsers)} icon={<People />} color="primary" />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard title="Total Projects" value={formatNumber(stats.totalProjects)} icon={<Description />} color="secondary" />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard title="Tokens Used" value={formatNumber(stats.totalTokens)} icon={<Token />} color="success" />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard title="Active Today" value={stats.activeToday} icon={<TrendingUp />} color="warning" />
          </Grid>
        </Grid>
      )}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Users</Typography>
          <TextField
            placeholder="Search users..."
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search /></InputAdornment>,
            }}
          />
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Tokens (Flash)</TableCell>
                <TableCell>Tokens (Pro)</TableCell>
                <TableCell>Total Tokens</TableCell>
                <TableCell>Last Active</TableCell>
                <TableCell>Joined</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((_, j) => (
                      <TableCell key={j}><Skeleton /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No users found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.uid} hover>
                    <TableCell>
                      <Box>
                        <Typography fontWeight={500}>{user.username}</Typography>
                        <Typography variant="caption" color="text.secondary">{user.email}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={user.role}
                        size="small"
                        color={user.role === 'admin' ? 'primary' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{formatNumber(user.tokensUsed.flash)}</TableCell>
                    <TableCell>{formatNumber(user.tokensUsed.pro)}</TableCell>
                    <TableCell>{formatNumber(user.tokensUsed.total)}</TableCell>
                    <TableCell>{formatDate(user.lastAccessed)}</TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Reset tokens">
                        <IconButton
                          size="small"
                          onClick={() => setConfirmDialog({ type: 'reset', user })}
                        >
                          <RestartAlt fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete user">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setConfirmDialog({ type: 'delete', user })}
                          disabled={user.role === 'admin'}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!confirmDialog} onClose={() => setConfirmDialog(null)}>
        <DialogTitle>
          {confirmDialog?.type === 'delete' ? 'Delete User' : 'Reset Tokens'}
        </DialogTitle>
        <DialogContent>
          {confirmDialog?.type === 'delete' ? (
            <Typography>
              Delete user <strong>{confirmDialog.user.username}</strong>? This cannot be undone.
            </Typography>
          ) : (
            <Typography>
              Reset all tokens for <strong>{confirmDialog?.user.username}</strong>?
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={confirmDialog?.type === 'delete' ? 'error' : 'primary'}
            onClick={confirmDialog?.type === 'delete' ? handleDeleteUser : handleResetTokens}
          >
            {confirmDialog?.type === 'delete' ? 'Delete' : 'Reset'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
