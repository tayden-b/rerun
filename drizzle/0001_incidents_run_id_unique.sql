-- Keep the earliest incident per run (the migrator may run without foreign_keys, so no cascade).
DELETE FROM `incident_events` WHERE `incident_id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DELETE FROM `decisions` WHERE `incident_id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DELETE FROM `artifacts` WHERE `incident_id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DELETE FROM `incidents` WHERE `id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DROP INDEX `incidents_run_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_run_id_idx` ON `incidents` (`run_id`);
