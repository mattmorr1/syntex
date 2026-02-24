import { ReactNode } from 'react';
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
} from '@mui/material';
import {
  AdminPanelSettings,
  Logout,
  Settings,
} from '@mui/icons-material';
import { useState } from 'react';
import { useThemeStore } from '../../store/themeStore';
import { useAuth } from '../../hooks/useAuth';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const { mode } = useThemeStore();
  const { user, isAdmin, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const isDark = mode === 'dark';
  const purpleBorder = isDark ? '#4c1d95' : '#ddd6fe';

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box sx={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        borderBottom: `1px solid ${purpleBorder}`,
        flexShrink: 0,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <img src="/syntex.svg" alt="syntex" style={{ width: 18, height: 18 }} />
          <Typography sx={{ fontWeight: 600, fontSize: 12, letterSpacing: '-0.01em' }}>
            syntex
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {isAdmin && (
            <Tooltip title="Admin">
              <IconButton size="small" onClick={() => navigate('/admin')} sx={{ p: 0.75 }}>
                <AdminPanelSettings sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}

          {user && (
            <>
              <IconButton onClick={handleMenu} sx={{ ml: 0.5, p: 0.25 }}>
                <Avatar sx={{
                  width: 24,
                  height: 24,
                  fontSize: 10,
                  fontWeight: 700,
                  bgcolor: 'primary.main',
                }}>
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
                    <Typography variant="body2" fontWeight={500} sx={{ fontSize: 12 }}>{user.username}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{user.email}</Typography>
                  </Box>
                </MenuItem>
                <Divider />
                <MenuItem disabled sx={{ opacity: 0.7 }}>
                  <Typography variant="caption" sx={{ fontSize: 10 }}>
                    {user.tokensUsed.total.toLocaleString()} tokens used
                  </Typography>
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { handleClose(); navigate('/settings'); }} sx={{ fontSize: 12 }}>
                  <Settings sx={{ mr: 1.5, fontSize: 14 }} />
                  Settings
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { handleClose(); logout(); }} sx={{ fontSize: 12 }}>
                  <Logout sx={{ mr: 1.5, fontSize: 14 }} />
                  Sign out
                </MenuItem>
              </Menu>
            </>
          )}
        </Box>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  );
}
