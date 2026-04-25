-- =============================================================================
-- BASELINE SCHEMA SNAPSHOT
-- =============================================================================
-- Regenerated 2026-04-25 from prod Supabase (project: dpluygkfzoinkfuelxix)
-- via: pg_dump --schema-only --schema=public --no-owner --no-privileges
--
-- PURPOSE:
--   Source-of-truth record of the prod schema. The first ~10 tables were
--   created in the Supabase UI before this repo had any migrations, which
--   is why this baseline exists — to capture those ambient definitions so
--   they no longer live only in Supabase's dashboard.
--
-- DO NOT APPLY TO AN EXISTING DATABASE.
--   Running this against prod (or any DB that already has these objects)
--   will error on duplicate CREATE statements. It is a reference document,
--   not a runnable migration.
--
-- TO BOOTSTRAP A FRESH ENVIRONMENT:
--   1. Apply this file once.
--   2. Apply every other file in supabase/migrations/ in filename order.
--
-- TO REGENERATE:
--   /opt/homebrew/opt/libpq/bin/pg_dump \
--     "postgresql://postgres.<ref>:<pw>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres" \
--     --schema-only --schema=public --no-owner --no-privileges \
--     -f supabase/migrations/00000000000000_baseline_schema.sql
-- =============================================================================

--
-- PostgreSQL database dump
--

\restrict oX1tZWTsxgLLkmOvOixpyBVces7NBefLINZ6KqLD9PdUGnw9hJxdyCMWappNe1o

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_deletions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    stripe_customer_id text,
    what_didnt_work text,
    what_would_you_change text
);


--
-- Name: admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid,
    target_user_id uuid,
    action_type text NOT NULL,
    notes text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_adherence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_adherence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date_key date NOT NULL,
    adherence_score numeric,
    matched_count integer DEFAULT 0 NOT NULL,
    off_plan_count integer DEFAULT 0 NOT NULL,
    needs_review_count integer DEFAULT 0 NOT NULL,
    trade_count integer DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date_key date NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ghost_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ghost_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    ghost_member_email text NOT NULL,
    ghost_member_id text,
    previous_status text,
    current_status text,
    proposed_action text NOT NULL,
    status text DEFAULT 'pending'::text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    raw_payload jsonb
);


--
-- Name: invited_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invited_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    token text NOT NULL,
    is_comped boolean DEFAULT true,
    trial_months integer,
    invited_at timestamp with time zone DEFAULT now(),
    redeemed_at timestamp with time zone,
    redeemed_by uuid
);


--
-- Name: logical_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logical_trades (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    symbol character varying(32) NOT NULL,
    conid bigint,
    asset_category character varying(8) NOT NULL,
    opening_ib_order_id character varying(64),
    direction character varying(5) NOT NULL,
    opened_at timestamp with time zone,
    closed_at timestamp with time zone,
    status character varying(16) DEFAULT 'open'::character varying,
    total_opening_quantity numeric(15,4) DEFAULT 0,
    total_closing_quantity numeric(15,4) DEFAULT 0,
    remaining_quantity numeric(15,4) DEFAULT 0,
    total_realized_pnl numeric(15,4) DEFAULT 0,
    matching_status character varying(20) DEFAULT 'unmatched'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    avg_entry_price numeric,
    planned_trade_id bigint,
    fx_rate_to_base double precision DEFAULT 1.0,
    currency text,
    is_demo boolean DEFAULT false,
    review_notes text,
    adherence_score numeric(5,2),
    user_reviewed boolean DEFAULT false NOT NULL,
    avg_exit_price numeric,
    multiplier numeric DEFAULT 1
);


--
-- Name: logical_trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.logical_trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: logical_trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.logical_trades_id_seq OWNED BY public.logical_trades.id;


--
-- Name: missed_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.missed_trades (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    symbol character varying(32) NOT NULL,
    direction character varying(5) NOT NULL,
    strategy character varying(64),
    noted_entry_price numeric(15,6),
    noted_at timestamp with time zone,
    notes text,
    playbook_id bigint,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: missed_trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.missed_trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: missed_trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.missed_trades_id_seq OWNED BY public.missed_trades.id;


--
-- Name: open_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_positions (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    account_id character varying(32),
    conid bigint,
    symbol character varying(32) NOT NULL,
    asset_category character varying(8),
    "position" numeric(15,4) NOT NULL,
    avg_cost numeric(15,6),
    market_value numeric(15,4),
    unrealized_pnl numeric(15,4),
    currency character varying(8),
    updated_at timestamp with time zone DEFAULT now(),
    is_demo boolean DEFAULT false,
    fx_rate_to_base double precision
);


--
-- Name: open_positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_positions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_positions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_positions_id_seq OWNED BY public.open_positions.id;


--
-- Name: planned_trade_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planned_trade_executions (
    id bigint NOT NULL,
    logical_trade_id bigint NOT NULL,
    planned_trade_id bigint NOT NULL,
    matching_confidence character varying(8) NOT NULL,
    matched_by character varying(32) NOT NULL,
    matched_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: planned_trade_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.planned_trade_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: planned_trade_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.planned_trade_executions_id_seq OWNED BY public.planned_trade_executions.id;


--
-- Name: planned_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planned_trades (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    account_id character varying(32),
    symbol character varying(32) NOT NULL,
    conid bigint,
    asset_category character varying(8) DEFAULT 'stock'::character varying,
    direction character varying(5) NOT NULL,
    strategy character varying(64),
    planned_entry_price numeric(15,6) NOT NULL,
    planned_target_price numeric(15,6),
    planned_stop_loss numeric(15,6),
    planned_quantity numeric(15,4),
    thesis text,
    playbook_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_demo boolean DEFAULT false,
    currency text
);


--
-- Name: planned_trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.planned_trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: planned_trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.planned_trades_id_seq OWNED BY public.planned_trades.id;


--
-- Name: playbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbooks (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    name character varying(64) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_demo boolean DEFAULT false
);


--
-- Name: playbooks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playbooks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playbooks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playbooks_id_seq OWNED BY public.playbooks.id;


--
-- Name: securities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.securities (
    conid bigint NOT NULL,
    symbol character varying(32) NOT NULL,
    asset_category character varying(8),
    description text,
    multiplier integer DEFAULT 1,
    currency character varying(8),
    underlying_conid bigint,
    underlying_symbol character varying(32),
    created_at timestamp with time zone DEFAULT now(),
    company_name text
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ib_exec_id character varying(64) NOT NULL,
    ib_order_id character varying(64),
    account_id character varying(32),
    conid bigint,
    symbol character varying(32) NOT NULL,
    asset_category character varying(50) NOT NULL,
    buy_sell character varying(10) NOT NULL,
    open_close_indicator character varying(10) NOT NULL,
    quantity numeric(15,4) NOT NULL,
    trade_price numeric(15,6) NOT NULL,
    date_time timestamp with time zone NOT NULL,
    net_cash numeric(15,4),
    fifo_pnl_realized numeric(15,4),
    ib_commission numeric(15,6),
    ib_commission_currency character varying(10),
    currency character varying(10),
    transaction_type character varying(50),
    notes character varying(8),
    multiplier integer DEFAULT 1,
    strike numeric(15,6),
    expiry character varying(8),
    put_call character varying(10),
    created_at timestamp with time zone DEFAULT now(),
    fx_rate_to_base double precision DEFAULT 1.0,
    is_demo boolean DEFAULT false,
    exchange character varying(16),
    order_type character varying(16)
);


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: user_ibkr_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_ibkr_credentials (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    ibkr_token text NOT NULL,
    query_id_30d character varying(16) NOT NULL,
    account_id character varying(32),
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    token_masked text,
    query_id_masked text,
    base_currency text,
    last_sync_error text,
    last_sync_failed_at timestamp with time zone,
    auto_sync_enabled boolean DEFAULT true NOT NULL
);


--
-- Name: user_ibkr_credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_ibkr_credentials_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_ibkr_credentials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_ibkr_credentials_id_seq OWNED BY public.user_ibkr_credentials.id;


--
-- Name: user_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_subscriptions (
    user_id uuid NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_status text DEFAULT 'trialing'::text,
    trial_ends_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    current_period_ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_comped boolean DEFAULT false,
    ibkr_connected boolean DEFAULT false,
    demo_seeded boolean DEFAULT false
);


--
-- Name: weekly_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    week_key text NOT NULL,
    worked text,
    didnt_work text,
    recurring text,
    action text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: logical_trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logical_trades ALTER COLUMN id SET DEFAULT nextval('public.logical_trades_id_seq'::regclass);


--
-- Name: missed_trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missed_trades ALTER COLUMN id SET DEFAULT nextval('public.missed_trades_id_seq'::regclass);


--
-- Name: open_positions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_positions ALTER COLUMN id SET DEFAULT nextval('public.open_positions_id_seq'::regclass);


--
-- Name: planned_trade_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trade_executions ALTER COLUMN id SET DEFAULT nextval('public.planned_trade_executions_id_seq'::regclass);


--
-- Name: planned_trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trades ALTER COLUMN id SET DEFAULT nextval('public.planned_trades_id_seq'::regclass);


--
-- Name: playbooks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks ALTER COLUMN id SET DEFAULT nextval('public.playbooks_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: user_ibkr_credentials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ibkr_credentials ALTER COLUMN id SET DEFAULT nextval('public.user_ibkr_credentials_id_seq'::regclass);


--
-- Name: account_deletions account_deletions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletions
    ADD CONSTRAINT account_deletions_pkey PRIMARY KEY (id);


--
-- Name: admin_actions admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_key_key UNIQUE (key);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: daily_adherence daily_adherence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_adherence
    ADD CONSTRAINT daily_adherence_pkey PRIMARY KEY (id);


--
-- Name: daily_adherence daily_adherence_user_id_date_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_adherence
    ADD CONSTRAINT daily_adherence_user_id_date_key_key UNIQUE (user_id, date_key);


--
-- Name: daily_notes daily_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_notes
    ADD CONSTRAINT daily_notes_pkey PRIMARY KEY (id);


--
-- Name: daily_notes daily_notes_user_id_date_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_notes
    ADD CONSTRAINT daily_notes_user_id_date_key_key UNIQUE (user_id, date_key);


--
-- Name: ghost_webhook_events ghost_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_webhook_events
    ADD CONSTRAINT ghost_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: invited_users invited_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invited_users
    ADD CONSTRAINT invited_users_email_key UNIQUE (email);


--
-- Name: invited_users invited_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invited_users
    ADD CONSTRAINT invited_users_pkey PRIMARY KEY (id);


--
-- Name: invited_users invited_users_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invited_users
    ADD CONSTRAINT invited_users_token_key UNIQUE (token);


--
-- Name: logical_trades logical_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logical_trades
    ADD CONSTRAINT logical_trades_pkey PRIMARY KEY (id);


--
-- Name: missed_trades missed_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missed_trades
    ADD CONSTRAINT missed_trades_pkey PRIMARY KEY (id);


--
-- Name: open_positions open_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_positions
    ADD CONSTRAINT open_positions_pkey PRIMARY KEY (id);


--
-- Name: planned_trade_executions planned_trade_executions_logical_trade_id_planned_trade_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trade_executions
    ADD CONSTRAINT planned_trade_executions_logical_trade_id_planned_trade_id_key UNIQUE (logical_trade_id, planned_trade_id);


--
-- Name: planned_trade_executions planned_trade_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trade_executions
    ADD CONSTRAINT planned_trade_executions_pkey PRIMARY KEY (id);


--
-- Name: planned_trades planned_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trades
    ADD CONSTRAINT planned_trades_pkey PRIMARY KEY (id);


--
-- Name: playbooks playbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_pkey PRIMARY KEY (id);


--
-- Name: securities securities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.securities
    ADD CONSTRAINT securities_pkey PRIMARY KEY (conid);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: trades trades_user_id_ib_exec_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_user_id_ib_exec_id_key UNIQUE (user_id, ib_exec_id);


--
-- Name: user_ibkr_credentials user_ibkr_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ibkr_credentials
    ADD CONSTRAINT user_ibkr_credentials_pkey PRIMARY KEY (id);


--
-- Name: user_ibkr_credentials user_ibkr_credentials_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ibkr_credentials
    ADD CONSTRAINT user_ibkr_credentials_user_id_key UNIQUE (user_id);


--
-- Name: user_subscriptions user_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (user_id);


--
-- Name: weekly_reviews weekly_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reviews
    ADD CONSTRAINT weekly_reviews_pkey PRIMARY KEY (id);


--
-- Name: weekly_reviews weekly_reviews_user_id_week_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reviews
    ADD CONSTRAINT weekly_reviews_user_id_week_key_key UNIQUE (user_id, week_key);


--
-- Name: idx_account_deletions_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_deletions_deleted_at ON public.account_deletions USING btree (deleted_at DESC);


--
-- Name: idx_daily_adherence_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_adherence_user_date ON public.daily_adherence USING btree (user_id, date_key DESC);


--
-- Name: idx_logical_trades_matching; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logical_trades_matching ON public.logical_trades USING btree (user_id, matching_status);


--
-- Name: idx_logical_trades_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logical_trades_user ON public.logical_trades USING btree (user_id, status);


--
-- Name: idx_open_positions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_open_positions_user ON public.open_positions USING btree (user_id);


--
-- Name: idx_planned_trades_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planned_trades_user ON public.planned_trades USING btree (user_id, created_at);


--
-- Name: idx_trades_user_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_user_asset ON public.trades USING btree (user_id, asset_category);


--
-- Name: idx_trades_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_user_date ON public.trades USING btree (user_id, date_time);


--
-- Name: idx_trades_user_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_user_symbol ON public.trades USING btree (user_id, symbol);


--
-- Name: admin_actions admin_actions_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: admin_actions admin_actions_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: daily_adherence daily_adherence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_adherence
    ADD CONSTRAINT daily_adherence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: daily_notes daily_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_notes
    ADD CONSTRAINT daily_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: invited_users invited_users_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invited_users
    ADD CONSTRAINT invited_users_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id);


--
-- Name: logical_trades logical_trades_planned_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logical_trades
    ADD CONSTRAINT logical_trades_planned_trade_id_fkey FOREIGN KEY (planned_trade_id) REFERENCES public.planned_trades(id);


--
-- Name: logical_trades logical_trades_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logical_trades
    ADD CONSTRAINT logical_trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: missed_trades missed_trades_playbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missed_trades
    ADD CONSTRAINT missed_trades_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id) ON DELETE SET NULL;


--
-- Name: missed_trades missed_trades_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missed_trades
    ADD CONSTRAINT missed_trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: open_positions open_positions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_positions
    ADD CONSTRAINT open_positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: planned_trade_executions planned_trade_executions_logical_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trade_executions
    ADD CONSTRAINT planned_trade_executions_logical_trade_id_fkey FOREIGN KEY (logical_trade_id) REFERENCES public.logical_trades(id) ON DELETE CASCADE;


--
-- Name: planned_trade_executions planned_trade_executions_planned_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trade_executions
    ADD CONSTRAINT planned_trade_executions_planned_trade_id_fkey FOREIGN KEY (planned_trade_id) REFERENCES public.planned_trades(id) ON DELETE CASCADE;


--
-- Name: planned_trades planned_trades_playbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trades
    ADD CONSTRAINT planned_trades_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id) ON DELETE SET NULL;


--
-- Name: planned_trades planned_trades_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planned_trades
    ADD CONSTRAINT planned_trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: playbooks playbooks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: trades trades_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_ibkr_credentials user_ibkr_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ibkr_credentials
    ADD CONSTRAINT user_ibkr_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_subscriptions user_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: weekly_reviews weekly_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reviews
    ADD CONSTRAINT weekly_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: invited_users Anon can read unredeemed invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anon can read unredeemed invites" ON public.invited_users FOR SELECT TO authenticated, anon USING ((redeemed_at IS NULL));


--
-- Name: app_settings Anyone can read app_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read app_settings" ON public.app_settings FOR SELECT USING (true);


--
-- Name: invited_users Authenticated user can redeem an invite; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated user can redeem an invite" ON public.invited_users FOR UPDATE TO authenticated USING ((redeemed_at IS NULL)) WITH CHECK ((redeemed_at IS NOT NULL));


--
-- Name: securities Securities are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Securities are public" ON public.securities FOR SELECT USING (true);


--
-- Name: daily_notes Users can delete own daily_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own daily_notes" ON public.daily_notes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: user_ibkr_credentials Users can delete own ibkr_credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own ibkr_credentials" ON public.user_ibkr_credentials FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: logical_trades Users can delete own logical_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own logical_trades" ON public.logical_trades FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: open_positions Users can delete own open_positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own open_positions" ON public.open_positions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: planned_trades Users can delete own planned_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own planned_trades" ON public.planned_trades FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: trades Users can delete own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own trades" ON public.trades FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: daily_notes Users can insert own daily_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own daily_notes" ON public.daily_notes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_ibkr_credentials Users can insert own ibkr_credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own ibkr_credentials" ON public.user_ibkr_credentials FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: logical_trades Users can insert own logical_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own logical_trades" ON public.logical_trades FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: open_positions Users can insert own open_positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own open_positions" ON public.open_positions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: planned_trades Users can insert own planned_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own planned_trades" ON public.planned_trades FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: trades Users can insert own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own trades" ON public.trades FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: weekly_reviews Users can insert own weekly_reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own weekly_reviews" ON public.weekly_reviews FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: daily_notes Users can select own daily_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own daily_notes" ON public.daily_notes FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_ibkr_credentials Users can select own ibkr_credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own ibkr_credentials" ON public.user_ibkr_credentials FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: logical_trades Users can select own logical_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own logical_trades" ON public.logical_trades FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: open_positions Users can select own open_positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own open_positions" ON public.open_positions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: planned_trades Users can select own planned_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own planned_trades" ON public.planned_trades FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_subscriptions Users can select own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own subscription" ON public.user_subscriptions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: trades Users can select own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own trades" ON public.trades FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: weekly_reviews Users can select own weekly_reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can select own weekly_reviews" ON public.weekly_reviews FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: daily_notes Users can update own daily_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own daily_notes" ON public.daily_notes FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_ibkr_credentials Users can update own ibkr_credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own ibkr_credentials" ON public.user_ibkr_credentials FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: logical_trades Users can update own logical_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own logical_trades" ON public.logical_trades FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: open_positions Users can update own open_positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own open_positions" ON public.open_positions FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: planned_trades Users can update own planned_trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own planned_trades" ON public.planned_trades FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: trades Users can update own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own trades" ON public.trades FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: weekly_reviews Users can update own weekly_reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own weekly_reviews" ON public.weekly_reviews FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_ibkr_credentials Users see own credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own credentials" ON public.user_ibkr_credentials USING ((auth.uid() = user_id));


--
-- Name: logical_trades Users see own logical trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own logical trades" ON public.logical_trades USING ((auth.uid() = user_id));


--
-- Name: missed_trades Users see own missed trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own missed trades" ON public.missed_trades USING ((auth.uid() = user_id));


--
-- Name: open_positions Users see own open positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own open positions" ON public.open_positions USING ((auth.uid() = user_id));


--
-- Name: planned_trade_executions Users see own planned trade executions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own planned trade executions" ON public.planned_trade_executions USING ((EXISTS ( SELECT 1
   FROM public.logical_trades lt
  WHERE ((lt.id = planned_trade_executions.logical_trade_id) AND (lt.user_id = auth.uid())))));


--
-- Name: planned_trades Users see own plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own plans" ON public.planned_trades USING ((auth.uid() = user_id));


--
-- Name: playbooks Users see own playbooks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own playbooks" ON public.playbooks USING ((auth.uid() = user_id));


--
-- Name: trades Users see own trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own trades" ON public.trades USING ((auth.uid() = user_id));


--
-- Name: account_deletions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_adherence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_adherence ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_adherence daily_adherence_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_adherence_select_own ON public.daily_adherence FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: daily_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: ghost_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ghost_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: invited_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invited_users ENABLE ROW LEVEL SECURITY;

--
-- Name: logical_trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.logical_trades ENABLE ROW LEVEL SECURITY;

--
-- Name: missed_trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.missed_trades ENABLE ROW LEVEL SECURITY;

--
-- Name: open_positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: planned_trade_executions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planned_trade_executions ENABLE ROW LEVEL SECURITY;

--
-- Name: planned_trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planned_trades ENABLE ROW LEVEL SECURITY;

--
-- Name: playbooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

--
-- Name: securities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.securities ENABLE ROW LEVEL SECURITY;

--
-- Name: trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

--
-- Name: user_ibkr_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_ibkr_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: user_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict oX1tZWTsxgLLkmOvOixpyBVces7NBefLINZ6KqLD9PdUGnw9hJxdyCMWappNe1o

