import { NextResponse } from 'next/server';
import { STYLE_PRESETS } from '@/lib/model-config';
import { listImageStylePresets } from '@/lib/style-preset-store';

export async function GET() {
  try {
    const presets = await listImageStylePresets();
    return NextResponse.json({ presets });
  } catch (err) {
    console.error('[style-presets] GET error:', err);
    return NextResponse.json({ presets: STYLE_PRESETS });
  }
}
