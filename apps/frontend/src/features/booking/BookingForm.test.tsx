import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingForm } from "./BookingForm";

describe("guest booking request form", () => {
  it("labels stay fields and explains the pending confirmation policy", () => {
    const stored = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><BookingForm roomId="0123456789abcdef01234567" initial={{ checkInDate: "", checkOutDate: "", guestCount: 1 }} /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain("Check-in");
    expect(html).toContain("Check-out");
    expect(html).toContain("Guests");
    expect(html).toContain("This is a request, not a confirmed booking.");
    expect(html).toContain("Availability is not guaranteed until staff confirms it.");
  });
});
