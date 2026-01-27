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
  DarkMode,
  LightMode,
  AdminPanelSettings,
  Logout,
} from '@mui/icons-material';
import { useState } from 'react';
import { useThemeStore } from '../../store/themeStore';
import { useAuth } from '../../hooks/useAuth';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const { mode, toggleTheme } = useThemeStore();
  const { user, isAdmin, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const borderColor = mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
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
              <MenuItem onClick={() => { handleClose(); logout(); }} sx={{ fontSize: 13 }}>
                <Logout sx={{ mr: 1.5, fontSize: 16 }} />
                Sign out
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>
      
      <Box component="main" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  );
}
