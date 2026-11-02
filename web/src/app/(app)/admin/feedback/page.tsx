"use client";

import { FeedbackPanel } from "@/components/staff";
import { PageHeader } from "@/components/ui";
import { useApi } from "@/components/use-api";

export default function FeedbackAdmin() {
  const meta = useApi<{ activities: Array<{ a_id: number; a_name: string }> }>("/api/meta");
  return (
    <>
      <PageHeader title="Feedback" subtitle="What students said about each activity" />
      <FeedbackPanel activities={meta.data?.activities ?? []} />
    </>
  );
}
