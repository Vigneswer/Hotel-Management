import { describe, expect, it } from "vitest";
import { RoomTypeWriteSchema } from "@hotel/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { StaffRoomsPage } from "./StaffRoomsPage";

describe("staff room form contract", () => {
  it("validates server-owned room fields before sending writes", () => {
    const value = RoomTypeWriteSchema.parse({ name: "Suite", description: "Large room", capacity: 2, facilities: ["Wi-Fi"], nightlyPrice: { amountMinor: 5000, currency: "INR" }, totalInventory: 4 });
    expect(value.totalInventory).toBe(4);
  });
  it("renders labeled room fields and a loading indicator", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><StaffRoomsPage /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain("Guest capacity");
    expect(html).toContain("Total inventory");
    expect(html).toContain('role="status"');
  });
});
