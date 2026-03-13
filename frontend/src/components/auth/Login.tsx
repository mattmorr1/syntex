import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Link,
  Alert,
  CircularProgress,
  InputAdornment,
  IconButton,
  Divider,
} from '@mui/material';
import { Visibility, VisibilityOff, Google, ArrowBack } from '@mui/icons-material';
import { useAuth } from '../../hooks/useAuth';

export function Login() {
  const { login, loginWithGoogle, isFirebaseEnabled } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [needsInvite, setNeedsInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (withInvite = false) => {
    setError('');
    setGoogleLoading(true);
    
    try {
      await loginWithGoogle(withInvite ? inviteCode : undefined);
    } catch (err: any) {
      if (err.message === 'INVITE_REQUIRED') {
        setNeedsInvite(true);
        setError('New account - please enter an invite code');
      } else {
        setError(err.message || 'Google login failed');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    await handleGoogleLogin(true);
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
            <img src="/syntex.svg" alt="syntex" style={{ width: 24, height: 24 }} />
            <Typography variant="h5" fontWeight={600}>
              syntex
            </Typography>
          </Box>
          <Typography color="text.secondary" textAlign="center" mb={4} sx={{ fontSize: 13 }}>
            AI-Powered LaTeX Editor
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>{error}</Alert>}

          {needsInvite ? (
            <Box component="form" onSubmit={handleInviteSubmit}>
              <Button
                startIcon={<ArrowBack sx={{ fontSize: 14 }} />}
                onClick={() => { setNeedsInvite(false); setError(''); setInviteCode(''); }}
                sx={{ mb: 2, p: 0, fontSize: 12 }}
                size="small"
              >
                Back
              </Button>

              <Typography sx={{ mb: 2, fontSize: 12, color: 'text.secondary' }}>
                Enter your invite code to create an account with Google
              </Typography>

              <TextField
                fullWidth
                label="Invite Code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                required
                placeholder="Enter your invite code"
                sx={{ mb: 2 }}
                inputProps={{ style: { textTransform: 'uppercase', letterSpacing: 2 } }}
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={googleLoading || !inviteCode.trim()}
                startIcon={googleLoading ? <CircularProgress size={18} /> : <Google />}
              >
                Continue with Google
              </Button>
            </Box>
          ) : (
            <>
              {isFirebaseEnabled && (
                <>
                  <Button
                    fullWidth
                    variant="outlined"
                    size="large"
                    startIcon={googleLoading ? <CircularProgress size={18} /> : <Google />}
                    onClick={() => handleGoogleLogin(false)}
                    disabled={googleLoading || loading}
                    sx={{ mb: 2 }}
                  >
                    Continue with Google
                  </Button>

                  <Divider sx={{ my: 2 }}>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>or</Typography>
                  </Divider>
                </>
              )}

              <Box component="form" onSubmit={handleSubmit}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  sx={{ mb: 2 }}
                />

                <TextField
                  fullWidth
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  sx={{ mb: 1 }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small">
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <Box sx={{ mb: 3, textAlign: 'right' }}>
                  <Link component={RouterLink} to="/reset-password" sx={{ fontSize: 12 }}>
                    Forgot password?
                  </Link>
                </Box>

                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  size="large"
                  disabled={loading || googleLoading}
                  sx={{ mb: 2 }}
                >
                  {loading ? <CircularProgress size={20} /> : 'Sign In'}
                </Button>

                <Typography sx={{ fontSize: 13, textAlign: 'center' }}>
                  Don't have an account?{' '}
                  <Link component={RouterLink} to="/register">
                    Sign up
                  </Link>
                </Typography>
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
