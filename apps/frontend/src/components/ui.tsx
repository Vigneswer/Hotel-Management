import type { ReactNode } from "react";
import type { ReservationStatus } from "@hotel/contracts";
import { Link, Outlet } from "react-router-dom";

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) { return <label className="field">{label}{children}{error && <span role="alert">{error}</span>}</label>; }
export function ErrorAlert({ children }: { children: ReactNode }) { return <div className="alert" role="alert">{children}</div>; }
export function EmptyState({ children }: { children: ReactNode }) { return <p className="empty-state">{children}</p>; }
export function StatusBadge({ status }: { status: ReservationStatus }) { return <span className={`status-badge status-${status.toLowerCase().replaceAll("_", "-")}`} aria-label={`Status: ${status}`}>{status.replaceAll("_", " ")}</span>; }
export function LoadingState() { return <p className="loading-state" role="status">Loading…</p>; }
export function ProtectedLayout({ children }: { children: ReactNode }) { return <section>{children}</section>; }
export function GuestLayout({ children }: { children?: ReactNode }) { return <div data-layout="guest">{children ?? <Outlet />}</div>; }
export function StaffLayout({ children }: { children?: ReactNode }) { return <div data-layout="staff"><nav aria-label="Staff pages"><Link to="/staff">Dashboard</Link><Link to="/staff/rooms">Room types</Link><Link to="/staff/reservations">Reservations</Link><Link to="/staff/front-desk">Front desk</Link></nav>{children ?? <Outlet />}</div>; }
