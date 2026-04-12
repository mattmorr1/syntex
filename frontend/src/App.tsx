import { useMemo, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Box, CircularProgress } from '@mui/material';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { firebaseEnabled, onAuthChange } from './services/firebase';
import { darkTheme, lightTheme } from './themes/theme';

import { Layout } from './components/common/Layout';
import { Login } from './components/auth/Login';
import { Register } from './components/auth/Register';
import { ResetPassword } from './components/auth/ResetPassword';
import { Home } from './components/Home';
import { Editor } from './components/editor/Editor';
import { AdminDashboard } from './components/admin/Dashboard';
import { Settings } from './components/settings/Settings';

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
  
  if (!isAuthenticated || !user) {
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

  // Sync Firebase auth state → clear stale localStorage session on sign-out
  useEffect(() => {
    if (!firebaseEnabled) return;
    const unsubscribe = onAuthChange((firebaseUser) => {
      if (!firebaseUser) {
        const store = useAuthStore.getState();
        if (store.isAuthenticated) store.logout();
      }
    });
    return unsubscribe;
  }, []);

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
        
        <Route path="/settings" element={
          <ProtectedRoute>
            <Settings />
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
