// fetchSubs.ts – quick subtitle fetcher for Video.js / HLS streams
// USAGE:  ts-node fetchSubs.ts https://…/master.m3u8
// Requires: npm i -D ts-node typescript @types/node && npm i node-fetch m3u8-parser

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { Parser } from 'm3u8-parser';
import { pipeline } from 'stream';
import { createWriteStream } from 'fs';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

async function text(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
  return res.text();
}

function resolve(base: string, relative: string): string {
  return new URL(relative, base).toString();
}

async function concatWebVtt(masterUrl: string, outDir: string): Promise<boolean> {
  const master = new Parser();
  master.push(await text(masterUrl));
  master.end();

  const mediaGroups = master.manifest.mediaGroups['SUBTITLES'] ?? {};
  const tracks = Object.values(mediaGroups).flatMap(Object.values);
  if (!tracks.length) return false;

  await fs.mkdir(outDir, { recursive: true });

  for (const t of tracks) {
    if (!t.uri) continue;
    const plUrl = resolve(masterUrl, t.uri);
    const pl = new Parser();
    pl.push(await text(plUrl));
    pl.end();

    const lang = (t.language || t.name || 'unknown').toLowerCase();
    const dest = join(outDir, `${lang}.vtt`);
    let combined = 'WEBVTT\n\n';

    for (const seg of pl.manifest.segments) {
      combined += await text(resolve(plUrl, seg.uri));
    }
    await fs.writeFile(dest, combined, 'utf8');
    console.log(`✅ wrote ${dest}`);
  }
  return true;
}

async function downloadAllSegments(masterUrl: string, outDir: string, maxSegments?: number): Promise<void> {
  const master = new Parser();
  master.push(await text(masterUrl));
  master.end();
  const variant = master.manifest.playlists?.[0];
  if (!variant) return;
  const plUrl = resolve(masterUrl, variant.uri as string);
  const pl = new Parser();
  pl.push(await text(plUrl));
  pl.end();
  
  await fs.mkdir(outDir, { recursive: true });
  
  const segmentCount = maxSegments ? Math.min(maxSegments, pl.manifest.segments.length) : pl.manifest.segments.length;
  console.log(`📥 Downloading ${segmentCount} of ${pl.manifest.segments.length} segments...`);
  
  // Download segments
  for (let i = 0; i < segmentCount; i++) {
    const seg = pl.manifest.segments[i];
    const segUrl = resolve(plUrl, seg.uri);
    const dest = join(outDir, `segment_${i.toString().padStart(4, '0')}.ts`);
    
    const res = await fetch(segUrl);
    if (!res.ok || !res.body) throw new Error(`Failed ${segUrl}`);
    await streamPipeline(res.body, createWriteStream(dest));
    
    if (i % 10 === 0) {
      console.log(`  Progress: ${i}/${segmentCount} segments`);
    }
  }
  
  console.log(`✅ Downloaded all segments to ${outDir}/`);
  console.log(`\n🛈 No WebVTT tracks found. The video likely contains embedded CEA-608/708 captions.`);
  console.log(`\nTo extract captions, you can use one of these commands:`);
  console.log(`\n1. Using ffmpeg to extract and convert to WebVTT:`);
  console.log(`   ffmpeg -i "concat:${outDir}/segment_*.ts" -c:s webvtt ${outDir}/captions.vtt`);
  console.log(`\n2. Using CCExtractor for better CEA-608/708 support:`);
  console.log(`   ccextractor ${outDir}/segment_*.ts -o ${outDir}/captions.srt`);
  console.log(`\n3. Or concatenate all segments first:`);
  console.log(`   cat ${outDir}/segment_*.ts > ${outDir}/video.ts`);
  console.log(`   ffmpeg -i ${outDir}/video.ts -c:s webvtt ${outDir}/captions.vtt`);
}

async function main() {
  const masterUrl = process.argv[2];
  if (!masterUrl) {
    console.error('Usage: ts-node fetchSubs.ts <master.m3u8>');
    process.exit(1);
  }
  const outDir = 'subs';
  const maxSegments = process.argv[3] ? parseInt(process.argv[3]) : undefined;
  
  if (!(await concatWebVtt(masterUrl, outDir))) {
    await downloadAllSegments(masterUrl, outDir, maxSegments);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});