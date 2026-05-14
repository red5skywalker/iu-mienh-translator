import { readFileSync, writeFileSync } from 'fs';

const DELAY_MS = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchChapter(version, book, chapter) {
  const url = `https://www.bible.com/bible/${version}/${book}.${chapter}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
  });
  if (!resp.ok) return null;
  const html = await resp.text();

  const verses = {};
  const regex = /data-usfm="[^.]+\.\d+\.(\d+)"[^>]*class="[^"]*__verse"[^>]*>([\s\S]*?)(?=<\/div>)/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const num = parseInt(match[1]);
    const contentMatches = match[2].match(/class="[^"]*__content"[^>]*>([^<]+)/g);
    if (contentMatches) {
      const text = contentMatches.map(m => m.replace(/^[^>]+>/, '').trim()).join(' ');
      if (!verses[num]) verses[num] = '';
      verses[num] += (verses[num] ? ' ' : '') + text;
    }
  }

  for (const k of Object.keys(verses)) {
    verses[k] = verses[k].replace(/\s+/g, ' ').trim();
  }

  return Object.keys(verses).length > 0 ? verses : null;
}

async function main() {
  const pairs = [];
  const total = 120; // chapters 31-150
  console.log(`📖 Psalms 31-150 (${total} chapters)...`);
  
  for (let ch = 31; ch <= 150; ch++) {
    process.stdout.write(`  Ch ${ch}/150...`);
    
    const [mienh, eng] = await Promise.all([
      fetchChapter(233, 'PSA', ch),
      fetchChapter(111, 'PSA', ch)
    ]);
    
    if (!mienh || !eng) {
      console.log(' ⚠️ failed');
      await sleep(DELAY_MS);
      continue;
    }

    let count = 0;
    for (const vNum of Object.keys(mienh)) {
      if (eng[vNum] && mienh[vNum].length > 5 && eng[vNum].length > 5) {
        pairs.push({
          eng: eng[vNum],
          imn: mienh[vNum],
          ref: `PSA.${ch}:${vNum}`
        });
        count++;
      }
    }
    console.log(` ✓ ${count} verses`);
    await sleep(DELAY_MS);
  }

  console.log(`\n📊 Total: ${pairs.length} verse pairs`);

  // Add to examples.json
  const examples = JSON.parse(readFileSync('examples.json', 'utf8'));
  let added = 0;
  for (const p of pairs) {
    if (p.eng.length >= 15 && p.eng.length <= 200 && p.imn.length >= 10) {
      examples.push({ eng: p.eng, imn: p.imn, cat: 'bible-psalms' });
      added++;
    }
  }
  writeFileSync('examples.json', JSON.stringify(examples, null, 2));
  console.log(`Added ${added} pairs to examples.json`);
  console.log(`Total examples: ${examples.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
