CREATE TABLE `trade_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`phase` text NOT NULL,
	`status` text NOT NULL,
	`score` integer NOT NULL,
	`outcome` text,
	`pnl` real,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`strengths_json` text DEFAULT '[]' NOT NULL,
	`mistakes_json` text DEFAULT '[]' NOT NULL,
	`plan_json` text DEFAULT '{}' NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`source_refs_json` text DEFAULT '[]' NOT NULL,
	`knowledge_version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trade_knowledge_symbol_created` ON `trade_knowledge` (`symbol`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_trade_knowledge_phase_created` ON `trade_knowledge` (`phase`,`created_at`);