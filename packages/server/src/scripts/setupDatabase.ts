import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadConfig } from '../config.ts';

const { Pool } = pg;

interface SaleRow {
  id: number;
  product_id: string;
  remaining_stock: number;
  total_stock: number;
  starts_at: Date;
  ends_at: Date;
}

const config = loadConfig();

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (error) => {
  console.error('Database connection error:', error.message);
  process.exitCode = 1;
});

try {
  // Create the tables and constraints.
  const schemaUrl = new URL('../../db/schema.sql', import.meta.url);
  const schemaSql = await readFile(schemaUrl, 'utf8');

  await pool.query(schemaSql);

  // Create the sale only if it does not already exist.
  const inserted = await pool.query(
    `
      INSERT INTO sales (
        id,
        product_id,
        remaining_stock,
        total_stock,
        starts_at,
        ends_at
      )
      VALUES ($1, $2, $3, $3, $4, $5)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `,
    [
      1,
      config.product.id,
      config.totalStock,
      config.startsAt,
      config.endsAt,
    ],
  );

  // Read the saved sale, including settings from any earlier run.
  const result = await pool.query<SaleRow>(
    `
      SELECT
        id,
        product_id,
        remaining_stock,
        total_stock,
        starts_at,
        ends_at
      FROM sales
      WHERE id = $1
    `,
    [1],
  );

  if (!result.rows[0]) {
    throw new Error('Sale 1 was not found after setup.');
  }

  console.log(
    inserted.rowCount === 1
      ? 'Created sale 1.'
      : 'Sale 1 already exists; kept its saved settings.',
  );

  console.table(result.rows);
} catch (error) {
  console.error('Database setup failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}