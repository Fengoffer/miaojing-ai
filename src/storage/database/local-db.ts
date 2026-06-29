import { Pool, PoolClient } from 'pg';

/**
 * Local PostgreSQL database client for the MiaoJing AI Creation Platform.
 * 
 * This client provides direct access to the local PostgreSQL database
 * without relying on Supabase.
 */

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.LOCAL_DB_URL;
    if (!connectionString) {
      throw new Error('LOCAL_DB_URL is not set');
    }

    const maxConnections = Number(process.env.DB_POOL_MAX || 20);
    const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS || 30000);
    const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000);
    
    pool = new Pool({
      connectionString,
      max: Number.isFinite(maxConnections) ? Math.min(100, Math.max(2, maxConnections)) : 20,
      idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? Math.max(1000, idleTimeoutMillis) : 30000,
      connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) ? Math.max(1000, connectionTimeoutMillis) : 5000,
      application_name: process.env.APP_RUNTIME_ROLE
        ? `miaojing-${process.env.APP_RUNTIME_ROLE}`
        : 'miaojing',
    });
    
    // Test the connection
    pool.connect((err, client, release) => {
      if (err) {
        console.error('Error connecting to database:', err);
      } else {
        console.log('Connected to local PostgreSQL database');
        release();
      }
    });
  }
  return pool;
}

/**
 * Get a database client from the pool.
 */
export async function getDbClient(): Promise<PoolClient> {
  const pool = getPool();
  return pool.connect();
}

/**
 * Close the database pool.
 */
export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
