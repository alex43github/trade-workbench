import { normalizeAddress, parseQuantity, stripHex, wordAt } from "./encoding.ts";
import type { ChainClientReadOnly } from "./readonly-chain.ts";
import type { TokenIdentity } from "./types.ts";

const DECIMALS_SELECTOR = "0x313ce567";
const SYMBOL_SELECTOR = "0x95d89b41";
const NAME_SELECTOR = "0x06fdde03";

export class TokenMetadataReader {
  private readonly chain: ChainClientReadOnly;

  constructor(chain: ChainClientReadOnly) {
    this.chain = chain;
  }

  async readToken(address: string): Promise<TokenIdentity> {
    const normalized = normalizeAddress(address);
    const errors: string[] = [];
    let decimals: number | null = null;
    let symbol: string | null = null;
    let name: string | null = null;

    try {
      const rawResult = await this.chain.call(normalized, DECIMALS_SELECTOR);
      if (!/^0x[0-9a-fA-F]{64}$/.test(rawResult)) throw new Error("decimals ABI word is malformed");
      const raw = parseQuantity(rawResult, "decimals");
      if (raw > BigInt(255)) throw new Error("decimals out of range");
      decimals = Number(raw);
    } catch (error) {
      errors.push("decimals: " + errorMessage(error));
    }
    try {
      symbol = decodeText(await this.chain.call(normalized, SYMBOL_SELECTOR));
    } catch (error) {
      errors.push("symbol: " + errorMessage(error));
    }
    try {
      name = decodeText(await this.chain.call(normalized, NAME_SELECTOR));
    } catch (error) {
      errors.push("name: " + errorMessage(error));
    }

    return {
      address: normalized,
      symbol,
      name,
      decimals,
      verification_status: errors.length === 0 ? "OBSERVED" : "UNKNOWN",
      errors,
    };
  }
}

function decodeText(value: string): string {
  const hex = stripHex(value);
  if (hex.length >= 128) {
    const offset = Number(BigInt("0x" + hex.slice(0, 64)));
    if (Number.isSafeInteger(offset) && offset >= 0 && offset + 32 <= hex.length / 2) {
      const length = Number(BigInt("0x" + hex.slice(offset * 2, offset * 2 + 64)));
      const start = offset * 2 + 64;
      const end = start + length * 2;
      if (Number.isSafeInteger(length) && end <= hex.length) {
        return decodeUtf8(hex.slice(start, end));
      }
    }
  }
  if (hex.length < 64) throw new Error("empty text ABI");
  return decodeUtf8(wordAt(value, 0).replace(/00+$/, ""));
}

function decodeUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) || []);
  const value = new TextDecoder().decode(bytes).replace(/\u0000+$/, "").trim();
  if (!value) throw new Error("empty text ABI");
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
