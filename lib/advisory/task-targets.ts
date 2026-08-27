import { configuredChannels, type AiProtocol } from "./channel-config.ts";
import { getServerCredential } from "../server-credentials.ts";
import { routeTargets, type AiTaskKind } from "./task-routing.ts";
import type { CompatibleTarget } from "./model-gateway.ts";

type RoutingChannel = {
  id: string;
  name: string;
  baseUrl: string;
  protocol: AiProtocol;
  secretKey: string;
  models: Array<{ label: string; model: string }>;
};

export async function resolveTaskTargets(task: AiTaskKind, options: {
  channels?: readonly RoutingChannel[];
  getCredential?: (key: string) => Promise<string | undefined>;
} = {}) {
  const channels = options.channels ?? configuredChannels();
  const getCredential = options.getCredential ?? ((key: string) => getServerCredential(key as Parameters<typeof getServerCredential>[0]));
  const credentialByKey = new Map<string, string | undefined>();
  const targets: CompatibleTarget[] = [];
  for (const channel of channels) {
    let apiKey = credentialByKey.get(channel.secretKey);
    if (!credentialByKey.has(channel.secretKey)) {
      apiKey = await getCredential(channel.secretKey);
      credentialByKey.set(channel.secretKey, apiKey);
    }
    if (!apiKey) continue;
    for (const model of channel.models) {
      targets.push({ id: channel.id, name: channel.name, model: model.model, protocol: channel.protocol, endpoint: channel.baseUrl, apiKey });
    }
  }
  return routeTargets(task, targets);
}
