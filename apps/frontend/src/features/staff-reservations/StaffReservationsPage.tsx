import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ReservationStatusSchema } from "@hotel/contracts";
import { EmptyState, ErrorAlert, Field, LoadingState, StatusBadge } from "../../components/ui";
import { listStaffReservations } from "./api";

const statuses = ReservationStatusSchema.options;
export function StaffReservationsPage() {
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(() => Object.fromEntries(["status", "reference", "roomTypeId", "guestEmail", "checkInDate", "checkOutDate"].map((key) => [key, params.get(key) ?? ""])) as Record<string, string>);
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const query = useQuery({ queryKey: ["staff", "reservations", params.toString()], queryFn: () => listStaffReservations({ page, limit: 10, ...(params.get("status") ? { status: ReservationStatusSchema.parse(params.get("status")) } : {}), ...(params.get("reference") ? { reference: params.get("reference")! } : {}), ...(params.get("roomTypeId") ? { roomTypeId: params.get("roomTypeId")! } : {}), ...(params.get("guestEmail") ? { guestEmail: params.get("guestEmail")! } : {}), ...(params.get("checkInDate") ? { checkInDate: params.get("checkInDate")! } : {}), ...(params.get("checkOutDate") ? { checkOutDate: params.get("checkOutDate")! } : {}) }) });
  function submit(event: FormEvent) { event.preventDefault(); const next = new URLSearchParams(); for (const [key, value] of Object.entries(form)) if (value) next.set(key, value); setParams(next); }
  function go(nextPage: number) { const next = new URLSearchParams(params); if (nextPage > 1) next.set("page", String(nextPage)); else next.delete("page"); setParams(next); }
  return <section><h2>Reservations</h2><form className="filter-form" onSubmit={submit}><h3>Search and filter</h3>
    <Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></Field>
    <Field label="Reference"><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field><Field label="Room type ID"><input value={form.roomTypeId} onChange={(e) => setForm({ ...form, roomTypeId: e.target.value })} /></Field><Field label="Guest email"><input type="email" value={form.guestEmail} onChange={(e) => setForm({ ...form, guestEmail: e.target.value })} /></Field>
    <Field label="Check-in date"><input type="date" value={form.checkInDate} onChange={(e) => setForm({ ...form, checkInDate: e.target.value })} /></Field><Field label="Check-out date"><input type="date" value={form.checkOutDate} onChange={(e) => setForm({ ...form, checkOutDate: e.target.value })} /></Field><button>Apply filters</button>
  </form>
  {query.isPending ? <LoadingState /> : query.isError ? <ErrorAlert>{query.error.message} <button onClick={() => void query.refetch()}>Try again</button></ErrorAlert> : query.data.data.length === 0 ? <EmptyState>No reservations match these filters.</EmptyState> : <table><thead><tr><th>Dates</th><th>Guest count</th><th>Room</th><th>Status</th><th>Total</th><th>Details</th></tr></thead><tbody>{query.data.data.map((r) => <tr key={r.id}><td>{r.checkInDate} – {r.checkOutDate}</td><td>{r.guestCount}</td><td>{r.roomTypeId}</td><td><StatusBadge status={r.status} /></td><td>{(r.total.amountMinor / 100).toLocaleString(undefined, { style: "currency", currency: r.total.currency })}</td><td><Link to={`/staff/reservations/${r.id}`}>Open reservation</Link></td></tr>)}</tbody></table>}
  <nav aria-label="Reservation pages"><button disabled={page <= 1} onClick={() => go(page - 1)}>Previous page</button><span> Page {query.data?.pagination.page ?? page} of {query.data?.pagination.totalPages ?? 1} </span><button disabled={page >= (query.data?.pagination.totalPages ?? 1)} onClick={() => go(page + 1)}>Next page</button></nav>
  </section>;
}
