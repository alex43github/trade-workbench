DROP INDEX `idx_expert_positions_account_symbol`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expert_positions_account_symbol` ON `expert_positions` (`account_id`,`symbol`);