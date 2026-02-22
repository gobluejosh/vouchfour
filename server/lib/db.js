import pg from 'pg'

const isProduction = !!process.env.RAILWAY_ENVIRONMENT

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/vouchfour',
  ...(isProduction && { ssl: { rejectUnauthorized: false } }),
})

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message)
})

export async function query(text, params) {
  const start = Date.now()
  const result = await pool.query(text, params)
  console.log(`[DB] ${Date.now() - start}ms | ${result.rowCount} rows | ${text.slice(0, 60)}...`)
  return result
}

export async function getClient() {
  return pool.connect()
}

export default pool
