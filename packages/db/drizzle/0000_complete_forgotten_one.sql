CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`staff_id` int,
	`action` varchar(64) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(64) NOT NULL,
	`details` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role_id` int NOT NULL,
	`permission_key` varchar(64) NOT NULL,
	`allowed` boolean NOT NULL DEFAULT true,
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_role_perm_key` UNIQUE(`role_id`,`permission_key`)
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_sn` int NOT NULL,
	`code` varchar(16) NOT NULL,
	`name_zh` varchar(120) NOT NULL,
	`name_en` varchar(120) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `shops_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_shops_legacy_sn` UNIQUE(`legacy_sn`),
	CONSTRAINT `uq_shops_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_us` int,
	`legacy_id` varchar(32),
	`role_id` int NOT NULL,
	`shop_id` int NOT NULL,
	`display_name` varchar(120) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`pin_hash` varchar(255),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `staff_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_staff_legacy_id` UNIQUE(`legacy_id`)
);
--> statement-breakpoint
CREATE TABLE `staff_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(80) NOT NULL,
	`legacy_authority_level` int NOT NULL DEFAULT 1,
	CONSTRAINT `staff_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_staff_roles_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`legacy_mn` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`octopus_enabled` boolean NOT NULL DEFAULT true,
	`integrated_pax_edc_enabled` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `terminals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_terminals_shop_mn` UNIQUE(`shop_id`,`legacy_mn`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_c1` int NOT NULL,
	`name_zh` varchar(120) NOT NULL,
	`name_en` varchar(120) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_categories_c1` UNIQUE(`legacy_c1`)
);
--> statement-breakpoint
CREATE TABLE `label_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`width_mm` int NOT NULL,
	`height_mm` int NOT NULL,
	`definition` json NOT NULL,
	CONSTRAINT `label_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pos_menu_buttons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`menu_id` int NOT NULL,
	`product_id` int,
	`label_zh` varchar(80) NOT NULL,
	`label_en` varchar(80) NOT NULL,
	`grid_position` int NOT NULL DEFAULT 0,
	`color_hex` varchar(16),
	CONSTRAINT `pos_menu_buttons_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_menu_btn_pos` UNIQUE(`menu_id`,`grid_position`)
);
--> statement-breakpoint
CREATE TABLE `pos_menus` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`code` varchar(32) NOT NULL,
	`title_zh` varchar(120) NOT NULL,
	`title_en` varchar(120) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `pos_menus_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pos_menus_shop_code` UNIQUE(`shop_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`barcode` varchar(40) NOT NULL,
	`ubc` varchar(40) NOT NULL DEFAULT '',
	`name_zh` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL DEFAULT '',
	`category_id` int,
	`legacy_c1` int NOT NULL DEFAULT 0,
	`unit_id` int,
	`sell_price` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`fixed_price` decimal(18,4),
	`last_purchase_cost` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`avg_cost` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`allow_item_discount` boolean NOT NULL DEFAULT true,
	`exclude_from_crm_bonus` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_products_shop_barcode` UNIQUE(`shop_id`,`barcode`)
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_un` int NOT NULL,
	`name_zh` varchar(40) NOT NULL,
	`name_en` varchar(40) NOT NULL,
	CONSTRAINT `units_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_units_un` UNIQUE(`legacy_un`)
);
--> statement-breakpoint
CREATE TABLE `crm_point_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`bill_id` int,
	`rule_rid` int,
	`delta_points` int NOT NULL,
	`reason` varchar(120) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `crm_point_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_rid` int NOT NULL,
	`rule_name` varchar(120) NOT NULL,
	`description_en` varchar(255) NOT NULL,
	`action_type` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`priority` int NOT NULL DEFAULT 0,
	CONSTRAINT `crm_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_rules_rid` UNIQUE(`legacy_rid`)
);
--> statement-breakpoint
CREATE TABLE `customer_grades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_code` int NOT NULL,
	`name_zh` varchar(80) NOT NULL,
	`name_en` varchar(80) NOT NULL,
	`default_discount_rate` decimal(6,4) NOT NULL DEFAULT '0.0000',
	CONSTRAINT `customer_grades_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customer_grades_code` UNIQUE(`legacy_code`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_id` varchar(32) NOT NULL,
	`grade_id` int,
	`name_zh` varchar(160) NOT NULL,
	`name_en` varchar(160) NOT NULL DEFAULT '',
	`phone` varchar(40) NOT NULL DEFAULT '',
	`email` varchar(160) NOT NULL DEFAULT '',
	`points_balance` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customers_legacy_id` UNIQUE(`legacy_id`)
);
--> statement-breakpoint
CREATE TABLE `member_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`card_no` varchar(40) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `member_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_member_cards_no` UNIQUE(`card_no`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_id` varchar(32) NOT NULL,
	`name_zh` varchar(160) NOT NULL,
	`name_en` varchar(160) NOT NULL DEFAULT '',
	`phone` varchar(40) NOT NULL DEFAULT '',
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_suppliers_legacy_id` UNIQUE(`legacy_id`)
);
--> statement-breakpoint
CREATE TABLE `bill_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bill_id` int NOT NULL,
	`line_no` int NOT NULL,
	`product_id` int,
	`sku` varchar(40) NOT NULL,
	`name_zh` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL DEFAULT '',
	`category_c1` int NOT NULL DEFAULT 0,
	`legacy_dk` int NOT NULL DEFAULT 1,
	`quantity` decimal(18,4) NOT NULL,
	`unit_price` decimal(18,4) NOT NULL,
	`discount_rate` decimal(8,6) NOT NULL DEFAULT '0.000000',
	`line_discount_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`line_total` decimal(18,4) NOT NULL,
	`cancelled` boolean NOT NULL DEFAULT false,
	`is_modifier` boolean NOT NULL DEFAULT false,
	CONSTRAINT `bill_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bill_lines_bill_lineno` UNIQUE(`bill_id`,`line_no`)
);
--> statement-breakpoint
CREATE TABLE `bill_sequences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`terminal_id` int NOT NULL,
	`doc_type` varchar(24) NOT NULL,
	`next_seq` int NOT NULL DEFAULT 1,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bill_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bill_seq_scope` UNIQUE(`shop_id`,`terminal_id`,`doc_type`)
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_rl` varchar(32),
	`client_idempotency_key` varchar(64),
	`shop_id` int NOT NULL,
	`terminal_id` int NOT NULL,
	`staff_id` int,
	`customer_id` int,
	`invoice_no` varchar(40) NOT NULL,
	`doc_type` varchar(24) NOT NULL,
	`source_table` varchar(16) NOT NULL DEFAULT 'POS_V2',
	`legacy_sc` varchar(32),
	`legacy_xc` int NOT NULL DEFAULT 99,
	`legacy_xt` int NOT NULL DEFAULT 1,
	`legacy_sd` int NOT NULL DEFAULT -1,
	`status` varchar(16) NOT NULL DEFAULT 'completed',
	`payment_status` varchar(16) NOT NULL DEFAULT 'unpaid',
	`business_date` varchar(10) NOT NULL,
	`gross_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`discount_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`net_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`paid_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`balance_due` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`issued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`paid_at` datetime,
	`notes` varchar(500),
	CONSTRAINT `bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bills_legacy_rl` UNIQUE(`legacy_rl`),
	CONSTRAINT `uq_bills_invoice_no` UNIQUE(`invoice_no`),
	CONSTRAINT `uq_bills_idempotency` UNIQUE(`client_idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `delivery_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bill_id` int NOT NULL,
	`legacy_orl` varchar(32),
	`scheduled_date` datetime,
	`delivery_status` varchar(24) NOT NULL DEFAULT 'pending',
	`remarks` varchar(255),
	CONSTRAINT `delivery_orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `petty_cash_vouchers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`bill_id` int,
	`amount` decimal(18,4) NOT NULL,
	`reason` varchar(255) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `petty_cash_vouchers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bill_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bill_id` int NOT NULL,
	`pay_method_id` int NOT NULL,
	`legacy_pk` int,
	`client_idempotency_key` varchar(64),
	`staff_id` int,
	`tender_code` varchar(24) NOT NULL,
	`amount` decimal(18,4) NOT NULL,
	`tips_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`paid_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`business_date` varchar(10) NOT NULL,
	`approval_code` varchar(16),
	`card_last4` varchar(4),
	`masked_pan` varchar(24),
	`reference_no` varchar(64),
	`remarks` varchar(255),
	`voided` boolean NOT NULL DEFAULT false,
	CONSTRAINT `bill_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bill_pmt_idem` UNIQUE(`client_idempotency_key`),
	CONSTRAINT `uq_bill_pmt_legacy` UNIQUE(`bill_id`,`legacy_pk`)
);
--> statement-breakpoint
CREATE TABLE `edc_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bill_id` int NOT NULL,
	`ecr_ref` varchar(24) NOT NULL,
	`resp_code` varchar(8) NOT NULL,
	`card_type` varchar(16) NOT NULL,
	`masked_pan` varchar(24) NOT NULL,
	`approval_code` varchar(16),
	`trace_no` varchar(16),
	`batch_no` varchar(16),
	`rrn` varchar(24),
	`amount` decimal(18,4) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `edc_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_edc_ecr_ref` UNIQUE(`ecr_ref`)
);
--> statement-breakpoint
CREATE TABLE `octopus_settlements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`terminal_id` int NOT NULL,
	`xfile_name` varchar(120) NOT NULL,
	`txn_count` int NOT NULL,
	`total_cents` int NOT NULL,
	`osdxc_uploaded` boolean NOT NULL DEFAULT false,
	`settled_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `octopus_settlements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `octopus_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bill_id` int NOT NULL,
	`bill_payment_id` int,
	`shop_id` int NOT NULL,
	`terminal_id` int NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`card_id` varchar(32) NOT NULL,
	`device_id` varchar(32) NOT NULL,
	`amount_cents` int NOT NULL,
	`remaining_value_cents` int,
	`result_code` int NOT NULL,
	`incomplete_100022_recovered` boolean NOT NULL DEFAULT false,
	`transacted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `octopus_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_octo_req_id` UNIQUE(`request_id`)
);
--> statement-breakpoint
CREATE TABLE `pay_methods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_pm` int,
	`code` varchar(24) NOT NULL,
	`mode` varchar(32) NOT NULL,
	`name_zh` varchar(80) NOT NULL,
	`name_en` varchar(80) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `pay_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pay_methods_code` UNIQUE(`code`),
	CONSTRAINT `uq_pay_methods_pm` UNIQUE(`legacy_pm`)
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL DEFAULT 0,
	`setting_key` varchar(64) NOT NULL,
	`setting_value` json NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_app_settings_key` UNIQUE(`shop_id`,`setting_key`)
);
--> statement-breakpoint
CREATE TABLE `daily_hourly_sales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`business_date` varchar(10) NOT NULL,
	`hour_of_day` int NOT NULL,
	`bill_count` int NOT NULL DEFAULT 0,
	`net_sales_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
	CONSTRAINT `daily_hourly_sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dhsales_hour` UNIQUE(`shop_id`,`business_date`,`hour_of_day`)
);
--> statement-breakpoint
CREATE TABLE `day_end_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legacy_bk` varchar(32),
	`shop_id` int NOT NULL,
	`terminal_id` int NOT NULL,
	`business_date` varchar(10) NOT NULL,
	`batch_no` int NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`issued_sales_total` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`collected_payments_total` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`closed` boolean NOT NULL DEFAULT false,
	`closed_at` datetime,
	CONSTRAINT `day_end_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_day_end_scope` UNIQUE(`shop_id`,`terminal_id`,`business_date`,`batch_no`),
	CONSTRAINT `uq_day_end_legacy_bk` UNIQUE(`legacy_bk`)
);
--> statement-breakpoint
CREATE TABLE `day_end_tender_counts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`tender_code` varchar(24) NOT NULL,
	`expected_collected_amount` decimal(18,4) NOT NULL,
	`counted_amount` decimal(18,4) NOT NULL,
	`variance_amount` decimal(18,4) NOT NULL,
	CONSTRAINT `day_end_tender_counts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_balances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`product_id` int NOT NULL,
	`on_hand_qty` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`moving_avg_cost` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `stock_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_shop_product` UNIQUE(`shop_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`product_id` int NOT NULL,
	`bill_id` int,
	`movement_type` varchar(24) NOT NULL,
	`legacy_xc` int,
	`on_hand_delta` decimal(18,4) NOT NULL,
	`unit_cost` decimal(18,4) NOT NULL,
	`moving_avg_cost_after` decimal(18,4) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_take_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stock_take_id` int NOT NULL,
	`product_id` int NOT NULL,
	`expected_qty` decimal(18,4) NOT NULL,
	`counted_qty` decimal(18,4) NOT NULL,
	CONSTRAINT `stock_take_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_takes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop_id` int NOT NULL,
	`staff_id` int,
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`snapshot_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `stock_takes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_staff_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `staff_roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff` ADD CONSTRAINT `staff_role_id_staff_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `staff_roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff` ADD CONSTRAINT `staff_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `terminals_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pos_menu_buttons` ADD CONSTRAINT `pos_menu_buttons_menu_id_pos_menus_id_fk` FOREIGN KEY (`menu_id`) REFERENCES `pos_menus`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pos_menu_buttons` ADD CONSTRAINT `pos_menu_buttons_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pos_menus` ADD CONSTRAINT `pos_menus_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_unit_id_units_id_fk` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_point_ledger` ADD CONSTRAINT `crm_point_ledger_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_grade_id_customer_grades_id_fk` FOREIGN KEY (`grade_id`) REFERENCES `customer_grades`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member_cards` ADD CONSTRAINT `member_cards_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_lines` ADD CONSTRAINT `bill_lines_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_lines` ADD CONSTRAINT `bill_lines_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_sequences` ADD CONSTRAINT `bill_sequences_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_sequences` ADD CONSTRAINT `bill_sequences_terminal_id_terminals_id_fk` FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_terminal_id_terminals_id_fk` FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_staff_id_staff_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_orders` ADD CONSTRAINT `delivery_orders_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_vouchers` ADD CONSTRAINT `petty_cash_vouchers_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `petty_cash_vouchers` ADD CONSTRAINT `petty_cash_vouchers_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_payments` ADD CONSTRAINT `bill_payments_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_payments` ADD CONSTRAINT `bill_payments_pay_method_id_pay_methods_id_fk` FOREIGN KEY (`pay_method_id`) REFERENCES `pay_methods`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_payments` ADD CONSTRAINT `bill_payments_staff_id_staff_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `edc_transactions` ADD CONSTRAINT `edc_transactions_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `octopus_settlements` ADD CONSTRAINT `octopus_settlements_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `octopus_settlements` ADD CONSTRAINT `octopus_settlements_terminal_id_terminals_id_fk` FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `octopus_transactions` ADD CONSTRAINT `octopus_transactions_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `octopus_transactions` ADD CONSTRAINT `octopus_transactions_bill_payment_id_bill_payments_id_fk` FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `octopus_transactions` ADD CONSTRAINT `octopus_transactions_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `octopus_transactions` ADD CONSTRAINT `octopus_transactions_terminal_id_terminals_id_fk` FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_hourly_sales` ADD CONSTRAINT `daily_hourly_sales_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `day_end_batches` ADD CONSTRAINT `day_end_batches_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `day_end_batches` ADD CONSTRAINT `day_end_batches_terminal_id_terminals_id_fk` FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `day_end_tender_counts` ADD CONSTRAINT `day_end_tender_counts_batch_id_day_end_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `day_end_batches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_balances` ADD CONSTRAINT `stock_balances_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_balances` ADD CONSTRAINT `stock_balances_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_take_lines` ADD CONSTRAINT `stock_take_lines_stock_take_id_stock_takes_id_fk` FOREIGN KEY (`stock_take_id`) REFERENCES `stock_takes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_take_lines` ADD CONSTRAINT `stock_take_lines_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_takes` ADD CONSTRAINT `stock_takes_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_takes` ADD CONSTRAINT `stock_takes_staff_id_staff_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_products_ubc` ON `products` (`ubc`);--> statement-breakpoint
CREATE INDEX `idx_products_c1` ON `products` (`legacy_c1`);--> statement-breakpoint
CREATE INDEX `idx_crm_ledger_cust` ON `crm_point_ledger` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_customers_phone` ON `customers` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_bill_lines_bill` ON `bill_lines` (`bill_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `idx_bills_shop_bdate_status` ON `bills` (`shop_id`,`business_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bills_payment_ar` ON `bills` (`payment_status`,`balance_due`);--> statement-breakpoint
CREATE INDEX `idx_bills_customer` ON `bills` (`customer_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `idx_bill_pmt_bill` ON `bill_payments` (`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_bill_pmt_bdate_tender` ON `bill_payments` (`business_date`,`tender_code`);--> statement-breakpoint
CREATE INDEX `idx_octo_card` ON `octopus_transactions` (`card_id`,`transacted_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_mov_prod_time` ON `stock_movements` (`shop_id`,`product_id`,`created_at`);