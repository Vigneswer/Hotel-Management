import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ErrorAlert, EmptyState, LoadingState, StatusBadge } from "../../components/ui";
import { getStaffReservation, listReservationAudit, mutateReservation, type ReservationAction } from "./api";

export function StaffReservationDetailPage() {
  const { id = "" } = useParams(); const [reason, setReason] = useState(""); const [message, setMessage] = useState(""); const client = useQueryClient();
  const reservation = useQuery({ queryKey: ["staff", "reservation", id], queryFn: () => getStaffReservation(id), enabled: Boolean(id) });
  const audit = useQuery({ queryKey: ["staff", "reservation-audit", id], queryFn: () => listReservationAudit(id), enabled: Boolean(id) });
  const action = useMutation({ mutationFn: ({ kind }: { kind: ReservationAction }) => mutateReservation(reservation.data!, kind, kind === "cancel" ? reason : undefined), onSuccess: (updated) => { setMessage(`Server saved the reservation as ${updated.status.replaceAll("_", " ")}.`); setReason(""); void client.invalidateQueries({ queryKey: ["staff", "reservation", id] }); void client.invalidateQueries({ queryKey: ["staff", "reservation-audit", id] }); void client.invalidateQueries({ queryKey: ["staff", "reservations"] }); void client.invalidateQueries({ queryKey: ["staff", "dashboard"] }); } });
  if (reservation.isPending) return <LoadingState />;
  if (reservation.isError || !reservation.data) return <ErrorAlert>Reservation could not be loaded. {reservation.error?.message} <button onClick={() => void reservation.refetch()}>Refresh</button></ErrorAlert>;
  const r = reservation.data;
  const allowed: ReservationAction[] = r.status === "PENDING" ? ["confirm", "cancel"] : r.status === "CONFIRMED" ? ["cancel", "check-in"] : r.status === "CHECKED_IN" ? ["check-out"] : [];
  return <section><h2>Reservation details</h2><p><Link to="/staff/reservations">Back to reservations</Link></p>
    <dl><dt>Reservation</dt><dd>{r.id}</dd><dt>Status</dt><dd><StatusBadge status={r.status} /></dd><dt>Stay</dt><dd>{r.checkInDate} to {r.checkOutDate} ({r.nights} nights)</dd><dt>Guests</dt><dd>{r.guestCount}</dd><dt>Room type</dt><dd>{r.roomTypeId}</dd><dt>Total snapshot</dt><dd>{(r.total.amountMinor / 100).toLocaleString(undefined, { style: "currency", currency: r.total.currency })}</dd><dt>Version</dt><dd>{r.version}</dd></dl>
    {r.status === "PENDING" && <p>Pending staff confirmation. Inventory is not committed until confirmation succeeds.</p>}
    {allowed.includes("cancel") && <label>Cancellation reason <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>}
    {allowed.map((kind) => <button key={kind} disabled={action.isPending || (kind === "cancel" && !reason.trim())} onClick={() => { if (window.confirm(`Proceed with ${kind.replace("-", " ")} for this reservation?`)) action.mutate({ kind }); }}>{kind.replaceAll("-", " ")}</button>)}
    {message && <p role="status">{message}</p>}{action.error && <ErrorAlert>{action.error.message} This may be a version or inventory conflict. Current server state is being refreshed; review it before retrying. <button onClick={() => { void reservation.refetch(); void audit.refetch(); }}>Refresh now</button></ErrorAlert>}
    <h3>Audit history</h3>{audit.isPending ? <LoadingState /> : audit.isError ? <ErrorAlert>Could not load audit history. {audit.error.message} <button onClick={() => void audit.refetch()}>Try again</button></ErrorAlert> : audit.data.data.length === 0 ? <EmptyState>No audit events were returned.</EmptyState> : <ol>{audit.data.data.map((event) => <li key={event.id}>{event.action}{event.reason ? ` — ${event.reason}` : ""} · {new Date(event.createdAt).toLocaleString()}</li>)}</ol>}
    {new Date(r.checkOutDate + "T12:00:00").getTime() < Date.now() && r.status === "CHECKED_IN" && <p role="alert">Overdue departure: scheduled check-out was {r.checkOutDate}.</p>}
  </section>;
}
