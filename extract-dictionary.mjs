import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const PDF_PATH = '/home/jpierce/projects/A Dictionary Tool 20230610.pdf';
const OUTPUT_PATH = '/home/jpierce/projects/iu-mienh-translator/dictionary.json';

async function extractDictionary() {
  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const doc = await getDocument({ data }).promise;
  console.log(`Extracting ${doc.numPages} pages...`);

  // Extract lines using Y-position grouping
  const allPages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    let lines = [];
    let currentItems = [];
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(currentItems.map(it => it.str).join(' '));
        currentItems = [item];
      } else {
        currentItems.push(item);
      }
      lastY = y;
    }
    if (currentItems.length) lines.push(currentItems.map(it => it.str).join(' '));
    allPages.push({ pageNum: i, lines });
  }

  // Parse entries from lines. Each line has format:
  // "term1   def1term2   def2term3   def3"
  // where 3+ spaces separate term from definition, but entries are concatenated.
  // Split on 3+ spaces gives alternating [term, def+term, def+term, ..., def]
  
  const rawEntries = [];
  
  for (const { pageNum, lines } of allPages) {
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(/\s{3,}/);
      if (parts.length < 2) continue;
      
      // parts alternate: term, definition(+nextTerm), definition(+nextTerm), ..., definition
      let currentTerm = parts[0].trim();
      
      for (let p = 1; p < parts.length; p++) {
        const segment = parts[p].trim();
        if (!segment) continue;
        // The whole segment is the definition (may have next term concatenated at end)
        rawEntries.push({ term: currentTerm, definition: segment, page: pageNum });
        currentTerm = ''; // Next iteration's term came from end of this segment but we can't reliably split
      }
    }
  }

  console.log(`Raw entries: ${rawEntries.length}`);

  // Build lookup map - focus on getting clean primary translations
  const lookupMap = {};
  const entries = [];
  
  for (const entry of rawEntries) {
    if (!entry.term || entry.term.length > 200) continue;
    if (entry.term.includes('Dictionary Tool') || entry.term === 'English') continue;
    
    const termDisplay = entry.term.trim();
    // Clean term for lookup: lowercase, remove parenthetical qualifiers
    const termClean = termDisplay.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
    if (!termClean) continue;
    
    // Extract primary Iu Mienh word(s) from definition
    // Definition format: "mienh_word (notes/context)remaining_junk"
    // or: "mienh_word; mienh_word2"
    // or: "mienh_word (notes)next_english_term_concatenated..."
    let def = entry.definition;
    
    // Get the primary translation: first word(s) before ( or ;
    let primary = def;
    // Find first ( or ;
    const cutPoints = [];
    const pi = def.indexOf('(');
    const si = def.indexOf(';');
    const ei = def.indexOf('=');
    if (pi > 0) cutPoints.push(pi);
    if (si > 0) cutPoints.push(si);
    if (ei > 0) cutPoints.push(ei);
    
    if (cutPoints.length > 0) {
      primary = def.substring(0, Math.min(...cutPoints)).trim();
    }
    
    // Clean trailing punctuation
    primary = primary.replace(/[,;:\s]+$/, '').trim();
    
    if (!primary) primary = def.split(/\s/)[0]; // fallback: first word
    
    const entryObj = {
      english: termDisplay,
      englishClean: termClean,
      mienh: primary,
      full: def,
      page: entry.page
    };
    entries.push(entryObj);
    
    if (!lookupMap[termClean]) {
      lookupMap[termClean] = [];
    }
    lookupMap[termClean].push({ 
      mienh: primary, 
      context: termDisplay !== termClean ? termDisplay : undefined,
      full: def 
    });
  }
  
  console.log(`Entries: ${entries.length}`);
  console.log(`Unique terms: ${Object.keys(lookupMap).length}`);
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ entries, lookup: lookupMap }, null, 2));
  console.log(`Saved to ${OUTPUT_PATH}`);
  
  // Verify with sample lookups
  console.log('\n=== Sample lookups ===');
  const testWords = ['a, an', 'abandon', 'able to, can', 'about', 'accept', 'love', 'water', 
    'god', 'family', 'house', 'food', 'happy', 'pray', 'bible', 'heart', 'friend',
    'thank', 'kingdom', 'hope', 'sin', 'forgive', 'life', 'death', 'heaven'];
  for (const k of testWords) {
    if (lookupMap[k]) {
      const defs = lookupMap[k].map(v => `${v.mienh}${v.context ? ' [' + v.context + ']' : ''}`).join(' | ');
      console.log(`  "${k}" → ${defs}`);
    }
  }
}

extractDictionary().catch(console.error);
