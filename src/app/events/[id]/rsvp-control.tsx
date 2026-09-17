"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Drawer } from "vaul";
import { toast } from "sonner";
import NumberFlow from "@number-flow/react";
import { CalendarCheck, X } from "lucide-react";
import { rsvpToEvent, cancelEventRsvp, RSVP_ERROR_MESSAGES } from "../actions";

type MyRsvp = { status: "confirmed" | "waitlist"; position: number } | null;

/**
 * Bottom-sheet confirm so the primary action is reachable one-handed on a
 * phone, with an optimistic flip on tap reconciled against whatever the
 * server actually decided — confirmed vs. waitlisted is always the server's
 * call, never assumed client-side.
 */
export function RsvpControl({
  eventId,
  capacity,
  confirmedCount,
  myRsvp,
  windowState,
}: {
  eventId: string;
  capacity: number | null;
  confirmedCount: number;
  myRsvp: MyRsvp;
  windowState: "open" | "not_open" | "past" | "not_published";
}) {
  const [optimistic, setOptimistic] = useOptimistic<MyRsvp>(myRsvp);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const isFull = capacity !== null && confirmedCount >= capacity;
  const disabled = windowState !== "open";

  function confirmRsvp() {
    setOpen(false);
    startTransition(async () => {
      setOptimistic({ status: isFull ? "waitlist" : "confirmed", position: 0 });
      const res = await rsvpToEvent(eventId);
      if (res.ok) {
        setOptimistic({ status: res.status, position: res.position });
        toast.success(
          res.status === "confirmed" ? "You're in! Confirmed." : `Added to the waitlist (#${res.position}).`,
        );
      } else {
        setOptimistic(myRsvp);
        toast.error(RSVP_ERROR_MESSAGES[res.reason as keyof typeof RSVP_ERROR_MESSAGES] ?? "Something went wrong.");
      }
    });
  }

  function confirmCancel() {
    setOpen(false);
    startTransition(async () => {
      setOptimistic(null);
      const res = await cancelEventRsvp(eventId);
      if (res.ok) {
        toast.success("Cancelled.");
      } else {
        setOptimistic(myRsvp);
        toast.error(RSVP_ERROR_MESSAGES[res.reason as keyof typeof RSVP_ERROR_MESSAGES] ?? "Something went wrong.");
      }
    });
  }

  const label = disabled
    ? windowState === "not_open"
      ? "RSVPs not open yet"
      : windowState === "past"
        ? "Event has passed"
        : "Not available"
    : optimistic?.status === "confirmed"
      ? `You're in — #${optimistic.position}`
      : optimistic?.status === "waitlist"
        ? `Waitlisted — #${optimistic.position}`
        : isFull
          ? "Full — Join waitlist"
          : "RSVP";

  const isCancelIntent = optimistic !== null;

  return (
    <>
      {capacity !== null && (
        <div className="mb-5 flex items-center gap-3 text-sm text-ink/60">
          <CalendarCheck size={16} className="text-gold-500" />
          <span>
            <NumberFlow value={confirmedCount} /> / {capacity} confirmed
          </span>
        </div>
      )}

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Trigger asChild>
          <button
            type="button"
            disabled={disabled || pending}
            className={
              disabled
                ? "flex h-14 w-full items-center justify-center gap-2 bg-ink/10 font-display text-sm font-bold uppercase tracking-[0.12em] text-ink/40"
                : isCancelIntent
                  ? "flex h-14 w-full items-center justify-center gap-2 border-2 border-navy-900 bg-white font-display text-sm font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors hover:bg-chalk"
                  : "flex h-14 w-full items-center justify-center gap-2 bg-gold-500 font-display text-sm font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors hover:bg-gold-400"
            }
          >
            {label}
          </button>
        </Drawer.Trigger>

        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-navy-900 bg-white p-6 pb-10 outline-none">
            <div className="mx-auto mb-6 h-1.5 w-12 bg-ink/15" />
            <Drawer.Title className="font-display text-lg font-extrabold uppercase text-navy-900">
              {isCancelIntent ? "Cancel your RSVP?" : isFull ? "Join the waitlist?" : "Confirm your RSVP"}
            </Drawer.Title>
            <Drawer.Description className="mt-2 text-sm text-ink/60">
              {isCancelIntent
                ? "You'll give up your spot. If someone's waitlisted, they'll be promoted."
                : isFull
                  ? "This event is full. You'll be added to the waitlist and promoted automatically if a spot opens."
                  : "You're about to RSVP for this event."}
            </Drawer.Description>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-12 flex-1 items-center justify-center gap-2 border-2 border-navy-900/15 font-display text-xs font-bold uppercase tracking-[0.12em] text-ink/60"
              >
                <X size={15} /> Never mind
              </button>
              <button
                type="button"
                onClick={isCancelIntent ? confirmCancel : confirmRsvp}
                className={
                  isCancelIntent
                    ? "flex h-12 flex-1 items-center justify-center bg-red-600 font-display text-xs font-bold uppercase tracking-[0.12em] text-white"
                    : "flex h-12 flex-1 items-center justify-center bg-navy-900 font-display text-xs font-bold uppercase tracking-[0.12em] text-gold-500"
                }
              >
                {isCancelIntent ? "Cancel RSVP" : "Confirm"}
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
