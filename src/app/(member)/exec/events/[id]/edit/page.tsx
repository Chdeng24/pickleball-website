import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { EventForm } from "../../event-form";

export const metadata: Metadata = { title: "Edit Event" };

export default async function EditEventPage({ params }: PageProps<"/exec/events/[id]/edit">) {
  await requireExec();
  const { id } = await params;

  const [event] = await db().select().from(schema.events).where(eq(schema.events.id, id));
  if (!event) notFound();

  return (
    <div className="space-y-8">
      <Link
        href="/exec/events"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 underline underline-offset-2"
      >
        <ArrowLeft size={14} /> Back to events
      </Link>
      <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">
        Edit event
      </h1>
      <div className="border-2 border-navy-900/10 bg-white p-6">
        <EventForm defaults={event} />
      </div>
    </div>
  );
}
