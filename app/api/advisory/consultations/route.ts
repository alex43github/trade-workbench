import { listConsultations } from "@/lib/advisory/store";
export async function GET() { return Response.json(await listConsultations(), { headers: { "cache-control": "no-store" } }); }

