CREATE TABLE `paper_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`initial_balance` real NOT NULL,
	`cash_balance` real NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`total_fees` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_equity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`recorded_at` integer NOT NULL,
	`equity` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_paper_equity_recorded` ON `paper_equity_snapshots` (`recorded_at`);--> statement-breakpoint
CREATE TABLE `paper_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`intent` text NOT NULL,
	`type` text NOT NULL,
	`trigger_price` real,
	`quantity` real NOT NULL,
	`status` text NOT NULL,
	`score` integer NOT NULL,
	`plan_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`filled_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_paper_orders_status_created` ON `paper_orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_paper_orders_symbol_status` ON `paper_orders` (`symbol`,`status`);--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` real NOT NULL,
	`entry_price` real NOT NULL,
	`leverage` integer DEFAULT 3 NOT NULL,
	`entries` integer DEFAULT 1 NOT NULL,
	`stop_price` real,
	`target_price` real,
	`strategy_score` integer NOT NULL,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_paper_positions_symbol` ON `paper_positions` (`symbol`);--> statement-breakpoint
CREATE TABLE `paper_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`intent` text NOT NULL,
	`price` real NOT NULL,
	`quantity` real NOT NULL,
	`fee` real NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_paper_trades_created` ON `paper_trades` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_paper_trades_symbol_created` ON `paper_trades` (`symbol`,`created_at`);