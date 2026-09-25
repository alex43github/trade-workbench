# HyperGrid Semantics

G0 defines observation only. The following state vocabulary is reserved for the paper-grid gate and prevents an observed quote from being mistaken for an order.

```text
DISCOVERED -> OBSERVING -> PAPER_READY -> PAPER_OPEN -> PAPER_CLOSED
                         \\-> BLOCKED
```

- `DISCOVERED`: address/code and basic identity were read.
- `OBSERVING`: snapshot is fresh enough for research and has explicit source block.
- `PAPER_READY`: metadata, price orientation, liquidity and risk inputs pass paper gates.
- `PAPER_OPEN` / `PAPER_CLOSED`: synthetic inventory lifecycle only; no live order exists.
- `BLOCKED`: missing metadata, stale block, unsupported interface, zero/unsafe liquidity policy, or health error.

Paper grid semantics must distinguish:

- mid-price observation from executable quote;
- synthetic fill from chain event;
- inventory amount from wallet balance;
- realized PnL from mark-to-market PnL;
- stale data from a genuine zero price;
- a configured grid level from an actual order.

G0 never emits `EXECUTING`, `LIVE_OPEN`, `LIVE_FILLED`, `APPROVED` or `CANCEL_SENT` states.
