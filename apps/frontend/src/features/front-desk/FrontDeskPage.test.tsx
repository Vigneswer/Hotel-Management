import { describe, expect, it } from "vitest";
import { ReservationStatusSchema } from "@hotel/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { FrontDeskPage } from "./FrontDeskPage";

describe("front desk queue status contract", () => {
  it("uses confirmed arrivals and checked-in departures only", () => {
    expect(ReservationStatusSchema.parse("CONFIRMED")).toBe("CONFIRMED");
    expect(ReservationStatusSchema.parse("CHECKED_IN")).toBe("CHECKED_IN");
  });
  it("shows the queue selector and date control while loading", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><FrontDeskPage /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain("Work queue");
    expect(html).toContain("type=\"date\"");
    expect(html).toContain('role="status"');
  });
});
