import { paperSimulationRetired } from "../../../lib/trade/paper-retired.ts";

export async function GET() {
  return paperSimulationRetired();
}
