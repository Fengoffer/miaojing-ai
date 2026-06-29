import { NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';

export async function GET() {
  try {
    const client = await getDbClient();
    try {
      const result = await client.query('SELECT total_visits FROM site_stats WHERE id = 1');
      return NextResponse.json({ totalVisits: result.rows[0]?.total_visits || 0 });
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json({ totalVisits: 0 });
  }
}

export async function POST() {
  try {
    const client = await getDbClient();
    try {
      const result = await client.query('SELECT increment_visits() as new_count');
      return NextResponse.json({ totalVisits: result.rows[0]?.new_count || 0 });
    } finally {
      client.release();
    }
  } catch {
    try {
      const client = await getDbClient();
      try {
        await client.query('UPDATE site_stats SET total_visits = total_visits + 1, updated_at = NOW() WHERE id = 1');
        const result = await client.query('SELECT total_visits FROM site_stats WHERE id = 1');
        return NextResponse.json({ totalVisits: result.rows[0]?.total_visits || 0 });
      } finally {
        client.release();
      }
    } catch {
      return NextResponse.json({ totalVisits: 0 });
    }
  }
}