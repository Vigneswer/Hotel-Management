import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { EmptyState, ErrorAlert, Field, LoadingState } from "../../components/ui";
import { listRooms, searchAvailability, type AvailableRoom, type RoomType } from "./api";

function money(amountMinor: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100); }
function roomPrice(room: RoomType | AvailableRoom) { return "nightlyPrice" in room ? room.nightlyPrice : { amountMinor: room.nightlyPriceMinor, currency: room.currency }; }
export function RoomsPage() {
  const [page, setPage] = useState(1);
  const [dates, setDates] = useState({ checkInDate: "", checkOutDate: "", guestCount: 1 });
  const hasSearch = Boolean(dates.checkInDate && dates.checkOutDate);
  const rooms = useQuery({ queryKey: ["guest", "rooms", page], queryFn: () => listRooms(page) });
  const availability = useInfiniteQuery({ queryKey: ["guest", "availability", dates], initialPageParam: null as string | null, queryFn: ({ pageParam }) => searchAvailability({ ...dates, cursor: pageParam }), getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.nextCursor ?? undefined : undefined, enabled: hasSearch });
  const items = hasSearch ? availability.data?.pages.flatMap((pageResult) => pageResult.data) : rooms.data?.data;
  const pending = hasSearch ? availability.isPending : rooms.isPending;
  const error = hasSearch ? availability.error : rooms.error;
  return <section>
    <h2>Find a room</h2>
    <form className="search-form" onSubmit={(event) => { event.preventDefault(); void availability.refetch(); }}>
      <Field label="Check-in"><input type="date" required value={dates.checkInDate} onChange={(event) => setDates({ ...dates, checkInDate: event.target.value })} /></Field>
      <Field label="Check-out"><input type="date" required value={dates.checkOutDate} onChange={(event) => setDates({ ...dates, checkOutDate: event.target.value })} /></Field>
      <Field label="Guests"><input type="number" min="1" max="100" required value={dates.guestCount} onChange={(event) => setDates({ ...dates, guestCount: Number(event.target.value) })} /></Field>
      <button type="submit">Search availability</button>
    </form>
    {(pending || (hasSearch && availability.isFetching)) && <LoadingState />}
    {error && <ErrorAlert>{error instanceof Error ? error.message : "Rooms could not be loaded. Try again."}</ErrorAlert>}
    {!pending && !error && items?.length === 0 && <EmptyState>{hasSearch ? "No rooms are available for those dates." : "No rooms are listed yet."}</EmptyState>}
    <div className="room-grid">{items?.map((room) => <article className="room-card" key={room.id}>
      {room.imageUrl && <img src={room.imageUrl} alt="" />}
      <h3>{room.name}</h3><p>{room.description}</p><p>Up to {room.capacity} guests · {money(roomPrice(room).amountMinor, roomPrice(room).currency)} per night</p>
      {"availableRooms" in room && typeof room.availableRooms === "number" && <p>{room.availableRooms} available · dates are advisory until staff confirms</p>}
      <Link to={`/rooms/${room.id}${hasSearch ? `?${new URLSearchParams({ ...dates, guestCount: String(dates.guestCount) })}` : ""}`}>View details</Link>
    </article>)}</div>
    {!hasSearch && rooms.data && <nav aria-label="Room pages"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button><span> Page {rooms.data.pagination.page} of {rooms.data.pagination.totalPages} </span><button type="button" disabled={page >= rooms.data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next page</button></nav>}
    {hasSearch && availability.hasNextPage && <button type="button" disabled={availability.isFetchingNextPage} onClick={() => void availability.fetchNextPage()}>{availability.isFetchingNextPage ? "Loading…" : "More results"}</button>}
  </section>;
}
