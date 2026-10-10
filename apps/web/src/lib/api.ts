import type { AssetDto, MeDto, Page, Role, AllowedMime } from '@mediavault/shared';

/** The API is always same-origin under /api (Vite proxy in dev, host rewrite in production). */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init, headers });
  } catch {
    throw new ApiError(0, 'network_error', 'Can’t reach MediaVault. Check your connection and try again.');
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: JSON.stringify(body ?? {}) });

export interface Collection {
  id: string;
  name: string;
  count: number;
  coverUrl: string | null;
}
export interface Usage {
  name: string;
  isDemo: boolean;
  storageBytes: number;
  quotaBytes: number;
  counts: Partial<Record<'image' | 'video' | 'document', number>>;
  trashed: number;
  role: Role;
}
export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}
export interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}
export interface Share {
  id: string;
  target: string;
  assetId: string | null;
  collectionId: string | null;
  allowDownload: boolean;
  expiresAt: string;
  viewCount: number;
  createdAt: string;
}
export interface AuditEvent {
  id: number;
  action: string;
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
  expiresAt: number;
}
export interface PublicShare {
  title: string;
  sharedBy: string;
  expiresAt: string;
  allowDownload: boolean;
  items: {
    id: string;
    title: string;
    kind: string;
    width: number | null;
    height: number | null;
    dominantColor: string | null;
    thumbUrl: string | null;
    previewUrl: string | null;
    downloadUrl: string | null;
  }[];
}

export interface AssetQuery {
  q?: string;
  kind?: string;
  tag?: string;
  collectionId?: string;
  trashed?: boolean;
}

export const api = {
  me: () => request<MeDto>('/auth/me'),
  signIn: (email: string, password: string) => request<MeDto>('/auth/sign-in', json('POST', { email, password })),
  signUp: (b: { name: string; email: string; password: string; workspaceName: string }) => request<MeDto>('/auth/sign-up', json('POST', b)),
  demo: () => request<MeDto>('/auth/demo', json('POST')),
  signOut: () => request('/auth/sign-out', json('POST')),
  switchWorkspace: (workspaceId: string) => request<MeDto>('/workspaces/switch', json('POST', { workspaceId })),

  assets: (q: AssetQuery, cursor?: string | null) => {
    const p = new URLSearchParams({ limit: '60' });
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
    if (cursor) p.set('cursor', cursor);
    return request<Page<AssetDto>>(`/assets?${p}`);
  },
  asset: (id: string) => request<AssetDto>(`/assets/${id}`),
  updateAsset: (id: string, patch: { title?: string; description?: string; tags?: string[] }) => request<AssetDto>(`/assets/${id}`, json('PATCH', patch)),
  trash: (ids: string[]) => request<{ trashed: string[] }>('/assets/trash', json('POST', { ids })),
  restore: (id: string) => request(`/assets/${id}/restore`, json('POST')),
  purge: (id: string) => request(`/assets/${id}`, { method: 'DELETE' }),
  download: (id: string) => request<{ url: string }>(`/assets/${id}/download`),
  usage: () => request<Usage>('/workspace/usage'),
  startUpload: (fileName: string, contentType: AllowedMime, size: number) =>
    request<{ assetId: string; upload: UploadTicket }>('/assets/uploads', json('POST', { fileName, contentType, size })),
  completeUpload: (id: string) => request<AssetDto>(`/assets/${id}/complete`, json('POST')),

  collections: () => request<Collection[]>('/collections'),
  createCollection: (name: string) => request<Collection>('/collections', json('POST', { name })),
  addToCollection: (id: string, assetIds: string[]) => request<{ added: number }>(`/collections/${id}/assets`, json('POST', { assetIds })),
  removeFromCollection: (id: string, assetId: string) => request(`/collections/${id}/assets/${assetId}`, { method: 'DELETE' }),
  deleteCollection: (id: string) => request(`/collections/${id}`, { method: 'DELETE' }),

  shares: () => request<Share[]>('/shares'),
  createShare: (b: { assetId?: string; collectionId?: string; expiresInHours: number; allowDownload: boolean }) =>
    request<{ url: string; expiresAt: string }>('/shares', json('POST', b)),
  revokeShare: (id: string) => request(`/shares/${id}`, { method: 'DELETE' }),
  publicShare: (token: string) => request<PublicShare>(`/public/shares/${token}`),

  members: () => request<Member[]>('/members'),
  invites: () => request<Invite[]>('/invites'),
  invite: (email: string, role: Role) => request<{ url: string; expiresAt: string }>('/invites', json('POST', { email, role })),
  cancelInvite: (id: string) => request(`/invites/${id}`, { method: 'DELETE' }),
  changeRole: (userId: string, role: Role) => request(`/members/${userId}`, json('PATCH', { role })),
  removeMember: (userId: string) => request(`/members/${userId}`, { method: 'DELETE' }),
  audit: (before?: number) => request<{ items: AuditEvent[]; nextBefore: number | null }>(`/audit${before ? `?before=${before}` : ''}`),
  invitePreview: (token: string) => request<{ workspaceName: string; email: string; role: Role; hasAccount: boolean }>(`/public/invites/${token}`),
  acceptInvite: (b: { token: string; name?: string; password?: string }) => request<{ workspaceId: string }>('/public/invites/accept', json('POST', b)),
};

/** Upload straight to storage with progress (fetch can't report upload progress; XHR can). */
export function uploadToStorage(ticket: UploadTicket, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(ticket.fields)) form.append(k, v);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ticket.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'upload_failed', 'The upload was rejected by storage.')));
    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'The upload was interrupted.'));
    xhr.send(form);
  });
}

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
};

export const formatDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

export const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return formatDate(iso);
};
