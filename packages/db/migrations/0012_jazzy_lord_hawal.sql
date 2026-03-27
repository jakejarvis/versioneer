ALTER TABLE `client_inventory_apps` ADD `is_homebrew_installed` integer;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `homebrew_cask_token` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `homebrew_cask_version` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `homebrew_cask_appcast_url` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `homebrew_cask_homepage` text;--> statement-breakpoint
ALTER TABLE `discovered_apps` ADD `homebrew_cask_matched_at` text;