import { DashboardDtoSchema } from "@hotel/contracts";
import { z } from "zod";
import { apiRequest } from "../../lib/api";

const Response = z.object({ data: DashboardDtoSchema.extend({ missedArrivals: z.number().int().nonnegative().optional(), overdueDepartures: z.number().int().nonnegative().optional() }), requestId: z.string() });
export async function getStaffDashboard() { return Response.parse(await apiRequest<unknown>("/api/v1/staff/dashboard")).data; }
