import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageSchema, ReservationDtoSchema, UserDtoSchema, type ReservationDto } from "@hotel/contracts";
import { z } from "zod";
import { EmptyState, ErrorAlert, LoadingState, StatusBadge } from "../../components/ui";
import { apiRequest, completeOperation, operationKey } from "../../lib/api";

const CancelResponse = z.object({ data: ReservationDtoSchema, requestId: z.string() });
function money(amountMinor: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100); }
export function MyReservationsPage() {
  const queryClient = useQueryClient(); const [params, setParams] = useSearchParams(); const [page, setPage] = useState(Math.max(1, Number(params.get("page") ?? 1) || 1)); const [message, setMessage] = useState("");
  const user = useQuery({ queryKey: ["auth", "me"], queryFn: async () => UserDtoSchema.parse((await apiRequest<{ data: unknown }>("/api/v1/auth/me")).data), retry: false });
  const reservations = useQuery({ queryKey: ["guest", "reservations", page], queryFn: async () => PageSchema(ReservationDtoSchema).parse(await apiRequest<unknown>(`/api/v1/reservations/me?page=${page}&limit=10`)) });
  const cancel = useMutation({ mutationFn: async (reservation: ReservationDto) => {
    const scope = `guest-cancel-${reservation.id}-v${reservation.version}`;
    return CancelResponse.parse(await apiRequest<unknown>(`/api/v1/reservations/${encodeURIComponent(reservation.id)}/cancel`, { method: "POST", body: { expectedVersion: reservation.version }, idempotencyKey: operationKey(localStorage, scope) }));
  }, onSuccess: (_result, reservation) => { completeOperation(localStorage, `guest-cancel-${reservation.id}-v${reservation.version}`); setMessage("Cancellation was processed by the hotel."); void queryClient.invalidateQueries({ queryKey: ["guest", "reservations"] }); } });
  function changePage(next: number) { setPage(next); setParams(next === 1 ? {} : { page: String(next) }); }
  if (user.isPending || reservations.isPending) return <LoadingState />;
  if (user.error) return <section><h2>My reservations</h2><p>Sign in to view your requests.</p><Link to="/login?returnTo=%2Fmy-reservations">Sign in</Link></section>;
  if (reservations.error) return <ErrorAlert>{reservations.error.message} <button type="button" onClick={() => void reservations.refetch()}>Try again</button></ErrorAlert>;
  const rows = reservations.data?.data ?? [];
  return <section><h2>My reservations</h2><p>Signed in as {user.data?.name}</p>
    {message && <p role="status">{message}</p>}{cancel.error && <ErrorAlert>{cancel.error.message} Reservation state may have changed; refresh the list before retrying.</ErrorAlert>}
    {rows.length === 0 ? <EmptyState>You have no reservation requests yet. <Link to="/rooms">Browse rooms</Link></EmptyState> : <ul className="reservation-list">{rows.map((reservation) => <li key={reservation.id} className="reservation-card">
      <h3>Stay {reservation.checkInDate} to {reservation.checkOutDate}</h3><p><StatusBadge status={reservation.status} /></p><p>{reservation.nights} nights · {reservation.guestCount} guests · {money(reservation.total.amountMinor, reservation.total.currency)}</p>
      {reservation.status === "PENDING" && <p>Pending staff confirmation. This request does not guarantee availability.</p>}
      {reservation.status === "CONFIRMED" && <p>Your stay is confirmed by the hotel.</p>}
      {(reservation.status === "PENDING" || reservation.status === "CONFIRMED") && <button type="button" disabled={cancel.isPending} onClick={() => { if (window.confirm("Request cancellation of this stay? The server will check whether it is still eligible.")) cancel.mutate(reservation); }}>Cancel request</button>}
    </li>)}</ul>}
    <nav aria-label="Reservation pages"><button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}>Previous page</button><span> Page {reservations.data?.pagination.page} of {reservations.data?.pagination.totalPages} </span><button type="button" disabled={page >= (reservations.data?.pagination.totalPages ?? 1)} onClick={() => changePage(page + 1)}>Next page</button></nav>
  </section>;
}
