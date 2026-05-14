#!/usr/bin/env node
/**
 * Merges community corrections from Supabase into dict-slim.json,
 * then deletes the merged rows from the database.
 *
 * Usage: node merge-corrections.mjs
 *
 * Requires SUPABASE_SERVICE_KEY env var (service role key, not anon key)
 * to delete rows after merging.
 */

import fs from 'fs';

const SUPABASE_URL = 'https://jznienvopdejqvpalgbl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6bmllbnZvcGRlanF2cGFsZ2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDIzODksImV4cCI6MjA5NDE3ODM4OX0.fjdtVnAY99TBC_w38SZ87a-VrAsFoo2obWkRGtrkwZ8';

// Use service key if available (needed for deletes), otherwise anon key for read-only
const API_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;

async function fetchCorrections() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/corrections?select=*`, {
    headers: {
      'apikey': API_KEY,
      'Authorization': `Bearer ${API_KEY}`,
    }
  });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function deleteCorrections(ids) {
  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.log('⚠️  No SUPABASE_SERVICE_KEY set — skipping delete. Set it to clear merged rows.');
    return;
  }
  // Delete in batches of 50
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const filter = `id=in.(${batch.join(',')})`;
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/corrections?${filter}`, {
      method: 'DELETE',
      headers: {
        'apikey': API_KEY,
        'Authorization': `Bearer ${API_KEY}`,
      }
    });
    if (!resp.ok) console.error(`Delete batch failed: ${resp.status}`);
  }
}

async function main() {
  console.log('📥 Fetching corrections from Supabase...');
  const corrections = await fetchCorrections();

  if (corrections.length === 0) {
    console.log('✅ No corrections to merge.');
    return;
  }

  console.log(`   Found ${corrections.length} correction(s)`);

  // Load current dictionary
  const dict = JSON.parse(fs.readFileSync('dict-slim.json', 'utf8'));

  let added = 0, updated = 0, deleted = 0;

  for (const c of corrections) {
    const key = c.english?.toLowerCase().trim();
    if (!key) continue;

    if (c.type === 'deleted') {
      if (dict[key]) {
        delete dict[key];
        deleted++;
      }
    } else {
      const entry = { m: c.mienh };
      if (c.notes) entry.c = c.notes;
      entry.f = c.notes ? `${c.mienh} (${c.notes})` : c.mienh;

      if (dict[key]) {
        updated++;
      } else {
        added++;
      }
      dict[key] = [entry];
    }
  }

  // Write back sorted
  const sorted = Object.fromEntries(
    Object.entries(dict).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.writeFileSync('dict-slim.json', JSON.stringify(sorted, null, 2) + '\n');

  console.log(`\n📊 Results:`);
  console.log(`   Added:   ${added}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Deleted: ${deleted}`);
  console.log(`   Dictionary now has ${Object.keys(sorted).length} entries`);

  // Clear merged rows from Supabase
  const ids = corrections.map(c => c.id);
  await deleteCorrections(ids);

  console.log('\n✅ Done! Review changes with: git diff dict-slim.json');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
