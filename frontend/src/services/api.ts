import { useAuthStore } from '../store/authStore';
import { firebaseEnabled, getCurrentToken } from './firebase';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let token = useAuthStore.getState().token;

  // Always get a fresh Firebase token — Firebase auto-refreshes if expired
  if (firebaseEnabled) {
    const freshToken = await getCurrentToken();
    if (freshToken) {
      token = freshToken;
      useAuthStore.getState().setToken(freshToken);
    }
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    useAuthStore.getState().logout();
    throw new Error('Session expired. Please sign in again.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Request failed' }));
    const detail = body.detail;
    // FastAPI details may be strings or objects; an object stringifies to "[object Object]".
    const message = typeof detail === 'string' ? detail : detail?.message || 'Request failed';
    throw Object.assign(new Error(message), { status: response.status, detail });
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

  // Profile for the already-authenticated caller. Login itself happens against Firebase
  // in the browser; the API only ever sees the resulting ID token.
  me: () => request<any>('/auth/me'),

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
      folder: p.folder || '',
      sortOrder: p.sort_order ?? 0,
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
  
  // baseUpdatedAt is the updated_at this client last saw; the server rejects the write
  // with 409 if the project moved since, rather than silently overwriting another editor.
  saveProject: (id: string, files: any[], baseUpdatedAt?: string) =>
    request<any>(`/projects/save-project`, {
      method: 'POST',
      body: JSON.stringify({ project_id: id, files, base_updated_at: baseUpdatedAt ?? null }),
    }),

  deleteProject: (id: string) =>
    request<void>(`/projects/delete-project/${id}`, { method: 'DELETE' }),

  // One round trip of the collaboration relay: push local updates, pull everyone else's.
  collabSync: (id: string, body: {
    client_id: number;
    since: number;
    update: string | null;
    presence: { name: string; color: string };
  }) =>
    request<{
      now: number;
      seed: boolean;
      snapshot: string | null;
      updates: string[];
      peers: Array<{ clientId: number; name?: string; color?: string }>;
      pending: number;
    }>(`/projects/${id}/collab/sync`, { method: 'POST', body: JSON.stringify(body) }),

  collabSnapshot: (id: string, body: { snapshot: string; up_to: number }) =>
    request<{ saved: boolean }>(`/projects/${id}/collab/snapshot`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  setPlacement: (id: string, placement: { folder?: string; sort_order?: number }) =>
    request<any>(`/projects/${id}/placement`, {
      method: 'PATCH',
      body: JSON.stringify(placement),
    }),

  // Forward search: a source line -> the point in the PDF it produced.
  synctexForward: (pdfId: string, file: string, line: number) =>
    request<{ page: number; x: number; y: number }>(`/synctex/${pdfId}/forward`, {
      method: 'POST',
      body: JSON.stringify({ file, line }),
    }),

  // Backward search: a point in the rendered PDF -> the source file and line that produced it.
  synctex: (pdfId: string, page: number, x: number, y: number) =>
    request<{ file: string; line: number }>(`/synctex/${pdfId}`, {
      method: 'POST',
      body: JSON.stringify({ page, x, y }),
    }),

  duplicateProject: (id: string) =>
    request<any>(`/projects/duplicate-project/${id}`, { method: 'POST' }),
  
  renameProject: (id: string, name: string) =>
    request<{ message: string; name: string }>(`/projects/${id}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  // Compile
  compile: (projectId: string, mainFile: string, files: any[]) =>
    request<{ pdf_url: string | null; error?: string }>('/compile', {
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

  agentEditStream: async (
    projectId: string,
    instruction: string,
    document: string,
    model?: string,
    selection?: { text: string; start_line: number; end_line: number },
    onChunk?: (text: string) => void,
    onResult?: (data: { explanation: string; changes: any[]; tokens: number }) => void,
    onError?: (message: string) => void,
    projectFiles?: Array<{ name: string; content: string; type: string }>,
    fileName?: string,
    cursorLine?: number,
  ) => {
    const token = useAuthStore.getState().token;
    const response = await fetch(`${API_BASE}/ai/agent-edit/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ project_id: projectId, instruction, document, model, selection, project_files: projectFiles, file_name: fileName, cursor_line: cursorLine }),
    });

    if (response.status === 401) {
      useAuthStore.getState().logout();
      throw new Error('Session expired. Please sign in again.');
    }

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

  // Admin
  getUsers: () => request<any[]>('/admin/users'),

  getStats: () => request<any>('/admin/stats'),

  resetUserTokens: (uid: string) =>
    request<void>(`/admin/user/${uid}/reset-tokens`, { method: 'POST' }),

  deleteUser: (uid: string) =>
    request<void>(`/admin/user/${uid}`, { method: 'DELETE' }),

  setUserTokenCap: (uid: string, cap: number) =>
    request<void>(`/admin/user/${uid}/token-cap`, {
      method: 'PATCH',
      body: JSON.stringify({ cap }),
    }),

  // Invites
  getInvites: () => request<any[]>('/admin/invites'),

  createInvite: (uses: number = 1) =>
    request<any>('/admin/invites', { method: 'POST', body: JSON.stringify({ uses }) }),

  deactivateInvite: (code: string) =>
    request<void>(`/admin/invites/${code}`, { method: 'DELETE' }),

  // Access requests
  requestAccess: (data: { name: string; email: string; institution: string; use_case: string }) =>
    fetch(`${API_BASE}/auth/request-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({ detail: 'Request failed' })); throw new Error(e.detail || 'Request failed'); }
      return r.json();
    }),

  getAccessRequests: (status?: string) =>
    request<any[]>(`/admin/access-requests${status ? `?status=${status}` : ''}`),

  approveAccessRequest: (id: string) =>
    request<any>(`/admin/access-requests/${id}/approve`, { method: 'POST' }),

  rejectAccessRequest: (id: string, reason?: string) =>
    request<any>(`/admin/access-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null }),
    }),

  // Provider settings
  getSettings: () => request<{ preferred_provider: string; providers_configured: Record<string, boolean> }>('/auth/settings'),

  saveProviderKey: (provider: string, api_key: string) =>
    request<void>('/auth/settings/provider-key', {
      method: 'PUT',
      body: JSON.stringify({ provider, api_key }),
    }),

  removeProviderKey: (provider: string) =>
    request<void>(`/auth/settings/provider-key/${provider}`, { method: 'DELETE' }),

  setPreferredProvider: (provider: string) =>
    request<void>('/auth/settings/preferred-provider', {
      method: 'PUT',
      body: JSON.stringify({ provider }),
    }),

  // Upload
  uploadFile: async (file: File, theme: string, customTheme?: string, clsContent?: string, maxTokens?: number): Promise<{ project_id: string; tokens_used: number; missing_images: string[]; truncated: boolean; source_chars_used: number }> => {
    let token = useAuthStore.getState().token;
    if (firebaseEnabled) {
      const fresh = await getCurrentToken();
      if (fresh) { token = fresh; useAuthStore.getState().setToken(fresh); }
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('theme', theme);
    if (customTheme) formData.append('custom_theme', customTheme);
    if (clsContent) formData.append('custom_cls', clsContent);
    if (maxTokens) formData.append('max_tokens', String(maxTokens));

    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || 'Upload failed');
    }

    const data = await response.json();
    return { ...data, missing_images: data.missing_images || [] };
  },

  downloadPdf: async (projectId: string, fileName: string): Promise<void> => {
    let token = useAuthStore.getState().token;
    if (firebaseEnabled) {
      const fresh = await getCurrentToken();
      if (fresh) { token = fresh; useAuthStore.getState().setToken(fresh); }
    }
    const response = await fetch(`${API_BASE}/download-pdf/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  addProjectImages: async (projectId: string, images: File[]): Promise<{ added: string[] }> => {
    let token = useAuthStore.getState().token;
    if (firebaseEnabled) {
      const fresh = await getCurrentToken();
      if (fresh) { token = fresh; useAuthStore.getState().setToken(fresh); }
    }
    const formData = new FormData();
    for (const img of images) {
      formData.append('images', img);
    }
    const response = await fetch(`${API_BASE}/projects/${projectId}/add-images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || 'Image upload failed');
    }
    return response.json();
  },
};
