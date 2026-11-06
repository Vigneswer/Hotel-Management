import { AuthPage } from "../auth/AuthPage";
import { MyReservationsPage } from "../my-reservations/MyReservationsPage";
import { RoomDetailPage } from "./RoomDetailPage";
import { RoomsPage } from "./RoomsPage";

/** Route objects for L1's app route registry; the shared shell remains the composition owner. */
export const guestRoutes = [
  { path: "/rooms", element: <RoomsPage /> },
  { path: "/rooms/:roomId", element: <RoomDetailPage /> },
  { path: "/login", element: <AuthPage mode="login" /> },
  { path: "/register", element: <AuthPage mode="register" /> },
  { path: "/my-reservations", element: <MyReservationsPage /> },
];
