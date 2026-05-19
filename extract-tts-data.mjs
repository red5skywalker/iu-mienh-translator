#!/usr/bin/env node
// extract-tts-data.mjs
// Downloads Bible audio and extracts verse-level text from Bible.com
// for use in training a Piper TTS model for Iu Mienh.
//
// Usage: node extract-tts-data.mjs [--book GEN] [--start 1] [--end 50]
//
// Output structure:
//   tts-data/
//     audio/          — chapter-level MP3 files
//     transcripts/    — verse-level text per chapter (JSON)
//     metadata.csv    — Piper-compatible metadata (audio_file|text)

import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const API_BASE = 'https://nodejs.bible.com/api/bible/chapter/3.1';
const VERSION_ID = 233; // Iu Mien (IuMiNR)
const DELAY_MS = 1500;

// Book definitions with expected chapter counts
const BOOKS = {
  GEN: 50, EXO: 40, LEV: 27, NUM: 36, DEU: 34,
  JOS: 24, JDG: 21, RUT: 4, '1SA': 31, '2SA': 24,
  '1KI': 22, '2KI': 25, '1CH': 29, '2CH': 36,
  EZR: 10, NEH: 13, EST: 10, JOB: 42, PSA: 150,
  PRO: 31, ECC: 12, SNG: 8, ISA: 66, JER: 52,
  LAM: 5, EZK: 48, DAN: 12, HOS: 14, JOL: 3,
  AMO: 9, OBA: 1, JON: 4, MIC: 7, NAM: 3,
  HAB: 3, ZEP: 3, HAG: 2, ZEC: 14, MAL: 4,
  MAT: 28, MRK: 16, LUK: 24, JHN: 21, ACT: 28,
  ROM: 16, '1CO': 16, '2CO': 13, GAL: 6, EPH: 6,
  PHP: 4, COL: 4, '1TH': 5, '2TH': 3, '1TI': 6,
  '2TI': 4, TIT: 3, PHM: 1, HEB: 13, JAS: 5,
  '1PE': 5, '2PE': 3, '1JN': 5, '2JN': 1, '3JN': 1,
  JUD: 1, REV: 22
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function removeNotes(html) {
  // Remove <span class="note ...">...</span> including all nested spans
  let result = '';
  let i = 0;
  while (i < html.length) {
    const noteStart = html.indexOf('<span class="note', i);
    if (noteStart === -1) {
      result += html.slice(i);
      break;
    }
    result += html.slice(i, noteStart);
    // Find the balanced closing </span> for this note
    let depth = 0;
    let j = noteStart;
    while (j < html.length) {
      const openIdx = html.indexOf('<span', j + 1);
      const closeIdx = html.indexOf('</span>', j);
      if (closeIdx === -1) { j = html.length; break; }
      if (openIdx !== -1 && openIdx < closeIdx) {
        depth++;
        j = openIdx + 1;
      } else {
        if (depth === 0) {
          j = closeIdx + '</span>'.length;
          break;
        }
        depth--;
        j = closeIdx + '</span>'.length;
      }
    }
    i = j;
  }
  return result;
}

function stripHtml(html) {
  let cleaned = removeNotes(html);
  // Remove verse number labels
  cleaned = cleaned.replace(/<span class="label">\d+<\/span>/g, '');
  // Remove all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  // Decode HTML entities
  cleaned = cleaned.replace(/&#8220;/g, '"').replace(/&#8221;/g, '"');
  cleaned = cleaned.replace(/&#8217;/g, "'").replace(/&#8216;/g, "'");
  cleaned = cleaned.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&#?\w+;/g, '');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function extractVerses(html) {
  const verses = [];
  // Match each verse span with data-usfm
  const verseRegex = /<span class="verse v(\d+)" data-usfm="([^"]+)">(.*?)(?=<span class="verse v|<\/div>)/gs;
  let match;

  // Simpler approach: split by verse markers and extract text
  const parts = html.split(/<span class="verse v\d+" data-usfm="([^"]+)">/);
  
  for (let i = 1; i < parts.length; i += 2) {
    const usfm = parts[i];
    const content = parts[i + 1] || '';
    const text = stripHtml(content);
    if (text && !verses.find(v => v.usfm === usfm)) {
      verses.push({ usfm, text });
    } else if (text && verses.find(v => v.usfm === usfm)) {
      // Append to existing verse (multi-paragraph verses)
      const existing = verses.find(v => v.usfm === usfm);
      existing.text += ' ' + text;
    }
  }

  return verses;
}

async function fetchChapter(book, chapter) {
  const reference = `${book}.${chapter}`;
  const url = `${API_BASE}?id=${VERSION_ID}&reference=${reference}`;
  
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${reference}: ${resp.status}`);
  }
  
  const data = await resp.json();
  return data;
}

async function downloadAudio(audioUrl, outputPath) {
  if (existsSync(outputPath)) {
    return; // skip if already downloaded
  }
  
  // Ensure URL has protocol
  const url = audioUrl.startsWith('//') ? 'https:' + audioUrl : audioUrl;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to download audio: ${resp.status}`);
  }
  
  const buffer = Buffer.from(await resp.arrayBuffer());
  await writeFile(outputPath, buffer);
}

async function main() {
  const args = process.argv.slice(2);
  let book = 'GEN';
  let startChapter = 1;
  let endChapter = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--book') book = args[++i];
    if (args[i] === '--start') startChapter = parseInt(args[++i]);
    if (args[i] === '--end') endChapter = parseInt(args[++i]);
  }

  if (!BOOKS[book]) {
    console.error(`Unknown book: ${book}. Available: ${Object.keys(BOOKS).join(', ')}`);
    process.exit(1);
  }

  if (!endChapter) endChapter = BOOKS[book];

  const dataDir = path.join(process.cwd(), 'tts-data');
  const audioDir = path.join(dataDir, 'audio', book);
  const transcriptDir = path.join(dataDir, 'transcripts', book);

  await mkdir(audioDir, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });

  console.log(`\n📖 Extracting ${book} chapters ${startChapter}-${endChapter}`);
  console.log(`   Audio → ${audioDir}`);
  console.log(`   Text  → ${transcriptDir}\n`);

  let totalVerses = 0;
  const metadata = [];

  for (let ch = startChapter; ch <= endChapter; ch++) {
    process.stdout.write(`  ${book}.${ch}...`);

    try {
      const data = await fetchChapter(book, ch);
      
      // Extract verses from HTML content
      const verses = extractVerses(data.content);
      totalVerses += verses.length;

      // Save transcript
      const transcriptPath = path.join(transcriptDir, `${ch}.json`);
      await writeFile(transcriptPath, JSON.stringify(verses, null, 2));

      // Download audio if available
      if (data.audio && data.audio.length > 0) {
        const audioInfo = data.audio[0];
        const mp3Url = audioInfo.download_urls?.format_mp3_32k;
        if (mp3Url) {
          const audioPath = path.join(audioDir, `${ch}.mp3`);
          await downloadAudio(mp3Url, audioPath);
          
          // Add to metadata (chapter-level for now)
          const relAudioPath = path.relative(dataDir, audioPath);
          const fullText = verses.map(v => v.text).join(' ');
          metadata.push(`${relAudioPath}|${fullText}`);
          
          process.stdout.write(` ✓ (${verses.length} verses, audio)\n`);
        } else {
          process.stdout.write(` ✓ (${verses.length} verses, no audio URL)\n`);
        }
      } else {
        process.stdout.write(` ✓ (${verses.length} verses, no audio)\n`);
      }

    } catch (err) {
      process.stdout.write(` ✗ ${err.message}\n`);
    }

    await sleep(DELAY_MS);
  }

  // Write metadata.csv
  const metadataPath = path.join(dataDir, 'metadata.csv');
  const existing = existsSync(metadataPath)
    ? (await readFile(metadataPath, 'utf-8')).trim()
    : '';
  const newContent = existing
    ? existing + '\n' + metadata.join('\n')
    : metadata.join('\n');
  await writeFile(metadataPath, newContent + '\n');

  console.log(`\n✅ Done! ${totalVerses} verses extracted, ${metadata.length} chapters with audio`);
  console.log(`   Metadata: ${metadataPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
