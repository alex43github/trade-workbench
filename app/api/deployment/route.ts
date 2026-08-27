import { NextResponse } from "next/server";
import { getDeploymentStatus, triggerDeploymentUpdate } from "@/lib/deploy-control";
import { probeGateway } from "@/lib/binance-gateway";
import { requireOperator, requireOperatorMutation } from "@/lib/security/operator-guard";

async function payload(status = getDeploymentStatus()) {
  const gateway = await probeGateway();
  return {
    ...status,
    gateway: {
      configured: gateway.configured,
      connected: gateway.connected,
      message: gateway.message,
    },
  };
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  return NextResponse.json(await payload(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  return NextResponse.json(await payload(await triggerDeploymentUpdate()), { headers: { "cache-control": "no-store" } });
}
