import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ErrorAlert, Field } from "../../components/ui";
import { apiRequest, clearAuthenticatedCache } from "../../lib/api";
import { saveBookingSelection } from "../booking/selection";

const AuthResult = z.object({ data: z.object({ user: z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.enum(["GUEST", "STAFF"]) }) }), requestId: z.string() });
export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [errorMessage, setErrorMessage] = useState("");
  const mutation = useMutation({ mutationFn: async () => AuthResult.parse(await apiRequest<unknown>(`/api/v1/auth/${mode}`, { method: "POST", body: mode === "register" ? { name, email, password } : { email, password } })) });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setErrorMessage("");
    try {
      const result = await mutation.mutateAsync();
      clearAuthenticatedCache(queryClient);
      const returnTo = params.get("returnTo");
      navigate(returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : result.data.user.role === "STAFF" ? "/staff" : "/rooms", { replace: true });
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "We could not sign you in."); }
  }
  return <section>
    <h2>{mode === "login" ? "Sign in" : "Create your guest account"}</h2>
    {errorMessage && <ErrorAlert>{errorMessage}</ErrorAlert>}
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      {mode === "register" && <Field label="Name"><input autoComplete="name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></Field>}
      <Field label="Email"><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <Field label="Password"><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      <button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
    <p>{mode === "login" ? "New here?" : "Already have an account?"} <Link to={`/${mode === "login" ? "register" : "login"}${params.size ? `?${params}` : ""}`}>{mode === "login" ? "Create an account" : "Sign in"}</Link></p>
    <p>Guest accounts cannot request staff access through registration.</p>
  </section>;
}
