export function normalizeAddress(value: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("invalid address");
  }
  return value.toLowerCase();
}

export function isZeroAddress(value: string): boolean {
  return normalizeAddress(value) === "0x" + "0".repeat(40);
}

export function encodeAddress(value: string): string {
  return normalizeAddress(value).slice(2).padStart(64, "0");
}

export function stripHex(value: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error("malformed hex data");
  }
  return value.slice(2);
}

export function parseQuantity(value: string, label = "quantity"): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("malformed hex " + label);
  }
  return BigInt(value);
}

export function wordAt(value: string, index: number): string {
  const hex = stripHex(value);
  const start = index * 64;
  const word = hex.slice(start, start + 64);
  if (word.length !== 64) {
    throw new Error("malformed ABI word");
  }
  return word;
}
