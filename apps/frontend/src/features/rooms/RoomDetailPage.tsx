import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ErrorAlert, LoadingState } from "../../components/ui";
import { getRoom } from "./api";
import { BookingForm } from "../booking/BookingForm";

export function RoomDetailPage() {
  const { roomId = "" } = useParams();
  const [params] = useSearchParams();
  const room = useQuery({ queryKey: ["guest", "room", roomId], queryFn: () => getRoom(roomId), enabled: /^[a-f\d]{24}$/i.test(roomId) });
  if (room.isPending) return <LoadingState />;
  if (room.error || !room.data) return <><ErrorAlert>{room.error?.message ?? "This room could not be found."}</ErrorAlert><Link to="/rooms">Back to rooms</Link></>;
  const checkInDate = params.get("checkInDate") ?? "";
  const checkOutDate = params.get("checkOutDate") ?? "";
  const guestCount = Number(params.get("guestCount") ?? 1);
  return <article className="room-detail">
    <Link to="/rooms">Back to rooms</Link><h2>{room.data.name}</h2><p>{room.data.description}</p>
    <p>Capacity: {room.data.capacity} guests · Nightly price shown in the quote</p>
    <ul>{room.data.facilities.map((facility) => <li key={facility}>{facility}</li>)}</ul>
    <BookingForm roomId={room.data.id} initial={{ checkInDate, checkOutDate, guestCount: Number.isSafeInteger(guestCount) && guestCount > 0 ? guestCount : 1 }} />
  </article>;
}
