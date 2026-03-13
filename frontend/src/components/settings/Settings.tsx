import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Divider,
  Alert,
  Button,
  ToggleButtonGroup,
  ToggleButton,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  DarkMode,
  LightMode,
  ArrowBack,
} from '@mui/icons-material';
import { useThemeStore } from '../../store/themeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuth } from '../../hooks/useAuth';

export function Settings() {
  const navigate = useNavigate();
  const { mode, toggleTheme } = useThemeStore();
  const { aiModel, setAiModel } = useSettingsStore();
  const { user, resetPassword } = useAuth();

  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isDark = mode === 'dark';
  const purpleBorder = isDark ? '#4c1d95' : '#ddd6fe';
  const accentBorder = isDark ? '#3f3f46' : '#e4e4e7';
  const surfaceBg = isDark ? '#18181b' : '#ffffff';

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setResetLoading(true);
    setResetMsg(null);
    try {
      await resetPassword(user.email);
      setResetMsg({ type: 'success', text: `Reset email sent to ${user.email}` });
    } catch (err: any) {
      setResetMsg({ type: 'error', text: err.message || 'Failed to send reset email' });
    } finally {
      setResetLoading(false);
    }
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary', mb: 1.5 }}>
        {title}
      </Typography>
      <Box sx={{
        bgcolor: surfaceBg,
        border: `1px solid ${accentBorder}`,
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        {children}
      </Box>
    </Box>
  );

  const Row = ({ label, description, control }: { label: string; description?: string; control: React.ReactNode }) => (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      px: 2, py: 1.5,
      '& + &': { borderTop: `1px solid ${accentBorder}` },
    }}>
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{label}</Typography>
        {description && (
          <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>{description}</Typography>
        )}
      </Box>
      {control}
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box sx={{
        height: 40,
        borderBottom: `1px solid ${purpleBorder}`,
        display: 'flex', alignItems: 'center', px: 2, gap: 1.5,
      }}>
        <Tooltip title="Back">
          <IconButton size="small" onClick={() => navigate(-1)} sx={{ p: 0.5 }}>
            <ArrowBack sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <img src="/syntex.svg" alt="syntex" style={{ width: 18, height: 18 }} />
          <Typography sx={{ fontWeight: 600, fontSize: 12 }}>syntex</Typography>
        </Box>
        <Box sx={{ width: 1, height: 16, bgcolor: accentBorder }} />
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Settings</Typography>
      </Box>

      <Box sx={{ maxWidth: 560, mx: 'auto', px: 3, py: 4 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 0.5 }}>Settings</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 3 }}>
          Manage your preferences and account.
        </Typography>

        <Section title="Appearance">
          <Row
            label="Theme"
            description="Choose between dark and light mode"
            control={
              <ToggleButtonGroup
                value={mode}
                exclusive
                onChange={(_, val) => { if (val && val !== mode) toggleTheme(); }}
                size="small"
              >
                <ToggleButton value="dark" sx={{ px: 1.5, py: 0.5, gap: 0.5, fontSize: 11 }}>
                  <DarkMode sx={{ fontSize: 14 }} /> Dark
                </ToggleButton>
                <ToggleButton value="light" sx={{ px: 1.5, py: 0.5, gap: 0.5, fontSize: 11 }}>
                  <LightMode sx={{ fontSize: 14 }} /> Light
                </ToggleButton>
              </ToggleButtonGroup>
            }
          />
        </Section>

        <Section title="AI Model">
          <Row
            label="Default model"
            description="Flash is faster; Pro is more capable for complex documents"
            control={
              <ToggleButtonGroup
                value={aiModel}
                exclusive
                onChange={(_, val) => { if (val) setAiModel(val); }}
                size="small"
              >
                <ToggleButton value="flash" sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>Flash</ToggleButton>
                <ToggleButton value="pro" sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>Pro</ToggleButton>
              </ToggleButtonGroup>
            }
          />
        </Section>

        <Section title="Account">
          <Row
            label="Email"
            control={
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {user?.email ?? '—'}
              </Typography>
            }
          />
          <Divider sx={{ borderColor: accentBorder }} />
          <Row
            label="Reset password"
            description="We'll send a reset link to your email"
            control={
              <Button
                variant="outlined"
                size="small"
                onClick={handleResetPassword}
                disabled={resetLoading}
                sx={{ fontSize: 11, py: 0.5, px: 1.5, minWidth: 80 }}
              >
                {resetLoading ? <CircularProgress size={12} /> : 'Send email'}
              </Button>
            }
          />
          {resetMsg && (
            <Box sx={{ px: 2, pb: 1.5 }}>
              <Alert severity={resetMsg.type} sx={{ fontSize: 11, py: 0.5 }}>{resetMsg.text}</Alert>
            </Box>
          )}
        </Section>
      </Box>
    </Box>
  );
}
