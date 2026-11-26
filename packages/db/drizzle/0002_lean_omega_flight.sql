ALTER TABLE `delivery_orders` ADD `recipient_phone` varchar(60) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_orders` ADD `delivery_address` varchar(500) DEFAULT '' NOT NULL;