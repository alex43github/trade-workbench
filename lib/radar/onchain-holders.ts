import { calculateTop10Concentration, type Holder, type Top10Concentration } from "./chip-concentration.ts";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function valueAt(source: UnknownRecord, ...keys: string[]) {
  return keys.reduce<unknown>((current, key) => record(current)[key], source);
}

function rows(payload: unknown): Holder[] {
  const root = record(payload);
  const candidates = valueAt(root, "data", "EVM", "TokenHolders", "Holder")
    ?? valueAt(root, "data", "ethereum", "smartContractEvents")
    ?? root.holders
    ?? [];
  if (!Array.isArray(candidates)) return [];
  const parsed = candidates.map((candidate) => {
    const row = record(candidate);
    const address = record(row.address);
    const holder = record(row.holder);
    const holderCaps = record(row.Holder);
    const nestedHolder = record(holderCaps.Holder);
    const balance = record(row.Balance);
    const holderBalance = record(holderCaps.Balance);
    const entity = record(row.entity);
    const label = address.annotation ?? row.annotation ?? row.label ?? entity.name ?? holder.label;
    const category = address.type ?? row.type ?? entity.type;
    return {
      address: String(address.address ?? row.address ?? holder.address ?? holderCaps.Address ?? nestedHolder.Address ?? ""),
      balance: Number(row.balance ?? row.amount ?? row.value ?? holder.balance ?? balance.Amount ?? holderBalance.Amount ?? 0),
      label: typeof label === "string" ? label : null,
      category: typeof category === "string" ? category : null,
    };
  });
  return parsed.filter((row) => Boolean(row.address) && Number.isFinite(row.balance) && row.balance > 0);
}

export function buildTop10FromHolders(holders: Holder[]): Top10Concentration {
  return calculateTop10Concentration(holders);
}

export async function fetchOnchainTop10(
  chain: string,
  tokenAddress: string,
  options: { fetcher?: Fetcher; apiToken?: string; endpoint?: string } = {},
) {
  const apiToken = options.apiToken ?? process.env.BITQUERY_API_TOKEN;
  if (!apiToken || !tokenAddress) return { status: "pending" as const, top10Pct: null, eligibleTotal: 0, excludedCount: 0, excludedCategories: [] as string[] };
  const query = `query ($token: String!) { EVM { TokenHolders(filter: { Token: { Address: { is: $token } } }, limit: { count: 250 }, orderBy: { descending: Balance }) { Holder { Holder { Address } Balance { Amount } } } } }`;
  const response = await (options.fetcher ?? fetch)(options.endpoint ?? "https://streaming.bitquery.io/graphql", {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json", Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ query, variables: { token: tokenAddress }, chain }), signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`bitquery_${response.status}`);
  return buildTop10FromHolders(rows(await response.json()));
}
