DROP INDEX `incidents_run_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_run_id_idx` ON `incidents` (`run_id`);