import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

export function useAuth() {
  const navigate = useNavigate();
  const { user, token, isAuthenticated, setUser, setToken, logout: clearAuth } = useAuthStore();

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    setToken(response.token);
    setUser(response.user);
    navigate('/');
  }, [navigate, setToken, setUser]);

  const register = useCallback(async (email: string, password: string, username: string) => {
    const response = await api.register(email, password, username);
    setToken(response.token);
    setUser(response.user);
    navigate('/');
  }, [navigate, setToken, setUser]);

  const logout = useCallback(() => {
    clearAuth();
    navigate('/login');
  }, [clearAuth, navigate]);

  const resetPassword = useCallback(async (email: string) => {
    await api.resetPassword(email);
  }, []);

  return {
    user,
    token,
    isAuthenticated,
    isAdmin: user?.role === 'admin',
    login,
    register,
    logout,
    resetPassword,
  };
}
