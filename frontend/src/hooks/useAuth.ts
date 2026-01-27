import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import { 
  firebaseEnabled, 
  loginWithEmail, 
  registerWithEmail, 
  loginWithGoogle as firebaseGoogleLogin,
  logoutFirebase,
  resetPassword as firebaseResetPassword
} from '../services/firebase';

export function useAuth() {
  const navigate = useNavigate();
  const { user, token, isAuthenticated, setUser, setToken, logout: clearAuth } = useAuthStore();

  const login = useCallback(async (email: string, password: string) => {
    if (firebaseEnabled) {
      const idToken = await loginWithEmail(email, password);
      setToken(idToken);
      const response = await api.login(email, password);
      setUser(response.user);
    } else {
      const response = await api.login(email, password);
      setToken(response.token);
      setUser(response.user);
    }
    navigate('/');
  }, [navigate, setToken, setUser]);

  const register = useCallback(async (email: string, password: string, username: string, inviteCode?: string) => {
    if (firebaseEnabled) {
      const idToken = await registerWithEmail(email, password);
      setToken(idToken);
      const response = await api.register(email, password, username, inviteCode);
      setUser(response.user);
    } else {
      const response = await api.register(email, password, username, inviteCode);
      setToken(response.token);
      setUser(response.user);
    }
    navigate('/');
  }, [navigate, setToken, setUser]);

  const loginWithGoogle = useCallback(async (inviteCode?: string) => {
    if (!firebaseEnabled) {
      throw new Error('Firebase not configured');
    }
    
    const { token: idToken, user: firebaseUser } = await firebaseGoogleLogin();
    setToken(idToken);
    
    try {
      const response = await api.googleAuth(idToken, inviteCode);
      setUser(response.user);
      navigate('/');
    } catch (err: any) {
      // If invite code required, throw with specific message
      if (err.message?.includes('Invite code required')) {
        throw new Error('INVITE_REQUIRED');
      }
      throw err;
    }
  }, [navigate, setToken, setUser]);

  const logout = useCallback(async () => {
    if (firebaseEnabled) {
      await logoutFirebase();
    }
    clearAuth();
    navigate('/login');
  }, [clearAuth, navigate]);

  const resetPassword = useCallback(async (email: string) => {
    if (firebaseEnabled) {
      await firebaseResetPassword(email);
    } else {
      await api.resetPassword(email);
    }
  }, []);

  return {
    user,
    token,
    isAuthenticated,
    isAdmin: user?.role === 'admin',
    isFirebaseEnabled: firebaseEnabled,
    login,
    register,
    loginWithGoogle,
    logout,
    resetPassword,
  };
}
