import { describe, expect, it } from "vitest";
import { ReservationStatusSchema, ReservationDtoSchema } from "@hotel/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { StaffReservationsPage } from "./StaffReservationsPage";

describe("staff reservation screen contracts", () => {
  it("supports server filter statuses and stale version metadata", () => {
    expect(ReservationStatusSchema.parse("CHECKED_IN")).toBe("CHECKED_IN");
    expect(ReservationDtoSchema.shape.version.parse(7)).toBe(7);
  });
  it("renders accessible filter labels while reservations load", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><StaffReservationsPage /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain("Guest email");
    expect(html).toContain("Check-in from");
    expect(html).toContain('role="status"');
  });
});
