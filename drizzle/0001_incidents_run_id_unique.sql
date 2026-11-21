-- Keep one incident per run: the one with a fix PR (approval needs it), else the earliest. The migrator may run without foreign_keys, so children are deleted explicitly.
DELETE FROM `incident_events` WHERE `incident_id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `pr_number` IS NULL, `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DELETE FROM `decisions` WHERE `incident_id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `pr_number` IS NULL, `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DELETE FROM `artifacts` WHERE `incident_id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `pr_number` IS NULL, `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DELETE FROM `incidents` WHERE `id` IN (SELECT `id` FROM (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `pr_number` IS NULL, `created_at`, `id`) AS `rn` FROM `incidents`
) WHERE `rn` > 1);--> statement-breakpoint
DROP INDEX `incidents_run_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_run_id_idx` ON `incidents` (`run_id`);
