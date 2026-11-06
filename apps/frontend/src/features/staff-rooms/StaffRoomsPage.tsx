import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RoomTypeWriteSchema, type RoomTypeDto } from "@hotel/contracts";
import { EmptyState, ErrorAlert, Field, LoadingState } from "../../components/ui";
import { activateRoom, deactivateRoom, listStaffRooms, saveRoom, type RoomWrite } from "./api";

const initial: RoomWrite = { name: "", description: "", capacity: 1, facilities: [], nightlyPrice: { amountMinor: 0, currency: "INR" }, totalInventory: 1 };
export function StaffRoomsPage() {
  const [page, setPage] = useState(1); const [filter, setFilter] = useState("all"); const [editing, setEditing] = useState<RoomTypeDto>(); const [form, setForm] = useState<RoomWrite>(initial); const [formError, setFormError] = useState("");
  const client = useQueryClient(); const active = filter === "all" ? undefined : filter === "active";
  const query = useQuery({ queryKey: ["staff", "rooms", page, filter], queryFn: () => listStaffRooms(page, 10, active) });
  const mutation = useMutation({ mutationFn: () => saveRoom(form, editing), onSuccess: () => { setFormError("Saved."); setEditing(undefined); setForm(initial); void client.invalidateQueries({ queryKey: ["staff", "rooms"] }); } });
  const deactivate = useMutation({ mutationFn: deactivateRoom, onSuccess: () => void client.invalidateQueries({ queryKey: ["staff", "rooms"] }) });
  const activate = useMutation({ mutationFn: activateRoom, onSuccess: () => void client.invalidateQueries({ queryKey: ["staff", "rooms"] }) });
  function submit(event: FormEvent) { event.preventDefault(); setFormError(""); const parsed = RoomTypeWriteSchema.safeParse(form); if (!parsed.success) { setFormError(parsed.error.issues.map((issue) => issue.message).join(" ")); return; } mutation.mutate(); }
  function edit(room: RoomTypeDto) { setEditing(room); setForm({ name: room.name, description: room.description, capacity: room.capacity, facilities: room.facilities, nightlyPrice: room.nightlyPrice, totalInventory: room.totalInventory, ...(room.imageUrl ? { imageUrl: room.imageUrl } : {}) }); }
  return <section><h2>Room types</h2>
    <form className="room-edit-form" onSubmit={submit} aria-label={editing ? "Edit room type" : "Create room type"}><h3>{editing ? `Edit ${editing.name}` : "Add room type"}</h3>
      <Field label="Name"><input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Description"><textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Guest capacity"><input type="number" min={1} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></Field>
      <Field label="Nightly price (minor units)"><input type="number" min={0} required value={form.nightlyPrice.amountMinor} onChange={(e) => setForm({ ...form, nightlyPrice: { ...form.nightlyPrice, amountMinor: Number(e.target.value) } })} /></Field>
      <Field label="Currency"><input required minLength={3} maxLength={3} value={form.nightlyPrice.currency} onChange={(e) => setForm({ ...form, nightlyPrice: { ...form.nightlyPrice, currency: e.target.value.toUpperCase() } })} /></Field>
      <Field label="Total inventory"><input type="number" min={0} required value={form.totalInventory} onChange={(e) => setForm({ ...form, totalInventory: Number(e.target.value) })} /></Field>
      <Field label="Facilities (comma separated)"><input value={form.facilities.join(", ")} onChange={(e) => setForm({ ...form, facilities: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
      <Field label="Image URL (optional)"><input type="url" value={form.imageUrl ?? ""} onChange={(e) => setForm({ ...form, imageUrl: e.target.value || undefined })} /></Field>
      {formError && <p role="status">{formError}</p>}{mutation.error && <ErrorAlert>{mutation.error.message} The room may have changed; reload before trying again.</ErrorAlert>}
      <button disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save room type"}</button>{editing && <button type="button" onClick={() => { setEditing(undefined); setForm(initial); }}>Stop editing</button>}
    </form>
    <label>Show <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="all">All rooms</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorAlert>{query.error.message} <button onClick={() => void query.refetch()}>Try again</button></ErrorAlert> : query.data.data.length === 0 ? <EmptyState>No room types on this page.</EmptyState> : <table><thead><tr><th>Name</th><th>Capacity</th><th>Inventory</th><th>Nightly price</th><th>State</th><th>Actions</th></tr></thead><tbody>{query.data.data.map((room) => <tr key={room.id}><td>{room.name}</td><td>{room.capacity}</td><td>{room.totalInventory}</td><td>{(room.nightlyPrice.amountMinor / 100).toLocaleString(undefined, { style: "currency", currency: room.nightlyPrice.currency })}</td><td>{room.active ? "Active" : "Inactive"}</td><td><button onClick={() => edit(room)}>Edit</button>{room.active ? <button disabled={deactivate.isPending} onClick={() => { if (window.confirm(`Deactivate ${room.name}?`)) deactivate.mutate(room); }}>Deactivate</button> : <button disabled={activate.isPending} onClick={() => { if (window.confirm(`Activate ${room.name}?`)) activate.mutate(room); }}>Activate</button>}</td></tr>)}</tbody></table>}
    {deactivate.error && <ErrorAlert>{deactivate.error.message} Refresh the room list to see current state.</ErrorAlert>}{activate.error && <ErrorAlert>{activate.error.message} Refresh the room list to see current state.</ErrorAlert>}
    <nav aria-label="Room pages"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button><span> Page {query.data?.pagination.page ?? page} of {query.data?.pagination.totalPages ?? 1} </span><button disabled={page >= (query.data?.pagination.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next page</button></nav>
  </section>;
}
