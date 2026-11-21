CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_incident_idx` ON `artifacts` (`incident_id`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` text NOT NULL,
	`provider` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decisions_incident_idx` ON `decisions` (`incident_id`);--> statement-breakpoint
CREATE TABLE `incident_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`step` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`payload_json` text DEFAULT 'null' NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_events_incident_seq_idx` ON `incident_events` (`incident_id`,`seq`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`workspace` text NOT NULL,
	`status` text NOT NULL,
	`failure_class` text,
	`stage` text,
	`route` text,
	`pr_url` text,
	`pr_number` integer,
	`needs_human` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`resolved_at` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`parent_incident_id` text
);
--> statement-breakpoint
CREATE INDEX `incidents_run_id_idx` ON `incidents` (`run_id`);--> statement-breakpoint
CREATE INDEX `incidents_created_at_idx` ON `incidents` (`created_at`);