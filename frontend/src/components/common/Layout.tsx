import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Typography,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
} from '@mui/material';
import {
  DarkMode,
  LightMode,
  AdminPanelSettings,
  Logout,
  Settings,
} from '@mui/icons-material';
import { useThemeStore } from '../../store/themeStore';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const { mode, toggleTheme } = useThemeStore();
  const { user, isAdmin, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');

  const borderColor = mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleOpenSettings = async () => {
    handleClose();
    setSettingsOpen(true);
    setSettingsError('');
    setSettingsSuccess('');
    try {
      const { settings } = await api.getSettings();
      setApiKeyMasked(settings.gemini_api_key_masked || '');
    } catch (err) {
      // Ignore errors loading settings
    }
  };

  const handleSaveSettings = async () => {
    if (!apiKey.trim()) {
      setSettingsError('Please enter an API key');
      return;
    }
    setSettingsLoading(true);
    setSettingsError('');
    try {
      await api.updateSettings({ gemini_api_key: apiKey });
      setSettingsSuccess('API key saved');
      setApiKeyMasked(`...${apiKey.slice(-4)}`);
      setApiKey('');
      setTimeout(() => setSettingsSuccess(''), 2000);
    } catch (err: any) {
      setSettingsError(err.message || 'Failed to save');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleClearApiKey = async () => {
    setSettingsLoading(true);
    try {
      await api.updateSettings({ gemini_api_key: '' });
      setApiKeyMasked('');
      setApiKey('');
      setSettingsSuccess('API key cleared - using default');
      setTimeout(() => setSettingsSuccess(''), 2000);
    } catch (err: any) {
      setSettingsError(err.message || 'Failed to clear');
    } finally {
      setSettingsLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Minimal Header */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'flex-end',
        gap: 0.5,
        px: 2,
        py: 1,
        borderBottom: `1px solid ${borderColor}`,
      }}>
        {isAdmin && (
          <Tooltip title="Admin">
            <IconButton size="small" onClick={() => navigate('/admin')} sx={{ p: 0.75 }}>
              <AdminPanelSettings sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        
        <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
          <IconButton size="small" onClick={toggleTheme} sx={{ p: 0.75 }}>
            {mode === 'dark' ? <LightMode sx={{ fontSize: 18 }} /> : <DarkMode sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>

        {user && (
          <>
            <IconButton onClick={handleMenu} sx={{ ml: 0.5, p: 0.25 }}>
              <Avatar sx={{ width: 26, height: 26, fontSize: 12, bgcolor: 'primary.main' }}>
                {user.username[0].toUpperCase()}
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{ sx: { minWidth: 160 } }}
            >
              <MenuItem disabled sx={{ opacity: 1 }}>
                <Box>
                  <Typography variant="body2" fontWeight={500} sx={{ fontSize: 13 }}>{user.username}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{user.email}</Typography>
                </Box>
              </MenuItem>
              <Divider />
              <MenuItem disabled sx={{ opacity: 0.7 }}>
                <Typography variant="caption" sx={{ fontSize: 11 }}>
                  {user.tokensUsed.total.toLocaleString()} tokens used
                </Typography>
              </MenuItem>
              <Divider />
              <MenuItem onClick={handleOpenSettings} sx={{ fontSize: 13 }}>
                <Settings sx={{ mr: 1.5, fontSize: 16 }} />
                Settings
              </MenuItem>
              <MenuItem onClick={() => { handleClose(); logout(); }} sx={{ fontSize: 13 }}>
                <Logout sx={{ mr: 1.5, fontSize: 16 }} />
                Sign out
              </MenuItem>
            </Menu>

            {/* Settings Dialog */}
            <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
              <DialogTitle sx={{ fontSize: 16, pb: 1 }}>Settings</DialogTitle>
              <DialogContent>
                {settingsError && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>{settingsError}</Alert>}
                {settingsSuccess && <Alert severity="success" sx={{ mb: 2, fontSize: 12 }}>{settingsSuccess}</Alert>}
                
                <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>Gemini API Key</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Use your own Gemini API key for AI features. Leave empty to use the default key.
                  {apiKeyMasked && <><br />Current: <code>{apiKeyMasked}</code></>}
                </Typography>
                
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  placeholder="Enter new API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  sx={{ mb: 2 }}
                />
                
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleSaveSettings}
                    disabled={settingsLoading || !apiKey.trim()}
                  >
                    Save Key
                  </Button>
                  {apiKeyMasked && (
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      onClick={handleClearApiKey}
                      disabled={settingsLoading}
                    >
                      Clear Key
                    </Button>
                  )}
                </Box>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSettingsOpen(false)} size="small">Close</Button>
              </DialogActions>
            </Dialog>
          </>
        )}
      </Box>
      
      <Box component="main" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  );
}
