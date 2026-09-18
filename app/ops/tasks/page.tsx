import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isTaskCenterEnabled } from "@/lib/task-center/access";
import TaskCenterClient from "./TaskCenterClient";

export const dynamic = "force-dynamic";

export default async function TaskCenterPage() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const request = new Request("http://localhost/ops/tasks", { headers: { "x-forwarded-host": forwardedHost } });
  if (!isTaskCenterEnabled(request)) notFound();
  return <TaskCenterClient />;
}
