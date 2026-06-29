import { pgTable, serial, varchar, text, timestamp, boolean, integer, numeric, jsonb, index, uuid } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// System health check table (DO NOT DELETE)
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// User profiles - extends Supabase auth.users
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull().unique(),
    nickname: varchar("nickname", { length: 128 }),
    display_nickname: varchar("display_nickname", { length: 128 }),
    avatar_url: text("avatar_url"),
    phone: varchar("phone", { length: 20 }),
    role: varchar("role", { length: 32 }).notNull().default("user"), // guest, user, vip, enterprise_admin, enterprise_member, admin
    membership_tier: varchar("membership_tier", { length: 32 }).notNull().default("free"), // free, basic, pro, enterprise
    membership_expires_at: timestamp("membership_expires_at", { withTimezone: true }),
    credits_balance: integer("credits_balance").notNull().default(0),
    invite_code: varchar("invite_code", { length: 32 }),
    referred_by_user_id: uuid("referred_by_user_id"),
    daily_quota_used: integer("daily_quota_used").notNull().default(0),
    daily_quota_limit: integer("daily_quota_limit").notNull().default(5),
    is_active: boolean("is_active").default(true).notNull(),
    preferred_theme: varchar("preferred_theme", { length: 16 }).notNull().default("dark"),
    watermark_disabled: boolean("watermark_disabled").default(false).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("profiles_email_idx").on(table.email),
    index("profiles_role_idx").on(table.role),
    index("profiles_referred_by_user_id_idx").on(table.referred_by_user_id),
  ]
);

// User works (generated images/videos)
export const works = pgTable(
  "works",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().default(sql`auth.uid()`),
    title: varchar("title", { length: 255 }),
    type: varchar("type", { length: 32 }).notNull(), // text2img, img2img, text2video, img2video
    prompt: text("prompt"),
    negative_prompt: text("negative_prompt"),
    params: jsonb("params"), // generation parameters
    result_url: text("result_url"), // URL to generated file
    thumbnail_url: text("thumbnail_url"),
    width: integer("width"),
    height: integer("height"),
    duration: numeric("duration", { precision: 6, scale: 2 }), // video duration in seconds
    is_public: boolean("is_public").default(false).notNull(),
    likes_count: integer("likes_count").default(0).notNull(),
    credits_cost: integer("credits_cost").default(0).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("completed"), // pending, processing, completed, failed
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("works_user_id_idx").on(table.user_id),
    index("works_type_idx").on(table.type),
    index("works_is_public_idx").on(table.is_public),
    index("works_created_at_idx").on(table.created_at),
    index("works_status_idx").on(table.status),
  ]
);

// Credit transactions
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().default(sql`auth.uid()`),
    amount: integer("amount").notNull(), // positive = credit, negative = debit
    balance_after: integer("balance_after").notNull(),
    type: varchar("type", { length: 32 }).notNull(), // purchase, consume, gift, reward, refund
    description: varchar("description", { length: 500 }),
    related_work_id: uuid("related_work_id"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("credit_transactions_user_id_idx").on(table.user_id),
    index("credit_transactions_type_idx").on(table.type),
    index("credit_transactions_created_at_idx").on(table.created_at),
  ]
);

// Invitation referrals
export const invitationReferrals = pgTable(
  "invitation_referrals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    invite_code: varchar("invite_code", { length: 32 }).notNull(),
    inviter_user_id: uuid("inviter_user_id").notNull(),
    invitee_user_id: uuid("invitee_user_id").notNull().unique(),
    inviter_bonus_credits: integer("inviter_bonus_credits").notNull().default(50),
    invitee_bonus_credits: integer("invitee_bonus_credits").notNull().default(50),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("invitation_referrals_inviter_idx").on(table.inviter_user_id, table.created_at),
    index("invitation_referrals_invitee_idx").on(table.invitee_user_id),
    index("invitation_referrals_created_at_idx").on(table.created_at),
  ]
);

// Redeem codes
export const redeemCodes = pgTable(
  "redeem_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 64 }).notNull().unique(),
    normalized_code: varchar("normalized_code", { length: 64 }).notNull().unique(),
    code_type: varchar("code_type", { length: 16 }).notNull().default("credits"),
    credits_amount: integer("credits_amount").notNull().default(0),
    membership_tier: varchar("membership_tier", { length: 32 }),
    membership_duration_value: integer("membership_duration_value"),
    membership_duration_unit: varchar("membership_duration_unit", { length: 16 }),
    batch_id: uuid("batch_id").notNull().default(sql`gen_random_uuid()`),
    note: varchar("note", { length: 255 }).notNull().default(""),
    is_active: boolean("is_active").default(true).notNull(),
    created_by: uuid("created_by"),
    used_by: uuid("used_by"),
    used_at: timestamp("used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("redeem_codes_created_at_idx").on(table.created_at),
    index("redeem_codes_batch_id_idx").on(table.batch_id),
    index("redeem_codes_used_by_idx").on(table.used_by),
    index("redeem_codes_status_idx").on(table.is_active, table.used_at),
    index("redeem_codes_type_idx").on(table.code_type),
  ]
);

// Orders
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().default(sql`auth.uid()`),
    order_no: varchar("order_no", { length: 64 }).notNull().unique(),
    product_type: varchar("product_type", { length: 32 }).notNull(), // membership, credits, api
    product_name: varchar("product_name", { length: 255 }).notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    credits_amount: integer("credits_amount"), // credits purchased
    status: varchar("status", { length: 32 }).notNull().default("pending"), // pending, paid, cancelled, refunded
    payment_method: varchar("payment_method", { length: 32 }), // wechat, alipay, stripe
    paid_at: timestamp("paid_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("orders_user_id_idx").on(table.user_id),
    index("orders_order_no_idx").on(table.order_no),
    index("orders_status_idx").on(table.status),
    index("orders_created_at_idx").on(table.created_at),
  ]
);

// Model call audit records
export const modelCallRecords = pgTable(
  "model_call_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id"),
    source: varchar("source", { length: 64 }).notNull().default(""),
    operation: varchar("operation", { length: 64 }).notNull().default(""),
    generation_job_id: uuid("generation_job_id"),
    type: varchar("type", { length: 32 }).notNull().default("text"),
    provider: varchar("provider", { length: 128 }).notNull().default(""),
    model_name: varchar("model_name", { length: 255 }).notNull().default(""),
    api_url: text("api_url").notNull().default(""),
    system_api_id: uuid("system_api_id"),
    custom_api_key_id: uuid("custom_api_key_id"),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    credits_cost: integer("credits_cost").notNull().default(0),
    result_count: integer("result_count").notNull().default(0),
    duration_ms: integer("duration_ms").notNull().default(0),
    error: text("error"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("model_call_records_created_idx").on(table.created_at),
    index("model_call_records_user_created_idx").on(table.user_id, table.created_at),
    index("model_call_records_status_created_idx").on(table.status, table.created_at),
    index("model_call_records_model_created_idx").on(table.type, table.provider, table.model_name, table.created_at),
    index("model_call_records_source_created_idx").on(table.source, table.created_at),
    index("model_call_records_system_api_idx").on(table.system_api_id, table.created_at),
    index("model_call_records_custom_api_idx").on(table.custom_api_key_id, table.created_at),
  ]
);

// User API keys (for custom model access)
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().default(sql`auth.uid()`),
    provider: varchar("provider", { length: 64 }).notNull(), // openai, stabilityai, runway, etc.
    api_url: text("api_url"), // full API endpoint URL, e.g. https://api.openai.com/v1/images/generations
    model_name: varchar("model_name", { length: 128 }), // specific model name, e.g. gpt-4, stable-diffusion-xl
    api_key_encrypted: text("api_key_encrypted").notNull(),
    api_key_preview: varchar("api_key_preview", { length: 20 }), // last 4 chars visible
    supplier_name: varchar("supplier_name", { length: 128 }),
    note: text("note").notNull().default(""),
    manifest_path: text("manifest_path"),
    type: varchar("type", { length: 16 }).notNull().default("image"),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("user_api_keys_user_id_idx").on(table.user_id),
    index("user_api_keys_provider_idx").on(table.provider),
  ]
);

// Work likes
export const workLikes = pgTable(
  "work_likes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().default(sql`auth.uid()`),
    work_id: uuid("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_likes_user_id_idx").on(table.user_id),
    index("work_likes_work_id_idx").on(table.work_id),
  ]
);
