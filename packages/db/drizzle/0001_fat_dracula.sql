ALTER TABLE `products` ADD `color_name` varchar(80) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `size_name` varchar(80) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `address` varchar(300) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bill_lines` ADD `notes` varchar(300) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bill_lines` ADD `serial_no` varchar(80) DEFAULT '' NOT NULL;