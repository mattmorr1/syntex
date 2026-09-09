import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import SyntexLogo from '../common/SyntexLogo';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Alert,
  Link,
  CircularProgress,
} from '@mui/material';
import { api } from '../../services/api';

export function RequestAccess() {
  const [form, setForm] = useState({ name: '', email: '', institution: '', use_case: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.institution.trim() || !form.use_case.trim()) {
      setError('All fields are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.requestAccess(form);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', px: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 440 }} elevation={0} variant="outlined">
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
            <SyntexLogo size="sm" />
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>syntex</Typography>
          </Box>

          {submitted ? (
            <Box>
              <Alert severity="success" sx={{ mb: 2 }}>
                Your request has been submitted. We'll email you at <strong>{form.email}</strong> once it's reviewed.
              </Alert>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>
                <Link component={RouterLink} to="/login" sx={{ fontSize: 12 }}>Back to sign in</Link>
              </Typography>
            </Box>
          ) : (
            <Box component="form" onSubmit={handleSubmit}>
              <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 0.5 }}>Request Access</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2.5 }}>
                Tell us a bit about yourself and how you plan to use Syntex.
              </Typography>

              {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>{error}</Alert>}

              <TextField
                label="Full name"
                fullWidth
                size="small"
                value={form.name}
                onChange={handleChange('name')}
                sx={{ mb: 1.5 }}
                InputLabelProps={{ sx: { fontSize: 13 } }}
                inputProps={{ style: { fontSize: 13 } }}
              />
              <TextField
                label="Email address"
                type="email"
                fullWidth
                size="small"
                value={form.email}
                onChange={handleChange('email')}
                sx={{ mb: 1.5 }}
                InputLabelProps={{ sx: { fontSize: 13 } }}
                inputProps={{ style: { fontSize: 13 } }}
              />
              <TextField
                label="Institution / Organisation"
                fullWidth
                size="small"
                value={form.institution}
                onChange={handleChange('institution')}
                sx={{ mb: 1.5 }}
                InputLabelProps={{ sx: { fontSize: 13 } }}
                inputProps={{ style: { fontSize: 13 } }}
              />
              <TextField
                label="How do you plan to use Syntex?"
                fullWidth
                size="small"
                multiline
                rows={3}
                value={form.use_case}
                onChange={handleChange('use_case')}
                sx={{ mb: 2 }}
                InputLabelProps={{ sx: { fontSize: 13 } }}
                inputProps={{ style: { fontSize: 13 } }}
              />

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={loading}
                sx={{ mb: 2, fontSize: 13, py: 1 }}
              >
                {loading ? <CircularProgress size={18} color="inherit" /> : 'Submit Request'}
              </Button>

              <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>
                Already have an account?{' '}
                <Link component={RouterLink} to="/login" sx={{ fontSize: 12 }}>Sign in</Link>
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
