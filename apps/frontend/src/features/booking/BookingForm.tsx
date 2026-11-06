import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { UserDtoSchema, type CreateReservationRequest } from "@hotel/contracts";
import { z } from "zod";
import { ErrorAlert, Field, LoadingState } from "../../components/ui";
import { apiRequest, completeOperation, operationKey } from "../../lib/api";
import { getQuote } from "../rooms/api";
import { readBookingSelection, saveBookingSelection } from "./selection";

const CreationResponse = z.object({ data: z.object({ id: z.string(), status: z.literal("PENDING") }), requestId: z.string() });
const PendingBodyKey = "hotel.guest.pending-reservation-body";
function formatMoney(amountMinor: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100); }
function isReservationBody(value: unknown): value is CreateReservationRequest {
  return typeof value === "object" && value !== null && "roomTypeId" in value && "checkInDate" in value && "checkOutDate" in value && "guestCount" in value && "quoteVersion" in value && typeof value.roomTypeId === "string" && typeof value.checkInDate === "string" && typeof value.checkOutDate === "string" && typeof value.guestCount === "number" && typeof value.quoteVersion === "number";
}
function readPendingBody(): CreateReservationRequest | null {
  try { const value: unknown = JSON.parse(localStorage.getItem(PendingBodyKey) ?? "null"); return isReservationBody(value) ? value : null; }
  catch { return null; }
}

export function BookingForm({ roomId, initial }: { roomId: string; initial: { checkInDate: string; checkOutDate: string; guestCount: number } }) {
  const navigate = useNavigate(); const location = useLocation();
  const saved = readBookingSelection();
  const [stay, setStay] = useState({ ...initial, ...(saved?.roomTypeId === roomId ? { checkInDate: saved.checkInDate, checkOutDate: saved.checkOutDate, guestCount: saved.guestCount } : {}) });
  const [notice, setNotice] = useState("");
  const hasDates = Boolean(stay.checkInDate && stay.checkOutDate && stay.guestCount > 0);
  const quote = useQuery({ queryKey: ["guest", "quote", roomId, stay], queryFn: () => getQuote({ roomTypeId: roomId, ...stay }), enabled: hasDates });
  const currentUser = useQuery({ queryKey: ["auth", "me"], queryFn: async () => UserDtoSchema.parse((await apiRequest<{ data: unknown }>("/api/v1/auth/me")).data), retry: false });
  const createRequest = useMutation({ mutationFn: async (body: CreateReservationRequest) => CreationResponse.parse(await apiRequest<unknown>("/api/v1/reservations", { method: "POST", body, idempotencyKey: operationKey(localStorage, "guest-create-reservation") })).data });
  function update(next: typeof stay) { setStay(next); saveBookingSelection({ roomTypeId: roomId, ...next }); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("");
    if (!currentUser.data) {
      saveBookingSelection({ roomTypeId: roomId, ...stay });
      navigate(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }
    const pendingBody = readPendingBody();
    let body: CreateReservationRequest;
    if (isReservationBody(pendingBody)) {
      if (pendingBody.roomTypeId !== roomId) { setNotice("A reservation request from another room is awaiting a definitive response. Reopen that room to safely retry it first."); return; }
      body = pendingBody;
      setNotice("Retrying the same request with its saved operation key.");
    } else {
      if (!quote.data) { setNotice("Get a current quote before requesting this stay."); return; }
      body = { roomTypeId: roomId, ...stay, quoteVersion: quote.data.quoteVersion };
      localStorage.setItem(PendingBodyKey, JSON.stringify(body));
    }
    try {
      const response = await createRequest.mutateAsync(body);
      localStorage.removeItem(PendingBodyKey); completeOperation(localStorage, "guest-create-reservation");
      navigate(`/my-reservations?created=${encodeURIComponent(response.id)}`, { replace: true });
    } catch (error) {
      setNotice(`${error instanceof Error ? error.message : "Request failed."} The request is saved for a safe retry. Check your reservations before starting a different request.`);
    }
  }
  const pendingBody = readPendingBody();
  const uncertain = pendingBody !== null;
  const pendingBelongsElsewhere = uncertain && pendingBody.roomTypeId !== roomId;
  return <section aria-labelledby="request-heading">
    <h3 id="request-heading">Request this stay</h3>
    <form className="booking-form" onSubmit={(event) => void submit(event)}>
      <Field label="Check-in"><input type="date" required value={stay.checkInDate} onChange={(event) => update({ ...stay, checkInDate: event.target.value })} /></Field>
      <Field label="Check-out"><input type="date" required value={stay.checkOutDate} onChange={(event) => update({ ...stay, checkOutDate: event.target.value })} /></Field>
      <Field label="Guests"><input type="number" min="1" max="100" required value={stay.guestCount} onChange={(event) => update({ ...stay, guestCount: Number(event.target.value) })} /></Field>
      {!hasDates && <p>Choose your stay dates and guest count to see a quote.</p>}
      {quote.isPending && hasDates && <LoadingState />}
      {quote.error && <ErrorAlert>{quote.error.message} Update your dates or reload the quote.</ErrorAlert>}
      {quote.data && <div className="quote-summary" aria-live="polite"><p>{quote.data.nights} nights</p><p>{formatMoney(quote.data.nightlyPrice.amountMinor, quote.data.nightlyPrice.currency)} per night</p><p>Room subtotal: {formatMoney(quote.data.total.amountMinor, quote.data.total.currency)}. Taxes and payment are not included.</p></div>}
      <button type="submit" disabled={createRequest.isPending || !hasDates || pendingBelongsElsewhere}>{createRequest.isPending ? "Sending request…" : uncertain ? "Retry saved request" : "Request reservation"}</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    {pendingBelongsElsewhere && <p role="status">A saved request for another room is awaiting a definitive response. Return to that room to retry it.</p>}
    <p>This is a request, not a confirmed booking. Availability is not guaranteed until staff confirms it.</p>
    <p><Link to={`/login?returnTo=${encodeURIComponent(`/rooms/${roomId}`)}`}>Sign in</Link> or <Link to={`/register?returnTo=${encodeURIComponent(`/rooms/${roomId}`)}`}>create an account</Link> to continue. Your room and stay selection is kept in this tab.</p>
    {currentUser.isPending && <p role="status">Checking your sign-in…</p>}
    {currentUser.error && <p>Sign in before sending a reservation request.</p>}
  </section>;
}
