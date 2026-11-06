import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthPage } from "./AuthPage";

function render(mode: "login" | "register") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><AuthPage mode={mode} /></MemoryRouter></QueryClientProvider>);
}

describe("guest authentication screens", () => {
  it("renders labeled login credentials and account creation link", () => {
    const html = render("login");
    expect(html).toContain("Sign in");
    expect(html).toContain("<label");
    expect(html).toContain('type="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain("Create an account");
  });
  it("requires a long password and makes guest-only registration clear", () => {
    const html = render("register");
    expect(html).toContain("Create your guest account");
    expect(html).toContain('minLength="12"');
    expect(html).toContain("Guest accounts cannot request staff access");
    expect(html).toContain('autoComplete="name"');
  });
});
