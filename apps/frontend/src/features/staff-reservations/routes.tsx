import { Route } from "react-router-dom";
import { StaffReservationDetailPage } from "./StaffReservationDetailPage";
import { StaffReservationsPage } from "./StaffReservationsPage";
export const staffReservationRoutes = <><Route path="/staff/reservations" element={<StaffReservationsPage />} /><Route path="/staff/reservations/:id" element={<StaffReservationDetailPage />} /></>;
