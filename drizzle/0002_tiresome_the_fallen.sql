CREATE TABLE `consensus_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`consultation_id` text NOT NULL,
	`direction` text NOT NULL,
	`strength` text NOT NULL,
	`push_eligible` integer DEFAULT 0 NOT NULL,
	`state_version` integer DEFAULT 1 NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consensus_decisions_consultation_id_unique` ON `consensus_decisions` (`consultation_id`);--> statement-breakpoint
CREATE TABLE `consultations` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_date` text NOT NULL,
	`symbol` text NOT NULL,
	`status` text NOT NULL,
	`market_snapshot_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consultations_idempotency_key_unique` ON `consultations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_consultations_date_symbol` ON `consultations` (`analysis_date`,`symbol`);--> statement-breakpoint
CREATE TABLE `expert_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`expert_id` text NOT NULL,
	`season_id` text NOT NULL,
	`initial_balance` real DEFAULT 500 NOT NULL,
	`cash_balance` real DEFAULT 500 NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`total_fees` real DEFAULT 0 NOT NULL,
	`max_leverage` integer DEFAULT 10 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expert_accounts_expert_season` ON `expert_accounts` (`expert_id`,`season_id`);--> statement-breakpoint
CREATE TABLE `expert_equity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`equity` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expert_equity_account_recorded` ON `expert_equity_snapshots` (`account_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `expert_opinions` (
	`id` text PRIMARY KEY NOT NULL,
	`consultation_id` text NOT NULL,
	`expert_id` text NOT NULL,
	`round` text NOT NULL,
	`direction` text NOT NULL,
	`skill_version` text NOT NULL,
	`decision_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expert_opinions_consultation_round` ON `expert_opinions` (`consultation_id`,`round`);--> statement-breakpoint
CREATE TABLE `expert_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`consultation_id` text,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`intent` text NOT NULL,
	`type` text NOT NULL,
	`trigger_price` real,
	`quantity` real NOT NULL,
	`status` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`filled_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_expert_orders_account_status` ON `expert_orders` (`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `expert_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`consultation_id` text,
	`strategy_version_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` real NOT NULL,
	`entry_price` real NOT NULL,
	`leverage` integer NOT NULL,
	`isolated_margin` real NOT NULL,
	`stop_price` real,
	`target_price` real,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expert_positions_account_symbol` ON `expert_positions` (`account_id`,`symbol`);--> statement-breakpoint
CREATE TABLE `expert_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`order_id` text NOT NULL,
	`symbol` text NOT NULL,
	`price` real NOT NULL,
	`quantity` real NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expert_trades_account_created` ON `expert_trades` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `experts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`skill_version` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`error` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_idempotency_key_unique` ON `job_runs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`source_mode` text NOT NULL,
	`quality` text NOT NULL,
	`last_closed_at` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_market_snapshots_symbol_created` ON `market_snapshots` (`symbol`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_dedupe_key_unique` ON `notification_deliveries` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `review_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`expert_id` text NOT NULL,
	`judgment_score` integer NOT NULL,
	`execution_score` integer NOT NULL,
	`outcome_score` integer NOT NULL,
	`attribution_json` text DEFAULT '[]' NOT NULL,
	`candidate_experience_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_review_reports_expert_created` ON `review_reports` (`expert_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`consultation_id` text,
	`trade_id` text,
	`review_type` text NOT NULL,
	`status` text NOT NULL,
	`due_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_review_tasks_status_due` ON `review_tasks` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `strategy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`expert_id` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_strategy_versions_expert_created` ON `strategy_versions` (`expert_id`,`created_at`);