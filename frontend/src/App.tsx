import { useMemo, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Box, CircularProgress } from '@mui/material';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { darkTheme, lightTheme } from './themes/theme';
import { onAuthChange, refreshToken, firebaseEnabled } from './services/firebase';

import { Layout } from './components/common/Layout';
import { Login } from './components/auth/Login';
import { Register } from './components/auth/Register';
import { ResetPassword } from './components/auth/ResetPassword';
import { Home } from './components/Home';
import { Editor } from './components/editor/Editor';
import { AdminDashboard } from './components/admin/Dashboard';

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { isAuthenticated, user, isHydrated } = useAuthStore();

  // Wait for hydration before redirecting
  if (!isHydrated) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function App() {
  const { mode } = useThemeStore();
  const theme = useMemo(() => (mode === 'dark' ? darkTheme : lightTheme), [mode]);
  const { isHydrated } = useAuthStore();
  const [authReady, setAuthReady] = useState(!firebaseEnabled); // Skip if no Firebase

  // Sync Firebase auth state with our store on app start
  useEffect(() => {
    if (!firebaseEnabled || !isHydrated) return;

    const unsubscribe = onAuthChange(async (firebaseUser) => {
      const { setToken, logout, isAuthenticated } = useAuthStore.getState();

      if (firebaseUser) {
        // Firebase has a user - refresh the token to ensure it's valid
        try {
          const newToken = await refreshToken();
          if (newToken) {
            setToken(newToken);
          }
        } catch (err) {
          // Token refresh failed - force logout
          console.error('Token refresh failed:', err);
          logout();
        }
      } else if (isAuthenticated) {
        // Firebase has no user but store thinks we're logged in
        // This happens when Firebase session expired - force logout
        logout();
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [isHydrated]); // Only re-run when hydration completes

  // Show loading while checking auth
  if (!authReady && firebaseEnabled) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        
        <Route path="/" element={
          <ProtectedRoute>
            <Layout><Home /></Layout>
          </ProtectedRoute>
        } />
        
        <Route path="/editor/:projectId?" element={
          <ProtectedRoute>
            <Editor />
          </ProtectedRoute>
        } />
        
        <Route path="/history" element={<Navigate to="/" replace />} />
        
        <Route path="/admin" element={
          <ProtectedRoute adminOnly>
            <Layout><AdminDashboard /></Layout>
          </ProtectedRoute>
        } />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}

export default App;
