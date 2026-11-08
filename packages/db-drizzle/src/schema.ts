import { integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const logs = pgTable('logs', {
	id: serial().primaryKey().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	message: text().notNull(),
})

export const devices = pgTable('devices', {
	id: uuid().primaryKey().defaultRandom().notNull(),
	owner_id: uuid().notNull(),
	name: text().notNull(),
	host: text().notNull(),
	port: integer().notNull().default(22),
	username: text().notNull().default('pi'),
	auth_method: text({ enum: ['password', 'key'] }).notNull().default('password'),
	secret_encrypted: text().notNull(),
	remote_path: text().notNull().default('raspberry-pi-script'),
	gpio_pins: integer().array().notNull().default([6]),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const deployments = pgTable('deployments', {
	id: serial().primaryKey().notNull(),
	device_id: uuid()
		.notNull()
		.references(() => devices.id, { onDelete: 'cascade' }),
	status: text({ enum: ['running', 'success', 'failed'] })
		.notNull()
		.default('running'),
	started_at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
	finished_at: timestamp({ withTimezone: true, mode: 'string' }),
	output: text().notNull().default(''),
	triggered_by: text(),
})
