import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/guard";
import { homeFor } from "@/lib/auth/session";

export default async function Home() {
  const session = await currentSession();
  redirect(session ? homeFor(session.role) : "/login");
}
