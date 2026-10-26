-- =============================================================================
--  Proposed schema for the flash sale. PLANNED, not yet applied by any code --
--  PostgresInventoryStore is a stub (GUIDE.md step 4).
--
--  Apply it by hand while you work:
--    docker compose up -d postgres
--    psql postgres://flash:flash@localhost:5432/flashsale -f packages/server/db/schema.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales (
  id              int PRIMARY KEY,
  product_id      text        NOT NULL,
  -- CHECK is the last line of defence against overselling. If a bug ever lets
  -- a decrement through at zero, the transaction aborts instead of going
  -- negative: the database refuses to be wrong even if the code is.
  remaining_stock int         NOT NULL CHECK (remaining_stock >= 0),
  total_stock     int         NOT NULL CHECK (total_stock >= 0),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  CONSTRAINT sale_window_is_forwards CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS purchases (
  order_id   uuid PRIMARY KEY,
  sale_id    int         NOT NULL REFERENCES sales(id),
  user_id    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  -- "One item per user", enforced by storage rather than by application logic.
  -- This is an INDEPENDENT guarantee: it holds even if the reservation code
  -- has a race, which is exactly what you want from a rule this important.
  CONSTRAINT one_purchase_per_user UNIQUE (sale_id, user_id)
);

-- Answers GET /api/purchase/:userId without scanning.
CREATE INDEX IF NOT EXISTS purchases_user_idx ON purchases (sale_id, user_id);

-- -----------------------------------------------------------------------------
-- Seed. ON CONFLICT DO NOTHING matters: a deploy or restart MID-SALE must not
-- refill the shelf. Re-running this file is safe.
-- -----------------------------------------------------------------------------
INSERT INTO sales (id, product_id, remaining_stock, total_stock, starts_at, ends_at)
VALUES (1, 'iphone-17-pro', 10, 10, now(), now() + interval '1 hour')
ON CONFLICT (id) DO NOTHING;
