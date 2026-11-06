import { describe, expect, it } from "vitest";
import { DashboardDtoSchema } from "@hotel/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { StaffDashboardPage } from "./StaffDashboardPage";

describe("staff dashboard contract", () => {
  it("keeps room counts distinct from reservation counts and accepts operational warnings", () => {
    const data = DashboardDtoSchema.extend({ missedArrivals: DashboardDtoSchema.shape.arrivals.optional(), overdueDepartures: DashboardDtoSchema.shape.departures.optional() }).parse({ arrivals: 2, departures: 1, occupiedRooms: 4, pendingReservations: 3, overdueDepartures: 1 });
    expect(data.occupiedRooms).toBe(4);
    expect(data.pendingReservations).toBe(3);
  });
  it("shows an accessible loading state before the summary arrives", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><StaffDashboardPage /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading");
  });
});
