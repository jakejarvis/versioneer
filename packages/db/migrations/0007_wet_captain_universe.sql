ALTER TABLE `client_inventory_apps` ADD `is_mas_app` integer;--> statement-breakpoint
ALTER TABLE `client_inventory_apps` ADD `electron_update_url` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `is_mas_app` integer;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `electron_update_url` text;