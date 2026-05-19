#!/usr/bin/env node
// segment-tts-audio.mjs
// Splits chapter-level Bible audio into verse-level segments using silence detection.
// Then generates Piper-compatible training data (22050Hz mono WAV + metadata).
//
// Usage: node segment-tts-audio.mjs [--book GEN] [--all]
//
// Requires: ffmpeg
//
// Output structure:
//   tts-data/
//     wavs/           — verse-level WAV files (22050Hz mono 16-bit)
//     metadata.txt    — Piper format: filename|text (no header)

import { execSync, exec } from 'child_process';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const TTS_DIR = path.join(process.cwd(), 'tts-data');
const WAVS_DIR = path.join(TTS_DIR, 'wavs');
const SAMPLE_RATE = 22050;

// Silence detection parameters
const SILENCE_THRESH_DB = -35; // dB threshold for silence
const MIN_SILENCE_DURATION = 0.3; // seconds of silence to count as a break
const MIN_SEGMENT_DURATION = 1.0; // minimum segment length in seconds
const MAX_SEGMENT_DURATION = 15.0; // max segment length (for Piper training)

function detectSilences(mp3Path) {
  // Use ffmpeg silencedetect filter to find silence boundaries
  const cmd = `ffmpeg -i "${mp3Path}" -af silencedetect=noise=${SILENCE_THRESH_DB}dB:d=${MIN_SILENCE_DURATION} -f null - 2>&1`;
  const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

  const silences = [];
  const lines = output.split('\n');

  let silenceStart = null;
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);

    if (startMatch) {
      silenceStart = parseFloat(startMatch[1]);
    }
    if (endMatch && silenceStart !== null) {
      const silenceEnd = parseFloat(endMatch[1]);
      const midpoint = (silenceStart + silenceEnd) / 2;
      silences.push({ start: silenceStart, end: silenceEnd, mid: midpoint });
      silenceStart = null;
    }
  }

  return silences;
}

function getDuration(mp3Path) {
  const cmd = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${mp3Path}"`;
  return parseFloat(execSync(cmd, { encoding: 'utf-8' }).trim());
}

// Each chapter audio starts with a spoken intro (e.g. "Genesis 1, it says...")
// followed by a pause before verse 1. This finds that intro boundary.
function findIntroEnd(silences, duration, numVerses) {
  if (silences.length === 0) return 0;

  // The intro is typically 2-6 seconds. Look for the first silence gap
  // that occurs within the first 15% of the audio (or first 10 seconds).
  const maxIntroTime = Math.min(duration * 0.15, 10);

  for (const s of silences) {
    if (s.mid <= maxIntroTime && s.mid >= 1.0) {
      return s.end; // Start content after this silence ends
    }
  }

  // No early silence found — maybe no intro on this chapter
  return 0;
}

function computeSplitPoints(silences, contentStart, duration, numVerses) {
  // Strategy: Split the audio from contentStart to end into N equal parts,
  // placing split points at silence midpoints closest to each target.
  const contentDuration = duration - contentStart;
  if (numVerses <= 1) return [];
  if (silences.length === 0) {
    const step = contentDuration / numVerses;
    return Array.from({ length: numVerses - 1 }, (_, i) => contentStart + (i + 1) * step);
  }

  // Only use silences after the intro
  const contentSilences = silences.filter(s => s.mid > contentStart);

  // Target timestamps for N-1 split points
  const targetStep = contentDuration / numVerses;
  const splitPoints = [];

  for (let i = 1; i < numVerses; i++) {
    const target = contentStart + i * targetStep;
    // Find the silence midpoint closest to this target
    let best = null;
    let bestDist = Infinity;

    for (const s of contentSilences) {
      const dist = Math.abs(s.mid - target);
      if (dist < bestDist) {
        best = s.mid;
        bestDist = dist;
      }
    }

    // Only use if within reasonable distance of target (±40% of step)
    if (best !== null && bestDist < targetStep * 0.4) {
      splitPoints.push(best);
    } else {
      // Fall back to exact time-based split
      splitPoints.push(target);
    }
  }

  return splitPoints;
}

function splitAudio(mp3Path, splitPoints, contentStart, duration, outputPrefix) {
  const segments = [];
  const starts = [contentStart, ...splitPoints];
  const ends = [...splitPoints, duration];

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = ends[i];
    const segDuration = end - start;

    if (segDuration < 0.2) continue; // skip tiny segments

    const outFile = `${outputPrefix}_${String(i + 1).padStart(3, '0')}.wav`;
    const outPath = path.join(WAVS_DIR, outFile);

    // Convert to 22050Hz mono 16-bit WAV
    const cmd = `ffmpeg -y -i "${mp3Path}" -ss ${start.toFixed(3)} -t ${segDuration.toFixed(3)} -ar ${SAMPLE_RATE} -ac 1 -sample_fmt s16 "${outPath}" 2>/dev/null`;
    execSync(cmd);

    segments.push({ file: outFile, start, end, duration: segDuration });
  }

  return segments;
}

async function processBook(book) {
  const audioDir = path.join(TTS_DIR, 'audio', book);
  const transcriptDir = path.join(TTS_DIR, 'transcripts', book);

  if (!existsSync(audioDir) || !existsSync(transcriptDir)) {
    console.error(`  ⚠️  No data for ${book} (run extract-tts-data.mjs first)`);
    return [];
  }

  const chapters = (await readdir(audioDir))
    .filter(f => f.endsWith('.mp3'))
    .map(f => parseInt(f))
    .sort((a, b) => a - b);

  console.log(`\n📖 Segmenting ${book} (${chapters.length} chapters)`);
  const metadata = [];

  for (const ch of chapters) {
    const mp3Path = path.join(audioDir, `${ch}.mp3`);
    const transcriptPath = path.join(transcriptDir, `${ch}.json`);

    if (!existsSync(transcriptPath)) {
      process.stdout.write(`  ${book}.${ch}... ⚠️ no transcript\n`);
      continue;
    }

    const verses = JSON.parse(await readFile(transcriptPath, 'utf-8'));
    if (verses.length === 0) continue;

    process.stdout.write(`  ${book}.${ch} (${verses.length} verses)...`);

    try {
      const duration = getDuration(mp3Path);
      const silences = detectSilences(mp3Path);
      const contentStart = findIntroEnd(silences, duration, verses.length);
      const splitPoints = computeSplitPoints(silences, contentStart, duration, verses.length);
      const prefix = `${book}_${String(ch).padStart(3, '0')}`;
      const segments = splitAudio(mp3Path, splitPoints, contentStart, duration, prefix);

      // Match segments to verses (1:1 if counts match, otherwise best effort)
      const count = Math.min(segments.length, verses.length);
      for (let i = 0; i < count; i++) {
        const text = verses[i].text;
        // Skip very short text (likely just whitespace or labels)
        if (text.length < 5) continue;
        // Skip segments that are too long (won't train well)
        if (segments[i].duration > MAX_SEGMENT_DURATION) continue;
        // Skip segments too short
        if (segments[i].duration < MIN_SEGMENT_DURATION) continue;

        metadata.push(`${segments[i].file}|${text}`);
      }

      process.stdout.write(` ✓ ${count} segments\n`);
    } catch (err) {
      process.stdout.write(` ✗ ${err.message}\n`);
    }
  }

  return metadata;
}

async function main() {
  const args = process.argv.slice(2);
  let books = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--book') books.push(args[++i]);
    if (args[i] === '--all') {
      // Process all books that have audio downloaded
      const audioBase = path.join(TTS_DIR, 'audio');
      if (existsSync(audioBase)) {
        books = (await readdir(audioBase)).filter(d =>
          existsSync(path.join(audioBase, d))
        );
      }
    }
  }

  if (books.length === 0) {
    console.error('Usage: node segment-tts-audio.mjs --book GEN  (or --all)');
    process.exit(1);
  }

  await mkdir(WAVS_DIR, { recursive: true });

  console.log('🔊 Piper TTS Audio Segmentation Pipeline');
  console.log(`   Output: ${WAVS_DIR}`);
  console.log(`   Sample rate: ${SAMPLE_RATE}Hz mono`);
  console.log(`   Silence threshold: ${SILENCE_THRESH_DB}dB, min gap: ${MIN_SILENCE_DURATION}s`);

  let allMetadata = [];
  for (const book of books) {
    const entries = await processBook(book);
    allMetadata.push(...entries);
  }

  // Write Piper metadata file
  const metadataPath = path.join(TTS_DIR, 'metadata.txt');
  await writeFile(metadataPath, allMetadata.join('\n') + '\n');

  // Summary stats
  const wavCount = (await readdir(WAVS_DIR)).filter(f => f.endsWith('.wav')).length;
  const wavSize = execSync(`du -sh "${WAVS_DIR}"`, { encoding: 'utf-8' }).trim().split('\t')[0];

  console.log(`\n✅ Segmentation complete!`);
  console.log(`   ${allMetadata.length} utterances in metadata.txt`);
  console.log(`   ${wavCount} WAV files (${wavSize})`);
  console.log(`   Metadata: ${metadataPath}`);
  console.log(`\n💡 Next: Train with Piper TTS (needs GPU)`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
