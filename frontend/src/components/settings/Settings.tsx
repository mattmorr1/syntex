import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SyntexLogo from '../common/SyntexLogo';
import {
  Box,
  Typography,
  Alert,
  Button,
  ToggleButtonGroup,
  ToggleButton,
  CircularProgress,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Chip,
} from '@mui/material';
import {
  DarkMode,
  LightMode,
  ArrowBack,
  Visibility,
  VisibilityOff,
  CheckCircle,
  Delete,
} from '@mui/icons-material';
import { useThemeStore } from '../../store/themeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';

const PROVIDERS = [
  { id: 'gemini',    label: 'Gemini',    note: 'Uses system key — no key required' },
  { id: 'openai',    label: 'OpenAI',    note: 'Requires your OpenAI API key' },
  { id: 'anthropic', label: 'Anthropic', note: 'Requires your Anthropic API key' },
  { id: 'mistral',   label: 'Mistral',   note: 'Requires your Mistral API key' },
];

export function Settings() {
  const navigate = useNavigate();
  const { mode, toggleTheme } = useThemeStore();
  const { aiModel, setAiModel, generationMaxTokens, setGenerationMaxTokens, preferredProvider, setPreferredProvider } = useSettingsStore();
  const { user, resetPassword } = useAuth();

  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Provider state
  const [providerMsg, setProviderMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savedProviders, setSavedProviders] = useState<Record<string, boolean>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [keyLoading, setKeyLoading] = useState<Record<string, boolean>>({});

  const isDark = mode === 'dark';
  const purpleBorder = isDark ? '#262626' : '#e4e4e7';
  const accentBorder = isDark ? '#2d2d2d' : '#e4e4e7';
  const surfaceBg = isDark ? '#121212' : '#ffffff';

  useEffect(() => {
    api.getSettings().then(s => {
      setSavedProviders(s.providers_configured || {});
      if (s.preferred_provider) {
        setPreferredProvider(s.preferred_provider);
      }
    }).catch(() => {});
  }, []);

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

  const handleSaveKey = async (provider: string) => {
    const key = keyInputs[provider]?.trim();
    if (!key) return;
    setKeyLoading(p => ({ ...p, [provider]: true }));
    setProviderMsg(null);
    try {
      await api.saveProviderKey(provider, key);
      setSavedProviders(p => ({ ...p, [provider]: true }));
      setKeyInputs(p => ({ ...p, [provider]: '' }));
      setProviderMsg({ type: 'success', text: `${provider} API key saved` });
    } catch (err: any) {
      setProviderMsg({ type: 'error', text: err.message || 'Failed to save key' });
    } finally {
      setKeyLoading(p => ({ ...p, [provider]: false }));
    }
  };

  const handleRemoveKey = async (provider: string) => {
    setKeyLoading(p => ({ ...p, [provider]: true }));
    setProviderMsg(null);
    try {
      await api.removeProviderKey(provider);
      setSavedProviders(p => ({ ...p, [provider]: false }));
      setProviderMsg({ type: 'success', text: `${provider} API key removed` });
    } catch (err: any) {
      setProviderMsg({ type: 'error', text: err.message || 'Failed to remove key' });
    } finally {
      setKeyLoading(p => ({ ...p, [provider]: false }));
    }
  };

  const handleSelectProvider = async (provider: string) => {
    setPreferredProvider(provider);
    try {
      await api.setPreferredProvider(provider);
    } catch {
      // best-effort
    }
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary', mb: 1.5 }}>
        {title}
      </Typography>
      <Box sx={{ bgcolor: surfaceBg, border: `1px solid ${accentBorder}`, borderRadius: '10px', overflow: 'hidden' }}>
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
        {description && <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>{description}</Typography>}
      </Box>
      {control}
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box sx={{ height: 40, borderBottom: `1px solid ${purpleBorder}`, display: 'flex', alignItems: 'center', px: 2, gap: 1.5 }}>
        <Tooltip title="Back">
          <IconButton size="small" onClick={() => navigate(-1)} sx={{ p: 0.5 }}>
            <ArrowBack sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SyntexLogo size="sm" />
          <Typography sx={{ fontWeight: 600, fontSize: 12 }}>syntex</Typography>
        </Box>
        <Box sx={{ width: '1px', height: '16px', bgcolor: accentBorder }} />
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
              <ToggleButtonGroup value={mode} exclusive onChange={(_, val) => { if (val && val !== mode) toggleTheme(); }} size="small">
                <ToggleButton value="dark" sx={{ px: 1.5, py: 0.5, gap: 0.5, fontSize: 11 }}><DarkMode sx={{ fontSize: 14 }} /> Dark</ToggleButton>
                <ToggleButton value="light" sx={{ px: 1.5, py: 0.5, gap: 0.5, fontSize: 11 }}><LightMode sx={{ fontSize: 14 }} /> Light</ToggleButton>
              </ToggleButtonGroup>
            }
          />
        </Section>

        <Section title="AI Model">
          <Row
            label="Default model"
            description="Flash is faster; Pro is more capable for complex documents"
            control={
              <ToggleButtonGroup value={aiModel} exclusive onChange={(_, val) => { if (val) setAiModel(val); }} size="small">
                <ToggleButton value="flash" sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>Flash</ToggleButton>
                <ToggleButton value="pro" sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>Pro</ToggleButton>
              </ToggleButtonGroup>
            }
          />
          <Row
            label="Generation max tokens"
            description="Maximum output length for document generation"
            control={
              <ToggleButtonGroup value={generationMaxTokens} exclusive onChange={(_, val) => { if (val) setGenerationMaxTokens(val); }} size="small">
                <ToggleButton value={8192} sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>8k</ToggleButton>
                <ToggleButton value={32768} sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>32k</ToggleButton>
                <ToggleButton value={65536} sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>65k</ToggleButton>
              </ToggleButtonGroup>
            }
          />
        </Section>

        <Section title="AI Provider">
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
              Select which AI provider powers generation. Add your own API key to use a different provider.
            </Typography>
            <ToggleButtonGroup
              value={preferredProvider}
              exclusive
              onChange={(_, val) => { if (val) handleSelectProvider(val); }}
              size="small"
              sx={{ mb: 2, flexWrap: 'wrap', gap: 0.5 }}
            >
              {PROVIDERS.map(p => (
                <ToggleButton key={p.id} value={p.id} sx={{ px: 1.5, py: 0.5, fontSize: 11 }}>
                  {p.label}
                  {savedProviders[p.id] && p.id !== 'gemini' && (
                    <CheckCircle sx={{ fontSize: 11, ml: 0.5, color: 'success.main' }} />
                  )}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            {PROVIDERS.filter(p => p.id !== 'gemini').map(p => (
              <Box key={p.id} sx={{ mb: 1.5, borderTop: `1px solid ${accentBorder}`, pt: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{p.label} API Key</Typography>
                  {savedProviders[p.id] ? (
                    <Chip label="Saved" size="small" color="success" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                  ) : (
                    <Chip label="Not set" size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                  )}
                </Box>
                {savedProviders[p.id] ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={keyLoading[p.id] ? <CircularProgress size={10} /> : <Delete sx={{ fontSize: 14 }} />}
                    onClick={() => handleRemoveKey(p.id)}
                    disabled={keyLoading[p.id]}
                    sx={{ fontSize: 11, py: 0.5, px: 1.5 }}
                  >
                    Remove key
                  </Button>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      size="small"
                      placeholder={`${p.label} API key`}
                      type={showKey[p.id] ? 'text' : 'password'}
                      value={keyInputs[p.id] || ''}
                      onChange={e => setKeyInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(p.id); }}
                      sx={{ flex: 1, fontSize: 12 }}
                      InputProps={{
                        sx: { fontSize: 12 },
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton size="small" onClick={() => setShowKey(prev => ({ ...prev, [p.id]: !prev[p.id] }))}>
                              {showKey[p.id] ? <VisibilityOff sx={{ fontSize: 14 }} /> : <Visibility sx={{ fontSize: 14 }} />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => handleSaveKey(p.id)}
                      disabled={!keyInputs[p.id]?.trim() || keyLoading[p.id]}
                      sx={{ fontSize: 11, py: 0.5, px: 1.5, minWidth: 60 }}
                    >
                      {keyLoading[p.id] ? <CircularProgress size={12} /> : 'Save'}
                    </Button>
                  </Box>
                )}
              </Box>
            ))}

            {providerMsg && (
              <Alert severity={providerMsg.type} sx={{ fontSize: 11, py: 0.5, mt: 1 }}>{providerMsg.text}</Alert>
            )}
          </Box>
        </Section>

        <Section title="Account">
          <Row
            label="Email"
            control={<Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{user?.email ?? '—'}</Typography>}
          />
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
