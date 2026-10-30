import pg from 'pg';
import type { Order } from '@flash/shared';
import type {
  InventoryStore,
  ReservationResult,
  SaleSnapshot,
} from './inventoryStore.ts';

const { Pool } = pg;

interface PurchaseRow {
  order_id: string;
  user_id: string;
  created_at: Date;
}

export class PostgresInventoryStore implements InventoryStore {
  readonly #pool: pg.Pool;

  constructor(
    databaseUrl: string,
    private readonly saleId = 1,
  ) {
    this.#pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5_000,
    });

    this.#pool.on('error', (error) => {
      console.error('Unexpected PostgreSQL connection error:', error.message);
    });
  }

  async init(_totalStock: number): Promise<void> {
    const result = await this.#pool.query<{ id: number }>(
      'SELECT id FROM sales WHERE id = $1',
      [this.saleId],
    );

    if (!result.rows[0]) {
      throw new Error(
        'Sale not found. Run npm run db:setup --workspace=@flash/server first.',
      );
    }
  }

    async getSale(): Promise<SaleSnapshot> {
    const result = await this.#pool.query<{
      product_id: string;
      starts_at: Date;
      ends_at: Date;
      total_stock: number;
      remaining_stock: number;
      server_time: Date;
    }>(
      `
        SELECT
          product_id,
          starts_at,
          ends_at,
          total_stock,
          remaining_stock,
          clock_timestamp() AS server_time
        FROM sales
        WHERE id = $1
      `,
      [this.saleId],
    );

    const sale = result.rows[0];

    if (!sale) {
      throw new Error('Cannot read sale: sale not found.');
    }

    return {
      productId: sale.product_id,
      startsAt: sale.starts_at,
      endsAt: sale.ends_at,
      totalStock: sale.total_stock,
      remainingStock: sale.remaining_stock,
      serverTime: sale.server_time,
    };
  }

  async remaining(): Promise<number> {
    const result = await this.#pool.query<{
      remaining_stock: number;
    }>(
      'SELECT remaining_stock FROM sales WHERE id = $1',
      [this.saleId],
    );

    const sale = result.rows[0];

    if (!sale) {
      throw new Error('Cannot read inventory: sale not found.');
    }

    return sale.remaining_stock;
  }

  async findOrder(userId: string): Promise<Order | null> {
    const result = await this.#pool.query<PurchaseRow>(
      `
        SELECT order_id, user_id, created_at
        FROM purchases
        WHERE sale_id = $1 AND user_id = $2
      `,
      [this.saleId, userId],
    );

    const purchase = result.rows[0];

    if (!purchase) {
      return null;
    }

    return {
      orderId: purchase.order_id,
      userId: purchase.user_id,
      createdAt: purchase.created_at.toISOString(),
    };
  }

  async reserve(
  userId: string,
  orderId: string,
  _at: Date,
): Promise<ReservationResult> {
  const client = await this.#pool.connect();

  let discardConnection = false;

  const markConnectionBroken = () => {
    discardConnection = true;
  };

  client.on('error', markConnectionBroken);

  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '5s'");

    // Lock this sale before performing any purchase writes.
    const locked = await client.query<{ id: number }>(
      'SELECT id FROM sales WHERE id = $1 FOR UPDATE',
      [this.saleId],
    );

    if (!locked.rows[0]) {
      throw new Error('Cannot reserve inventory: sale not found.');
    }

    // Try creating an order. An existing buyer produces no inserted row.
    const inserted = await client.query<PurchaseRow>(
      `
        INSERT INTO purchases (order_id, sale_id, user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (sale_id, user_id) DO NOTHING
        RETURNING order_id, user_id, created_at
      `,
      [orderId, this.saleId, userId],
    );

    const newOrder = inserted.rows[0];

    if (!newOrder) {
      const existing = await client.query<PurchaseRow>(
        `
          SELECT order_id, user_id, created_at
          FROM purchases
          WHERE sale_id = $1 AND user_id = $2
        `,
        [this.saleId, userId],
      );

      const order = existing.rows[0];

      if (!order) {
        throw new Error('Duplicate purchase detected, but order was not found.');
      }

      await client.query('ROLLBACK');

      return {
        status: 'duplicate',
        order: {
          orderId: order.order_id,
          userId: order.user_id,
          createdAt: order.created_at.toISOString(),
        },
      };
    }

    // Make one allocation decision using a fresh database timestamp.
    const allocation = await client.query<{
      status:
        | 'reserved'
        | 'sold_out'
        | 'sale_not_started'
        | 'sale_ended';
      remaining_stock: number | null;
    }>(
      `
        WITH instant AS MATERIALIZED (
          SELECT clock_timestamp() AS checked_at
        ),
        decision AS MATERIALIZED (
          SELECT
            CASE
              WHEN instant.checked_at < sales.starts_at
                THEN 'sale_not_started'
              WHEN instant.checked_at >= sales.ends_at
                THEN 'sale_ended'
              WHEN sales.remaining_stock <= 0
                THEN 'sold_out'
              ELSE 'reserved'
            END AS status
          FROM sales
          CROSS JOIN instant
          WHERE sales.id = $1
        ),
        allocated AS (
          UPDATE sales AS s
          SET remaining_stock = s.remaining_stock - 1
          FROM decision AS d
          WHERE s.id = $1
            AND d.status = 'reserved'
            AND s.remaining_stock > 0
          RETURNING s.remaining_stock
        )
        SELECT decision.status, allocated.remaining_stock
        FROM decision
        LEFT JOIN allocated ON true
      `,
      [this.saleId],
    );

    const decision = allocation.rows[0];

    if (!decision) {
      throw new Error('Inventory allocation returned no decision.');
    }

    if (decision.status !== 'reserved') {
      // This also removes the purchase row inserted above.
      await client.query('ROLLBACK');

      return { status: decision.status };
    }

    const remaining = decision.remaining_stock;

    if (remaining === null) {
      throw new Error('Reservation was approved without allocating stock.');
    }

    await client.query('COMMIT');

    return {
      status: 'reserved',
      order: {
        orderId: newOrder.order_id,
        userId: newOrder.user_id,
        createdAt: newOrder.created_at.toISOString(),
      },
      remaining,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discardConnection = true;
    }

    throw error;
  } finally {
    client.removeListener('error', markConnectionBroken);
    client.release(discardConnection);
  }
}

  async close(): Promise<void> {
    await this.#pool.end();
  }
}