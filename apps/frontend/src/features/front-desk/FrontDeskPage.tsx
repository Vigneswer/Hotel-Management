import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorAlert, LoadingState, StatusBadge } from "../../components/ui";
import { listStaffReservations } from "../staff-reservations/api";

function today() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
export function FrontDeskPage() {
  const [params, setParams] = useSearchParams(); const date = params.get("date") ?? today(); const mode = params.get("mode") === "departures" ? "departures" : "arrivals";
  const query = useQuery({ queryKey: ["staff", "front-desk", mode, date], queryFn: () => listStaffReservations({ page: Math.max(1, Number(params.get("page") ?? 1) || 1), limit: 10, status: mode === "arrivals" ? "CONFIRMED" : "CHECKED_IN", ...(mode === "arrivals" ? { checkInFrom: date, checkInTo: date } : { checkOutFrom: date, checkOutTo: date }) }) });
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  function update(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete("page"); setParams(next); }
  return <section><h2>Front desk</h2><div><label>Work queue <select value={mode} onChange={(e) => update("mode", e.target.value)}><option value="arrivals">Arrivals</option><option value="departures">Departures</option></select></label><label> Date <input type="date" value={date} onChange={(e) => update("date", e.target.value)} /></label></div>
    <p>{mode === "arrivals" ? "Confirmed reservations scheduled to arrive" : "Checked-in reservations scheduled to depart"} on {date}.</p>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorAlert>{query.error.message} <button onClick={() => void query.refetch()}>Try again</button></ErrorAlert> : query.data.data.length === 0 ? <EmptyState>No reservations in this queue for this date.</EmptyState> : <table><thead><tr><th>Stay</th><th>Room type</th><th>Guests</th><th>Status</th><th>Actions</th></tr></thead><tbody>{query.data.data.map((r) => <tr key={r.id}><td>{r.checkInDate} – {r.checkOutDate}</td><td>{r.roomTypeId}</td><td>{r.guestCount}</td><td><StatusBadge status={r.status} /></td><td><Link to={`/staff/reservations/${r.id}`}>Open details and process</Link></td></tr>)}</tbody></table>}
    <nav aria-label="Front desk pages"><button disabled={page <= 1} onClick={() => update("page", String(page - 1))}>Previous page</button><span> Page {query.data?.pagination.page ?? page} of {query.data?.pagination.totalPages ?? 1} </span><button disabled={page >= (query.data?.pagination.totalPages ?? 1)} onClick={() => update("page", String(page + 1))}>Next page</button></nav>
  </section>;
}
