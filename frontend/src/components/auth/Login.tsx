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
          <Typography variant="h4" fontWeight={600} textAlign="center" mb={1}>
            AI LaTeX Editor
          </Typography>
          <Typography color="text.secondary" textAlign="center" mb={4}>
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          {needsInvite ? (
            <Box component="form" onSubmit={handleInviteSubmit}>
              <Button
                startIcon={<ArrowBack />}
                onClick={() => { setNeedsInvite(false); setError(''); setInviteCode(''); }}
                sx={{ mb: 2, p: 0 }}
                size="small"
              >
                Back
              </Button>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
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
                startIcon={googleLoading ? <CircularProgress size={20} /> : <Google />}
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
                    startIcon={googleLoading ? <CircularProgress size={20} /> : <Google />}
                    onClick={() => handleGoogleLogin(false)}
                    disabled={googleLoading || loading}
                    sx={{ mb: 2 }}
                  >
                    Continue with Google
                  </Button>

                  <Divider sx={{ my: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      or
                    </Typography>
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
                        <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <Box sx={{ mb: 3, textAlign: 'right' }}>
                  <Link component={RouterLink} to="/reset-password" variant="body2">
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
                  {loading ? <CircularProgress size={24} /> : 'Sign In'}
                </Button>

                <Typography variant="body2" textAlign="center">
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
