#!/usr/bin/env tsx

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface VideoInfo {
  id: string;
  title: string;
  upload_date: string;
  duration: number;
  description: string;
}

const CHANNEL_URL = 'https://www.youtube.com/@MCPS-MD/videos';
const OUTPUT_DIR = 'youtube_subs';
const METADATA_FILE = 'youtube_metadata.json';

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function loadExistingMetadata(): Record<string, VideoInfo> {
  if (fs.existsSync(METADATA_FILE)) {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
  }
  return {};
}

function saveMetadata(metadata: Record<string, VideoInfo>) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
}

function isBoardMeeting(title: string): boolean {
  // Common patterns for board meetings
  const meetingPatterns = [
    /board\s+of\s+education/i,
    /board\s+meeting/i,
    /special\s+session/i,
    /business\s+meeting/i,
    /work\s+session/i,
    /public\s+comments/i,
    /closed\s+session/i
  ];
  
  return meetingPatterns.some(pattern => pattern.test(title));
}

function getChannelVideos(maxVideos?: number): VideoInfo[] {
  console.log('Fetching video list from MCPS YouTube channel...');
  
  // Get more videos initially to filter through
  const fetchLimit = maxVideos ? maxVideos * 5 : 500; // Fetch more to account for filtering
  const command = `yt-dlp --dump-json --flat-playlist --max-downloads ${fetchLimit} "${CHANNEL_URL}"`;
  
  try {
    const output = execSync(command, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    const allVideos: VideoInfo[] = [];
    
    for (const line of output.split('\n')) {
      if (line.trim()) {
        try {
          const video = JSON.parse(line);
          allVideos.push({
            id: video.id,
            title: video.title,
            upload_date: video.upload_date || '',
            duration: video.duration || 0,
            description: video.description || ''
          });
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }
    
    // Filter for board meetings only
    const meetings = allVideos.filter(video => isBoardMeeting(video.title));
    
    console.log(`Found ${allVideos.length} total videos, ${meetings.length} are board meetings`);
    
    // Apply the maxVideos limit to the filtered results
    if (maxVideos && meetings.length > maxVideos) {
      return meetings.slice(0, maxVideos);
    }
    
    return meetings;
  } catch (error) {
    console.error('Error fetching video list:', error);
    return [];
  }
}

function downloadSubtitles(videoId: string, title: string): boolean {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const sanitizedTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 100);
  const outputPath = path.join(OUTPUT_DIR, `${videoId}_${sanitizedTitle}`);
  
  console.log(`\nDownloading subtitles for: ${title}`);
  console.log(`Video ID: ${videoId}`);
  
  // Try to download subtitles/captions
  const command = `yt-dlp --write-subs --write-auto-subs --sub-langs "en.*" --skip-download -o "${outputPath}" "${videoUrl}"`;
  
  try {
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    
    // Check if any subtitle files were created
    const files = fs.readdirSync(OUTPUT_DIR);
    const subFiles = files.filter(f => f.startsWith(`${videoId}_`) && (f.endsWith('.vtt') || f.endsWith('.srt')));
    
    if (subFiles.length > 0) {
      console.log(`✅ Downloaded ${subFiles.length} subtitle file(s):`);
      subFiles.forEach(f => console.log(`   - ${f}`));
      return true;
    } else {
      console.log('❌ No subtitles available for this video');
      return false;
    }
  } catch (error) {
    console.error(`❌ Error downloading subtitles: ${error}`);
    return false;
  }
}

async function main() {
  const maxVideos = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  
  console.log('MCPS YouTube Subtitle Downloader');
  console.log('================================');
  
  if (maxVideos) {
    console.log(`Limiting to ${maxVideos} videos`);
  }
  
  ensureOutputDir();
  
  // Load existing metadata
  const existingMetadata = loadExistingMetadata();
  
  // Get video list
  const videos = getChannelVideos(maxVideos);
  
  if (videos.length === 0) {
    console.error('No videos found or error occurred');
    return;
  }
  
  // Stats
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  
  // Process each video
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    console.log(`\n[${i + 1}/${videos.length}] Processing...`);
    
    // Check if already processed
    if (existingMetadata[video.id]) {
      console.log(`⏭️  Skipping (already processed): ${video.title}`);
      skipCount++;
      continue;
    }
    
    // Download subtitles
    const success = downloadSubtitles(video.id, video.title);
    
    if (success) {
      successCount++;
      // Save to metadata
      existingMetadata[video.id] = video;
      saveMetadata(existingMetadata);
    } else {
      failCount++;
    }
    
    // Add a small delay to be nice to YouTube
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n\nSummary');
  console.log('=======');
  console.log(`Total videos: ${videos.length}`);
  console.log(`✅ Successfully downloaded: ${successCount}`);
  console.log(`⏭️  Skipped (already processed): ${skipCount}`);
  console.log(`❌ Failed/No subtitles: ${failCount}`);
  console.log(`\nSubtitles saved to: ${OUTPUT_DIR}/`);
}

// Run the script
main().catch(console.error);