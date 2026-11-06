import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { clearAuthenticatedCache, apiRequest } from "../../lib/api";
export function LogoutButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({ mutationFn: () => apiRequest<void>("/api/v1/auth/logout", { method: "POST" }), onSuccess: () => { clearAuthenticatedCache(queryClient); navigate("/login", { replace: true }); } });
  return <><button className={className} type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing out…" : "Sign out"}</button>{logout.error && <span className="nav-logout-error" role="alert">{logout.error.message} You are still signed in.</span>}</>;
}
