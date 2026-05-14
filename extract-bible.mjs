import { readFileSync, writeFileSync } from 'fs';

const DELAY_MS = 1500; // Be polite to Bible.com
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

async function extractBook(book, chapters, label) {
  const pairs = [];
  console.log(`\n📖 ${label} (${chapters} chapters)...`);
  
  for (let ch = 1; ch <= chapters; ch++) {
    process.stdout.write(`  Ch ${ch}/${chapters}...`);
    
    const [mienh, eng] = await Promise.all([
      fetchChapter(233, book, ch),
      fetchChapter(111, book, ch)
    ]);
    
    if (!mienh || !eng) {
      console.log(' ⚠️ failed');
      await sleep(DELAY_MS);
      continue;
    }

    // Align verses present in both
    let count = 0;
    for (const vNum of Object.keys(mienh)) {
      if (eng[vNum] && mienh[vNum].length > 5 && eng[vNum].length > 5) {
        pairs.push({
          eng: eng[vNum],
          imn: mienh[vNum],
          ref: `${book}.${ch}:${vNum}`
        });
        count++;
      }
    }
    console.log(` ✓ ${count} verses`);
    await sleep(DELAY_MS);
  }
  
  return pairs;
}

async function main() {
  const allPairs = [];

  // Psalms: 150 chapters - let's do a sample (1-30) to start
  const psalmPairs = await extractBook('PSA', 30, 'Psalms 1-30');
  allPairs.push(...psalmPairs);

  // Proverbs: 31 chapters
  const provPairs = await extractBook('PRO', 31, 'Proverbs');
  allPairs.push(...provPairs);

  console.log(`\n📊 Total parallel verses: ${allPairs.length}`);
  
  // Save raw pairs
  writeFileSync('bible-pairs.json', JSON.stringify(allPairs, null, 2));
  console.log('Saved to bible-pairs.json');

  // Now extract vocabulary: find Mienh words not in current dictionary
  const dict = JSON.parse(readFileSync('dict-slim.json', 'utf8'));
  const existingMienh = new Set();
  for (const defs of Object.values(dict)) {
    for (const d of defs) {
      if (d.m) d.m.split(/[\s,;]+/).forEach(w => existingMienh.add(w.toLowerCase()));
    }
  }

  // Collect all Mienh words from Bible text
  const bibleMienh = new Set();
  for (const pair of allPairs) {
    pair.imn.split(/[\s,;.!?"'()\-]+/).forEach(w => {
      w = w.toLowerCase().replace(/[^a-z']/g, '');
      if (w.length > 1) bibleMienh.add(w);
    });
  }

  const newWords = [...bibleMienh].filter(w => !existingMienh.has(w)).sort();
  console.log(`\nMienh vocabulary: ${bibleMienh.size} unique words`);
  console.log(`New words (not in dict): ${newWords.length}`);
  console.log('Sample new words:', newWords.slice(0, 30).join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
