import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type Action, type Role } from '@mediavault/shared';
import { api, ApiError } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null; // signed out is a state, not an error
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useRole(): Role | null {
  const { data } = useMe();
  return data?.workspaces.find((w) => w.id === data.activeWorkspaceId)?.role ?? null;
}

/** UI hint only: the API enforces the same matrix (from @mediavault/shared) on every request. */
export function useCan(action: Action): boolean {
  const role = useRole();
  return role ? can(role, action) : false;
}

export function useSignedIn() {
  const qc = useQueryClient();
  return (me: Awaited<ReturnType<typeof api.me>>) => {
    qc.clear();
    qc.setQueryData(['me'], me);
  };
}
