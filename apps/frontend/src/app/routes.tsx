import { useQuery } from "@tanstack/react-query";
import { UserDtoSchema } from "@hotel/contracts";
import { createBrowserRouter, createRoutesFromElements, Link, Outlet, Route, useLocation } from "react-router-dom";
import { GuestLayout, StaffLayout } from "../components/ui";
import { LogoutButton } from "../features/auth/LogoutButton";
import { apiRequest } from "../lib/api";
import { guestRoutes } from "../features/rooms/routes";
import { frontDeskRoutes } from "../features/front-desk/routes";
import { staffDashboardRoutes } from "../features/staff-dashboard/routes";
import { staffReservationRoutes } from "../features/staff-reservations/routes";
import { staffRoomRoutes } from "../features/staff-rooms/routes";

function AppFrame() {
  const location = useLocation();
  const isStaffArea = location.pathname === "/staff" || location.pathname.startsWith("/staff/");
  const user = useQuery({ queryKey: ["auth", "me"], queryFn: async () => UserDtoSchema.parse((await apiRequest<{ data: unknown }>("/api/v1/auth/me")).data), retry: false });
  return <main><header><Link to="/">Hotel Management</Link><nav aria-label="Main">{!isStaffArea && <><Link to="/rooms">Rooms</Link><Link to="/my-reservations">My reservations</Link></>}{!user.isPending && (user.data ? <LogoutButton className="header-signout" /> : <Link to="/login">Sign in</Link>)}</nav></header><Outlet /></main>;
}
function Welcome() { return <section className="hero"><h1>A stay worth remembering.</h1><p>Find a room that feels like yours. Explore available stays and send a reservation request in just a few steps.</p><Link className="button-link" to="/rooms">Explore rooms</Link></section>; }

/** L4 route exports are registered here; staff feature elements share the staff layout. */
export const routeRegistry = createRoutesFromElements(
  <Route element={<AppFrame />}>
    <Route element={<GuestLayout />}>
      <Route index element={<Welcome />} />
      {guestRoutes.map(({ path, element }) => <Route key={path} path={path} element={element} />)}
    </Route>
    <Route element={<StaffLayout />}>
      {staffDashboardRoutes}
      {staffRoomRoutes}
      {staffReservationRoutes}
      {frontDeskRoutes}
    </Route>
  </Route>,
);
export const router = createBrowserRouter(routeRegistry);
