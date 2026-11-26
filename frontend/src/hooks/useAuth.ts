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

  // Blocking-function denials surface as a FirebaseError whose message carries our INVITE_REQUIRED marker.
  const asInviteError = (err: any) =>
    String(err?.message).includes('INVITE_REQUIRED') || err?.detail?.code === 'not_invited' ? new Error('INVITE_REQUIRED') : err;

  const login = useCallback(async (email: string, password: string) => {
    if (firebaseEnabled) {
      setToken(await loginWithEmail(email, password));
      setUser((await api.provision()).user);
    } else {
      const response = await api.login(email, password);
      setToken(response.token);
      setUser(response.user);
    }
    navigate('/');
  }, [navigate, setToken, setUser]);

  const register = useCallback(async (email: string, password: string, username: string, inviteCode?: string) => {
    if (!firebaseEnabled) {
      const response = await api.register(email, password, username, inviteCode);
      setToken(response.token);
      setUser(response.user);
      navigate('/');
      return;
    }
    if (inviteCode) await api.redeemInvite(inviteCode, email);
    try {
      setToken(await registerWithEmail(email, password));
      setUser((await api.provision(username)).user);
    } catch (err) {
      throw asInviteError(err);
    }
    navigate('/');
  }, [navigate, setToken, setUser]);

  const loginWithGoogle = useCallback(async (inviteCode?: string, inviteEmail?: string) => {
    if (!firebaseEnabled) throw new Error('Firebase not configured');
    if (inviteCode && inviteEmail) await api.redeemInvite(inviteCode, inviteEmail);
    try {
      const { token: idToken, user: fbUser } = await firebaseGoogleLogin();
      if (inviteEmail && fbUser.email?.toLowerCase() !== inviteEmail.trim().toLowerCase()) {
        await logoutFirebase();
        throw new Error(`Signed in as ${fbUser.email}, but the invite was redeemed for ${inviteEmail}. Pick that Google account.`);
      }
      setToken(idToken);
      setUser((await api.provision()).user);
      navigate('/');
    } catch (err) {
      throw asInviteError(err);
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
