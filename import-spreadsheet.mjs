import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const wb = XLSX.readFile('/home/jpierce/projects/iumienhdictnew.xlsx');
const dict = JSON.parse(readFileSync('dict-slim.json', 'utf8'));

function parseSheet(sheetName, engCol = 0, mienhCol = 1) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  const entries = [];
  for (const row of data) {
    if (!row[engCol] || !row[mienhCol]) continue;
    const eng = String(row[engCol]).trim();
    const mienh = String(row[mienhCol]).trim();
    if (/^(english|mienh|mien|a dictionary tool)$/i.test(eng)) continue;
    if (!mienh) continue;
    entries.push({ eng, mienh });
  }
  return entries;
}

function cleanEntry({ eng, mienh }) {
  let context = '';

  // Skip entries that are clearly not dictionary words
  if (/^a bible|^example|^note:|^see /i.test(eng)) return null;
  if (eng.includes(':') && /\d+:\d+/.test(eng)) return null; // scripture refs as keys

  // Extract parenthetical from English key as context
  const parenMatch = eng.match(/^([^(]+)\s*\((.+)\)\s*$/);
  if (parenMatch && parenMatch[1].trim().length > 1) {
    eng = parenMatch[1].trim();
    context = parenMatch[2].trim();
  }

  let mienhNotes = [];
  let mienhClean = mienh;

  // Remove all parenthetical content - separate Bible refs and notes
  mienhClean = mienhClean.replace(/\(([^)]*)\)/g, (_, inner) => {
    // Check if it's a Bible reference, WT note, or English explanation
    if (/\b(?:Gen|Ex|Lev|Num|Dt|Josh|Judg|Ruth|Sam|Ki|Chr|Ezr|Neh|Est|Job|Ps|Prov|Ec|Sol|Isa|Is|Jer|Lam|Eze|Dan|Hos|Joel|Am|Ob|Jon|Mic|Nah|Hab|Zep|Hag|Zec|Mal|Matt|Mark|Luke|John|Acts|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Tit|Phm|Heb|Jas|Pet|Jude|Rev)\b\s*\d/i.test(inner)) {
      return ''; // Bible ref - drop
    }
    if (/^(WT|WT trans|literally)/i.test(inner)) {
      mienhNotes.push(inner.trim());
      return '';
    }
    // English explanation
    if (/\b(the|is|are|was|to|of|for|from|with|see|used|when|this|that)\b/i.test(inner)) {
      mienhNotes.push(inner.trim());
      return '';
    }
    // Might be Mienh content in parens - keep it
    return inner;
  });

  // Handle = sign explanations: "mienh words = english explanation"
  if (mienhClean.includes('=')) {
    const parts = mienhClean.split(/\s*=\s*/);
    // Keep first part as Mienh, rest as context
    mienhClean = parts[0].trim();
    const explanation = parts.slice(1).join(' = ').trim();
    if (explanation) mienhNotes.push(explanation);
  }

  // Handle semicolons - keep all as alternatives (don't discard)
  if (mienhClean.includes(';')) {
    const parts = mienhClean.split(/\s*;\s*/).filter(p => p.trim());
    mienhClean = parts[0].trim();
    if (parts.length > 1) {
      mienhNotes.push('also: ' + parts.slice(1).join(', '));
    }
  }

  // Remove trailing "from WT" or other English crud
  mienhClean = mienhClean.replace(/\s+from WT.*$/i, '');
  mienhClean = mienhClean.replace(/\s*[-–—]?\s*WT\s*trans(?:lation)?\.?\s*$/i, '');
  mienhClean = mienhClean.replace(/\s*[-–—]?\s*WT\.?\s*$/i, '');
  mienhClean = mienhClean.replace(/\s*\bWT\b\s*/g, ' '); // Remove standalone WT anywhere
  mienhClean = mienhClean.trim();

  // Remove trailing English words/phrases that got stuck onto Mienh
  // Strategy: find where a run of common English words starts at the end
  const commonEng = /\b(the|a|an|to|is|are|was|were|it|this|that|not|from|see|of|in|for|and|or|but|with|has|have|be|do|does|did|will|would|can|could|should|also|our|your|their|his|her|its|we|they|them|him|who|which|what|when|where|how|very|more|most|just|only|than|then|so|if|as|at|by|on|up|about|into|over|after|before|between|out|all|each|every|some|any|no|other|new|old|good|bad|great|small|little|big|long|short|own|same|able|like|one|two|three)\b/i;
  // Split into words, find where trailing English starts
  const words = mienhClean.split(/\s+/);
  if (words.length > 1) {
    let cutIdx = words.length;
    // Walk backwards while words are English
    for (let i = words.length - 1; i >= 1; i--) {
      const w = words[i].toLowerCase().replace(/[,.:;!?]/g, '');
      if (commonEng.test(w) || /^[A-Z][a-z]+$/.test(words[i]) || /^(bible|scripture|accounts?|confess(?:ion)?|admit|adjust|request|literally|meaning|refers?|example|spell|natives|word|carry|idea|depend|rely|warning|prohibition|connection|used|position|superior|greater|specifically|refers|general|term|approximately|distance|overhead|welcome|receive|believe|sexual|abuse[rd]?|car|accident|desolate|natural|abilities?|skill|power|leave|divorce|pregnancy|broch|dic\.?|dictionary)$/i.test(w)) {
        cutIdx = i;
      } else {
        break;
      }
    }
    if (cutIdx < words.length) {
      const trailing = words.slice(cutIdx).join(' ');
      mienhClean = words.slice(0, cutIdx).join(' ');
      mienhNotes.push(trailing);
    }
  }

  // Remove Bible verse references that aren't in parens (e.g. "Lk 22:44")
  mienhClean = mienhClean.replace(/\s*\b(?:Gen|Ex|Lev|Num|Dt|Josh|Judg|Ruth|Sam|Ki|Chr|Ezr|Neh|Est|Job|Ps|Prov|Ec|Sol|Isa|Is|Jer|Lam|Eze|Dan|Hos|Joel|Am|Ob|Jon|Mic|Nah|Hab|Zep|Hag|Zec|Mal|Matt|Mk|Mark|Lk|Luke|Jn|John|Acts|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Tit|Phm|Heb|Jas|Pet|Jude|Rev)\s+\d+:\d+\S*/gi, '');
  mienhClean = mienhClean.trim();

  // Build context
  if (mienhNotes.length) {
    context = (context ? context + '; ' : '') + mienhNotes.join('; ');
  }

  eng = eng.toLowerCase().trim();

  // Final validation
  if (!eng || !mienhClean) return null;
  if (eng.length > 80) return null; // Too long to be a dictionary key

  // Skip if result still has too much English
  // Mienh uses tone marks (c, v, x, z, h as final consonants), special digraphs, etc.
  const mWords = mienhClean.split(/\s+/);
  const engStopwords = new Set(['the','a','an','to','is','are','was','were','it','this','that','not','from','of','in','for','and','or','but','with','no','some','there','then','than','if','so','as','at','by','on','be','do','has','have','had','will','would','can','could','should','still','left','what','when','where','how','which','who','example','direct','translation','state','intended','outcome','number','word','implies','english','thai','meant','didn']);
  const engCount = mWords.filter(w => engStopwords.has(w.toLowerCase().replace(/[^a-z]/g, ''))).length;
  if (mWords.length > 3 && engCount / mWords.length > 0.3) return null;
  if (mienhClean.includes("no direct translation")) return null;
  if (mienhClean.includes("no literal translation")) return null;
  if (/^(example|Thai word|no direct|no literal)/i.test(mienhClean)) return null;

  // Remove "Bible word/verse" and "some natives spell..." trailing English
  mienhClean = mienhClean.replace(/\s+Bible\s+\w+.*$/i, '');
  mienhClean = mienhClean.replace(/\s+some\s+\w+\s+spell\b.*$/i, '');
  mienhClean = mienhClean.replace(/,?\s*synonym\b.*$/i, '');
  mienhClean = mienhClean.replace(/\s+used by\b.*$/i, '');
  mienhClean = mienhClean.trim();
  if (!mienhClean) return null;

  return { eng, mienh: mienhClean, context: context || null };
}

// Gather entries from all relevant sheets
const allEntries = [
  ...parseSheet('English Dictionary'),
  ...parseSheet('2+word Phrases'),
  ...parseSheet('Bible Characters'),
  ...parseSheet('Bible Places'),
  ...parseSheet('Family'),
  ...parseSheet('Numbers'),
  ...parseSheet('Time references'),
];

console.log(`Total entries from spreadsheet: ${allEntries.length}`);

// Clean and filter to only new entries
let added = 0;
let skipped = 0;

for (const raw of allEntries) {
  const cleaned = cleanEntry(raw);

  // Skip if null (invalid) or if key already exists
  if (!cleaned) { skipped++; continue; }
  if (!cleaned.eng || !cleaned.mienh) { skipped++; continue; }
  if (dict[cleaned.eng]) { skipped++; continue; }

  // Skip if Mienh field looks entirely English (bad parse)
  const words = cleaned.mienh.split(/\s+/);
  const englishWords = new Set(['the','a','an','to','is','are','was','it','this','that','not','from','see','of','in','for','and','or','but','with','has','have','be','do','does','did','will','would','can','could','should']);
  const engWordCount = words.filter(w => englishWords.has(w.toLowerCase())).length;
  if (words.length > 2 && engWordCount / words.length > 0.6) { skipped++; continue; }

  // Add to dictionary
  const entry = { m: cleaned.mienh };
  if (cleaned.context) entry.c = cleaned.context;
  entry.f = cleaned.context ? `${cleaned.mienh} (${cleaned.context})` : cleaned.mienh;

  dict[cleaned.eng] = [entry];
  added++;
}

// Sort and write
const sorted = Object.fromEntries(
  Object.entries(dict).sort(([a], [b]) => a.localeCompare(b))
);

writeFileSync('dict-slim.json', JSON.stringify(sorted, null, 2) + '\n');

console.log(`Added: ${added}`);
console.log(`Skipped (existing/empty/suspicious): ${skipped}`);
console.log(`Dictionary now has ${Object.keys(sorted).length} entries`);
