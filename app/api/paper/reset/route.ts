import { paperSimulationRetired } from "../../../../lib/trade/paper-retired.ts";

export async function POST() {
  return paperSimulationRetired();
}
