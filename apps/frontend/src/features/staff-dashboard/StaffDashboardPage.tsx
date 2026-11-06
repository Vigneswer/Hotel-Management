import { useQuery } from "@tanstack/react-query";
import { ErrorAlert, LoadingState } from "../../components/ui";
import { getStaffDashboard } from "./api";

export function StaffDashboardPage() {
  const query = useQuery({ queryKey: ["staff", "dashboard"], queryFn: getStaffDashboard });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorAlert>Could not load staff summary. {query.error.message} <button onClick={() => void query.refetch()}>Try again</button></ErrorAlert>;
  const data = query.data;
  return <section aria-label="Staff dashboard"><h2>Today at a glance</h2><dl className="staff-metrics">
    <div><dt>Arrivals (reservations)</dt><dd>{data.arrivals}</dd></div><div><dt>Departures (reservations)</dt><dd>{data.departures}</dd></div>
    <div><dt>Occupied rooms</dt><dd>{data.occupiedRooms}</dd></div><div><dt>Pending requests</dt><dd>{data.pendingReservations}</dd></div>
    {data.overdueDepartures !== undefined && <div><dt>Overdue departures</dt><dd>{data.overdueDepartures}</dd></div>}
    {data.missedArrivals !== undefined && <div><dt>Missed arrivals</dt><dd>{data.missedArrivals}</dd></div>}
  </dl></section>;
}
