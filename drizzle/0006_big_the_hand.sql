CREATE TABLE `pending_paper_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`consultation_id` text NOT NULL,
	`expert_id` text NOT NULL,
	`symbol` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`valid_until` text NOT NULL,
	`decision_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pending_plans_account_consultation` ON `pending_paper_plans` (`account_id`,`consultation_id`);--> statement-breakpoint
CREATE INDEX `idx_pending_plans_status_symbol` ON `pending_paper_plans` (`status`,`symbol`);