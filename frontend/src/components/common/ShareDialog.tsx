import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField,
  List, ListItem, ListItemText, IconButton, Box, Chip, Alert, CircularProgress,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { api } from '../../services/api';

interface Member {
  uid: string;
  role: string;
  email: string;
  username: string;
}

interface ShareDialogProps {
  projectId: string | null;
  projectName?: string;
  onClose: () => void;
}

/**
 * Sharing is by existing account only: the API resolves the address to a uid and refuses
 * an unknown one, so there is no pending-invite state to reconcile here.
 */
export function ShareDialog({ projectId, projectName, onClose }: ShareDialogProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    try {
      const data = await api.getMembers(id);
      setMembers(data.members);
      setIsOwner(data.is_owner);
    } catch (err: any) {
      setError(err.message || 'Could not load members');
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setEmail('');
    setError('');
    load(projectId);
  }, [projectId, load]);

  const add = async () => {
    if (!projectId || !email.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.addMember(projectId, email.trim());
      setEmail('');
      await load(projectId);
    } catch (err: any) {
      setError(err.message || 'Could not share');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (uid: string) => {
    if (!projectId) return;
    setError('');
    try {
      await api.removeMember(projectId, uid);
      await load(projectId);
    } catch (err: any) {
      setError(err.message || 'Could not remove');
    }
  };

  return (
    <Dialog open={Boolean(projectId)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>
        Share{projectName ? ` "${projectName}"` : ''}
      </DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        {isOwner && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              fullWidth size="small" type="email" label="Email address" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              InputProps={{ sx: { fontSize: 13 } }}
              InputLabelProps={{ sx: { fontSize: 13 } }}
            />
            <Button onClick={add} disabled={busy || !email.trim()} sx={{ fontSize: 12 }}>
              {busy ? <CircularProgress size={14} /> : 'Share'}
            </Button>
          </Box>
        )}

        {error && <Alert severity="error" sx={{ fontSize: 12, mb: 1 }}>{error}</Alert>}

        <List dense disablePadding>
          {members.map((m) => (
            <ListItem
              key={m.uid}
              disableGutters
              secondaryAction={
                m.role !== 'owner' && isOwner ? (
                  <IconButton edge="end" size="small" onClick={() => remove(m.uid)} aria-label={`Remove ${m.email}`}>
                    <Close sx={{ fontSize: 14 }} />
                  </IconButton>
                ) : null
              }
            >
              <ListItemText
                primary={m.username || m.email}
                secondary={m.email}
                primaryTypographyProps={{ fontSize: 13 }}
                secondaryTypographyProps={{ fontSize: 11 }}
              />
              {m.role === 'owner' && <Chip label="Owner" size="small" sx={{ fontSize: 10, height: 18 }} />}
            </ListItem>
          ))}
        </List>

        {!isOwner && (
          <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 1 }}>
            Shared with you. Only the owner can add or remove people.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ fontSize: 12 }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
