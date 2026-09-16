import { runExecutionForwardCycle } from "../lib/radar/execution-forward-cycle.ts";

const result = await runExecutionForwardCycle({ dryRun: true });
console.log(result.marker);
console.log(JSON.stringify(result));
