import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadConfig } from '../config.ts';

const { Pool } = pg;
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
  const schemaUrl = new URL('../../db/schema.sql', import.meta.url);
  const schemaSql = await readFile(schemaUrl, 'utf8');

  await pool.query(schemaSql);

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
      config.saleId,
      config.product.id,
      config.totalStock,
      config.startsAt,
      config.endsAt,
    ],
  );

  const result = await pool.query(
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
    [config.saleId],
  );

  if (!result.rows[0]) {
    throw new Error(
      `Sale ${config.saleId} was not found after setup.`,
    );
  }

  console.log(
    inserted.rowCount === 1
      ? `Created sale ${config.saleId}.`
      : `Sale ${config.saleId} already exists; kept its saved settings.`,
  );

  console.table(result.rows);
} catch (error) {
  console.error('Database setup failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}