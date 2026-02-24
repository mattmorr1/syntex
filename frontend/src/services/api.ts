import { useAuthStore } from '../store/authStore';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(error.detail || 'Request failed');
  }

  return response.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, username: string, inviteCode?: string) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, invite_code: inviteCode }),
    }),

  googleAuth: (idToken: string, inviteCode?: string) =>
    request<{ token: string; user: any }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken, invite_code: inviteCode }),
    }),

  resetPassword: (email: string) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // Projects
  getProjects: async () => {
    const projects = await request<any[]>('/projects');
    return projects.map(p => ({
      ...p,
      createdAt: p.created_at || p.createdAt || '',
      updatedAt: p.updated_at || p.updatedAt || p.created_at || p.createdAt || '',
      mainFile: p.main_file || p.mainFile,
      customTheme: p.custom_theme || p.customTheme,
    }));
  },

  getProject: async (id: string) => {
    const p = await request<any>(`/projects/${id}`);
    return {
      ...p,
      createdAt: p.created_at || p.createdAt || '',
      updatedAt: p.updated_at || p.updatedAt || p.created_at || p.createdAt || '',
      mainFile: p.main_file || p.mainFile,
      customTheme: p.custom_theme || p.customTheme,
    };
  },
  
  createProject: (data: { name: string; theme: string; customTheme?: string }) =>
    request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  
  saveProject: (id: string, files: any[]) =>
    request<any>(`/projects/save-project`, {
      method: 'POST',
      body: JSON.stringify({ project_id: id, files }),
    }),

  deleteProject: (id: string) =>
    request<void>(`/projects/delete-project/${id}`, { method: 'DELETE' }),

  duplicateProject: (id: string) =>
    request<any>(`/projects/duplicate-project/${id}`, { method: 'POST' }),
  
  renameProject: (id: string, name: string) =>
    request<{ message: string; name: string }>(`/projects/${id}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  // Compile
  compile: (projectId: string, mainFile: string, files: any[]) =>
    request<{ pdf_url: string }>('/compile', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, main_file: mainFile, files }),
    }),

  // AI
  autocomplete: (context: string, cursor: number, fileName: string, signal?: AbortSignal) =>
    request<{ suggestion: string; tokens: number }>('/ai/autocomplete', {
      method: 'POST',
      body: JSON.stringify({ context, cursor_position: cursor, file_name: fileName }),
      signal,
    }),

  chat: (projectId: string, message: string, context: string, model?: string) =>
    request<{ response: string; tokens: number }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, message, context, model }),
    }),

  agentEdit: (
    projectId: string,
    instruction: string,
    document: string,
    model?: string,
    selection?: { text: string; start_line: number; end_line: number },
  ) =>
    request<{
      explanation: string;
      changes: Array<{
        start_line: number;
        end_line: number;
        original: string;
        replacement: string;
        reason: string;
      }>;
      tokens: number;
    }>('/ai/agent-edit', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, instruction, document, model, selection }),
    }),

  agentEditStream: async (
    projectId: string,
    instruction: string,
    document: string,
    model?: string,
    selection?: { text: string; start_line: number; end_line: number },
    onChunk?: (text: string) => void,
    onResult?: (data: { explanation: string; changes: any[]; tokens: number }) => void,
    onError?: (message: string) => void,
  ) => {
    const token = useAuthStore.getState().token;
    const response = await fetch(`${API_BASE}/ai/agent-edit/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ project_id: projectId, instruction, document, model, selection }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || 'Request failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'chunk') onChunk?.(parsed.text);
            else if (parsed.type === 'result') onResult?.(parsed);
            else if (parsed.type === 'error') onError?.(parsed.message);
          } catch {
            // skip malformed chunks
          }
        }
      }
    }
  },

  getChatHistory: (projectId: string) =>
    request<any[]>(`/ai/chat-history?project_id=${projectId}`),

  // Admin
  getUsers: () => request<any[]>('/admin/users'),
  
  getStats: () => request<any>('/admin/stats'),
  
  resetUserTokens: (uid: string) =>
    request<void>(`/admin/user/${uid}/reset-tokens`, { method: 'POST' }),
  
  deleteUser: (uid: string) =>
    request<void>(`/admin/user/${uid}`, { method: 'DELETE' }),

  // Invites
  getInvites: () => request<any[]>('/admin/invites'),
  
  createInvite: (uses: number = 1) =>
    request<any>('/admin/invites', { method: 'POST', body: JSON.stringify({ uses }) }),
  
  deactivateInvite: (code: string) =>
    request<void>(`/admin/invites/${code}`, { method: 'DELETE' }),

  // Upload
  uploadFile: async (file: File, theme: string, customTheme?: string) => {
    const token = useAuthStore.getState().token;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('theme', theme);
    if (customTheme) formData.append('custom_theme', customTheme);

    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || 'Upload failed');
    }

    return response.json();
  },
};
