import { useState, useEffect } from 'react';
import {
  Box, Typography, Grid, Card, CardContent, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, IconButton, Chip, TextField,
  InputAdornment, Alert, Skeleton, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, Tabs, Tab, CircularProgress,
} from '@mui/material';
import {
  Search, Refresh, Delete, RestartAlt, People, Token, Description, TrendingUp,
  Add, ContentCopy, VpnKey, Edit, Check, Close, HowToReg, PersonOff,
} from '@mui/icons-material';
import { api } from '../../services/api';

const DEFAULT_TOKEN_CAP = 2_000_000;

interface User {
  uid: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
  lastAccessed: string;
  tokensUsed: { total: number; flash: number; pro: number };
  tokenCap: number;
  tokensUsedThisMonth: { total: number; flash: number; pro: number };
}

interface Stats {
  totalUsers: number;
  totalProjects: number;
  totalTokens: number;
  activeToday: number;
}

interface Invite {
  code: string;
  created_by: string;
  created_at: string;
  max_uses: number;
  used_count: number;
  used_by: string[];
  active: boolean;
}

interface AccessRequest {
  id: string;
  name: string;
  email: string;
  institution: string;
  use_case: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  rejection_reason?: string;
}

export function AdminDashboard() {
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ type: 'delete' | 'reset'; user: User } | null>(null);
  const [newInviteUses, setNewInviteUses] = useState(1);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Token cap inline editing
  const [editingCapUid, setEditingCapUid] = useState<string | null>(null);
  const [capInput, setCapInput] = useState('');
  const [capLoading, setCapLoading] = useState<string | null>(null);

  // Access request actions
  const [rejectDialog, setRejectDialog] = useState<AccessRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, statsData, invitesData, reqsData] = await Promise.all([
        api.getUsers(),
        api.getStats(),
        api.getInvites(),
        api.getAccessRequests(),
      ]);
      setUsers(usersData);
      setStats(statsData);
      setInvites(invitesData);
      setAccessRequests(reqsData);
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
      setUsers(prev => prev.map(u => u.uid === confirmDialog.user.uid
        ? { ...u, tokensUsed: { total: 0, flash: 0, pro: 0 } } : u));
      setConfirmDialog(null);
    } catch (err: any) { setError(err.message); }
  };

  const handleDeleteUser = async () => {
    if (!confirmDialog || confirmDialog.type !== 'delete') return;
    try {
      await api.deleteUser(confirmDialog.user.uid);
      setUsers(prev => prev.filter(u => u.uid !== confirmDialog.user.uid));
      setConfirmDialog(null);
    } catch (err: any) { setError(err.message); }
  };

  const handleSaveTokenCap = async (uid: string) => {
    const cap = parseInt(capInput, 10);
    if (isNaN(cap) || cap < 0) return;
    setCapLoading(uid);
    try {
      await api.setUserTokenCap(uid, cap);
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, tokenCap: cap } : u));
      setEditingCapUid(null);
    } catch (err: any) { setError(err.message); }
    finally { setCapLoading(null); }
  };

  const handleCreateInvite = async () => {
    try {
      const invite = await api.createInvite(newInviteUses);
      setInvites(prev => [invite, ...prev]);
      setNewInviteUses(1);
    } catch (err: any) { setError(err.message); }
  };

  const handleDeactivateInvite = async (code: string) => {
    try {
      await api.deactivateInvite(code);
      setInvites(prev => prev.map(i => i.code === code ? { ...i, active: false } : i));
    } catch (err: any) { setError(err.message); }
  };

  const handleApprove = async (req: AccessRequest) => {
    setActionLoading(req.id);
    try {
      await api.approveAccessRequest(req.id);
      setAccessRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));
      setSuccessMsg(`Access approved for ${req.email}`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  };

  const handleReject = async () => {
    if (!rejectDialog) return;
    setActionLoading(rejectDialog.id);
    try {
      await api.rejectAccessRequest(rejectDialog.id, rejectReason);
      setAccessRequests(prev => prev.map(r => r.id === rejectDialog.id ? { ...r, status: 'rejected' } : r));
      setRejectDialog(null);
      setRejectReason('');
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const pendingCount = accessRequests.filter(r => r.status === 'pending').length;

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString() : '-';
  const formatNumber = (n: number) => (n ?? 0).toLocaleString();

  const StatCard = ({ title, value, icon, color }: { title: string; value: string | number; icon: React.ReactNode; color: string }) => (
    <Card>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: `${color}.main`, color: 'white', display: 'flex' }}>{icon}</Box>
        <Box>
          <Typography color="text.secondary" variant="caption">{title}</Typography>
          <Typography variant="h6" fontWeight={600}>{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>Admin</Typography>
        <IconButton size="small" onClick={loadData}><Refresh sx={{ fontSize: 18 }} /></IconButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2, fontSize: 12 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {stats && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} md={3}>
            <StatCard title="Users" value={formatNumber(stats.totalUsers)} icon={<People sx={{ fontSize: 18 }} />} color="primary" />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard title="Projects" value={formatNumber(stats.totalProjects)} icon={<Description sx={{ fontSize: 18 }} />} color="secondary" />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard title="Tokens" value={formatNumber(stats.totalTokens)} icon={<Token sx={{ fontSize: 18 }} />} color="success" />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard title="Active Today" value={stats.activeToday} icon={<TrendingUp sx={{ fontSize: 18 }} />} color="warning" />
          </Grid>
        </Grid>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Users" sx={{ fontSize: 13 }} />
        <Tab label="Invites" sx={{ fontSize: 13 }} />
        <Tab
          label={pendingCount > 0 ? `Access Requests (${pendingCount})` : 'Access Requests'}
          sx={{ fontSize: 13 }}
        />
      </Tabs>

      {/* Users Tab */}
      {tab === 0 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" fontWeight={500}>{filteredUsers.length} users</Typography>
            <TextField
              placeholder="Search..."
              size="small"
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ '& .MuiInputBase-root': { fontSize: 12 } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16 }} /></InputAdornment> }}
            />
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11 }}>User</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Role</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>All-time Tokens</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>This Month</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Monthly Cap</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Last Active</TableCell>
                  <TableCell sx={{ fontSize: 11 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  [...Array(3)].map((_, i) => (
                    <TableRow key={i}>{[...Array(7)].map((_, j) => <TableCell key={j}><Skeleton /></TableCell>)}</TableRow>
                  ))
                ) : filteredUsers.map(user => (
                  <TableRow key={user.uid} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{user.username}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{user.email}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={user.role} size="small" color={user.role === 'admin' ? 'primary' : 'default'} sx={{ fontSize: 10, height: 20 }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{formatNumber(user.tokensUsed?.total || 0)}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{formatNumber(user.tokensUsedThisMonth?.total || 0)}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {editingCapUid === user.uid ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <TextField
                            size="small"
                            value={capInput}
                            onChange={e => setCapInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveTokenCap(user.uid); if (e.key === 'Escape') setEditingCapUid(null); }}
                            autoFocus
                            sx={{ width: 100, '& input': { fontSize: 11, py: 0.5 } }}
                            inputProps={{ type: 'number', min: 0 }}
                          />
                          <IconButton size="small" onClick={() => handleSaveTokenCap(user.uid)} sx={{ p: 0.25 }}>
                            {capLoading === user.uid ? <CircularProgress size={12} /> : <Check sx={{ fontSize: 14, color: 'success.main' }} />}
                          </IconButton>
                          <IconButton size="small" onClick={() => setEditingCapUid(null)} sx={{ p: 0.25 }}>
                            <Close sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography sx={{ fontSize: 11 }}>{formatNumber(user.tokenCap ?? DEFAULT_TOKEN_CAP)}</Typography>
                          <IconButton size="small" onClick={() => { setEditingCapUid(user.uid); setCapInput(String(user.tokenCap ?? DEFAULT_TOKEN_CAP)); }} sx={{ p: 0.25 }}>
                            <Edit sx={{ fontSize: 12, color: 'text.secondary' }} />
                          </IconButton>
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{formatDate(user.lastAccessed)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Reset all-time tokens">
                        <IconButton size="small" onClick={() => setConfirmDialog({ type: 'reset', user })} sx={{ p: 0.5 }}>
                          <RestartAlt sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" color="error" onClick={() => setConfirmDialog({ type: 'delete', user })} disabled={user.role === 'admin'} sx={{ p: 0.5 }}>
                        <Delete sx={{ fontSize: 16 }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Invites Tab */}
      {tab === 1 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
            <VpnKey sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={500}>Invite Codes</Typography>
            <Box sx={{ flex: 1 }} />
            <TextField
              type="number"
              size="small"
              value={newInviteUses}
              onChange={e => setNewInviteUses(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              sx={{ width: 70, '& input': { fontSize: 12, textAlign: 'center' } }}
              inputProps={{ min: 1, max: 100 }}
            />
            <Typography variant="caption" color="text.secondary">uses</Typography>
            <Button size="small" variant="contained" startIcon={<Add sx={{ fontSize: 16 }} />} onClick={handleCreateInvite} sx={{ fontSize: 12 }}>Create</Button>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11 }}>Code</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Uses</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Status</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Created</TableCell>
                  <TableCell sx={{ fontSize: 11 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  [...Array(3)].map((_, i) => <TableRow key={i}>{[...Array(5)].map((_, j) => <TableCell key={j}><Skeleton /></TableCell>)}</TableRow>)
                ) : invites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>No invites yet</Typography>
                    </TableCell>
                  </TableRow>
                ) : invites.map(invite => (
                  <TableRow key={invite.code} hover sx={{ opacity: invite.active ? 1 : 0.5 }}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" sx={{ fontSize: 12, fontFamily: 'monospace', letterSpacing: 1 }}>{invite.code}</Typography>
                        <Tooltip title={copiedCode === invite.code ? 'Copied!' : 'Copy'}>
                          <IconButton size="small" onClick={() => copyToClipboard(invite.code)} sx={{ p: 0.25 }}>
                            <ContentCopy sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{invite.used_count} / {invite.max_uses}</TableCell>
                    <TableCell>
                      <Chip
                        label={invite.active ? (invite.used_count >= invite.max_uses ? 'Used' : 'Active') : 'Inactive'}
                        size="small"
                        color={invite.active && invite.used_count < invite.max_uses ? 'success' : 'default'}
                        sx={{ fontSize: 10, height: 20 }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{formatDate(invite.created_at)}</TableCell>
                    <TableCell align="right">
                      {invite.active && invite.used_count < invite.max_uses && (
                        <IconButton size="small" color="error" onClick={() => handleDeactivateInvite(invite.code)} sx={{ p: 0.5 }}>
                          <Delete sx={{ fontSize: 16 }} />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Access Requests Tab */}
      {tab === 2 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="body2" fontWeight={500} sx={{ mb: 2 }}>
            Access Requests — {pendingCount} pending
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11 }}>Applicant</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Institution</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Use Case</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Date</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>Status</TableCell>
                  <TableCell sx={{ fontSize: 11 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  [...Array(3)].map((_, i) => <TableRow key={i}>{[...Array(6)].map((_, j) => <TableCell key={j}><Skeleton /></TableCell>)}</TableRow>)
                ) : accessRequests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>No access requests</Typography>
                    </TableCell>
                  </TableRow>
                ) : accessRequests.map(req => (
                  <TableRow key={req.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{req.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{req.email}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{req.institution}</TableCell>
                    <TableCell sx={{ fontSize: 11, maxWidth: 220 }}>
                      <Tooltip title={req.use_case}>
                        <Typography noWrap sx={{ fontSize: 11, maxWidth: 200 }}>{req.use_case}</Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{formatDate(req.created_at)}</TableCell>
                    <TableCell>
                      <Chip
                        label={req.status}
                        size="small"
                        color={req.status === 'approved' ? 'success' : req.status === 'rejected' ? 'error' : 'warning'}
                        sx={{ fontSize: 10, height: 20 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {req.status === 'pending' && (
                        <>
                          <Tooltip title="Approve">
                            <IconButton
                              size="small"
                              color="success"
                              onClick={() => handleApprove(req)}
                              disabled={actionLoading === req.id}
                              sx={{ p: 0.5 }}
                            >
                              {actionLoading === req.id ? <CircularProgress size={14} /> : <HowToReg sx={{ fontSize: 16 }} />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Reject">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => { setRejectDialog(req); setRejectReason(''); }}
                              disabled={actionLoading === req.id}
                              sx={{ p: 0.5 }}
                            >
                              <PersonOff sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Confirm Dialog (reset / delete) */}
      <Dialog open={!!confirmDialog} onClose={() => setConfirmDialog(null)}>
        <DialogTitle sx={{ fontSize: 16 }}>
          {confirmDialog?.type === 'delete' ? 'Delete User' : 'Reset Tokens'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {confirmDialog?.type === 'delete'
              ? `Delete ${confirmDialog.user.username}? This cannot be undone.`
              : `Reset tokens for ${confirmDialog?.user.username}?`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)} size="small">Cancel</Button>
          <Button variant="contained" size="small" color={confirmDialog?.type === 'delete' ? 'error' : 'primary'}
            onClick={confirmDialog?.type === 'delete' ? handleDeleteUser : handleResetTokens}>
            {confirmDialog?.type === 'delete' ? 'Delete' : 'Reset'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onClose={() => setRejectDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>Reject Access Request</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5, fontSize: 12 }}>
            Rejecting request from <strong>{rejectDialog?.name}</strong> ({rejectDialog?.email})
          </Typography>
          <TextField
            label="Reason (optional)"
            multiline
            rows={3}
            fullWidth
            size="small"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            InputLabelProps={{ sx: { fontSize: 12 } }}
            inputProps={{ style: { fontSize: 12 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialog(null)} size="small">Cancel</Button>
          <Button variant="contained" color="error" size="small" onClick={handleReject} disabled={actionLoading === rejectDialog?.id}>
            {actionLoading === rejectDialog?.id ? <CircularProgress size={14} /> : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
