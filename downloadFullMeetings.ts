// downloadFullMeetings.ts - Download complete meeting subtitles/transcripts
// USAGE: tsx downloadFullMeetings.ts [meeting_ids...]

import { promises as fs } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import { Parser } from 'm3u8-parser';

interface MeetingInfo {
  id: string;
  title: string;
  date: string;
  m3u8Url: string;
  totalSegments?: number;
  duration?: string;
}

// Get actual segment count from m3u8
async function getSegmentCount(m3u8Url: string): Promise<number> {
  try {
    // First get the master playlist
    const masterResponse = await fetch(m3u8Url);
    const masterContent = await masterResponse.text();
    
    // Parse to find chunklist
    const parser = new Parser();
    parser.push(masterContent);
    parser.end();
    
    // Get the chunklist URL
    let chunklistUrl = m3u8Url;
    if (masterContent.includes('chunklist.m3u8')) {
      chunklistUrl = m3u8Url.replace('playlist.m3u8', 'chunklist.m3u8');
    }
    
    // Get the actual segment list
    const chunkResponse = await fetch(chunklistUrl);
    const chunkContent = await chunkResponse.text();
    
    // Count .ts segments
    const segments = (chunkContent.match(/\.ts/g) || []).length;
    return segments;
    
  } catch (error) {
    console.error('Error getting segment count:', error);
    return 0;
  }
}

// Download subtitles using direct ffmpeg approach (more efficient for long videos)
async function downloadSubtitlesFFmpeg(meeting: MeetingInfo, outputDir: string): Promise<boolean> {
  try {
    await fs.mkdir(outputDir, { recursive: true });
    
    const srtPath = join(outputDir, 'captions.srt');
    const logPath = join(outputDir, 'extraction.log');
    
    // Check if already exists
    if (await fs.stat(srtPath).catch(() => false)) {
      const stats = await fs.stat(srtPath);
      if (stats.size > 1000) {
        console.log('  ✅ Subtitles already exist');
        return true;
      }
    }
    
    console.log('  🎬 Extracting subtitles directly from stream...');
    console.log(`  📊 Total segments: ${meeting.totalSegments} (${meeting.duration})`);
    
    // Use ffmpeg to extract captions directly without downloading all segments
    const commands = [
      // Method 1: Direct CEA-608 extraction
      `ffmpeg -i "${meeting.m3u8Url}" -f lavfi -i "movie=${meeting.m3u8Url}[out+subcc]" -map 1:0 -c:s srt "${srtPath}" -y`,
      
      // Method 2: Extract embedded captions
      `ffmpeg -i "${meeting.m3u8Url}" -map 0:s:0 -c:s srt "${srtPath}" -y`,
      
      // Method 3: Use closed caption decoder
      `ffmpeg -f lavfi -i "movie=${meeting.m3u8Url}[out0+subcc]" -map 0:1 "${srtPath}" -y`
    ];
    
    for (let i = 0; i < commands.length; i++) {
      try {
        console.log(`  🔧 Trying method ${i + 1}...`);
        execSync(commands[i], { 
          stdio: 'pipe',
          timeout: 600000 // 10 minute timeout
        });
        
        // Check if successful
        if (await fs.stat(srtPath).catch(() => false)) {
          const stats = await fs.stat(srtPath);
          if (stats.size > 1000) {
            console.log(`  ✅ Successfully extracted ${stats.size} bytes of subtitles`);
            
            // Save extraction log
            await fs.writeFile(logPath, `Extraction successful using method ${i + 1}\nCommand: ${commands[i]}\nFile size: ${stats.size} bytes`, 'utf8');
            
            return true;
          }
        }
      } catch (error) {
        // Try next method
      }
    }
    
    console.log('  ⚠️  Could not extract subtitles');
    return false;
    
  } catch (error) {
    console.error('  ❌ Error:', error);
    return false;
  }
}

// Get meeting metadata
async function getMeetingInfo(meetingId: string): Promise<MeetingInfo | null> {
  try {
    const response = await fetch(`https://mcpsmd.new.swagit.com/videos/${meetingId}`);
    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(/\s*-\s*Montgomery.*$/, '').trim() : `Meeting ${meetingId}`;
    
    // Extract date
    const dateMatch = html.match(/(\w+\s+\d{1,2},\s+\d{4})/) || html.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const date = dateMatch ? dateMatch[1] : 'Unknown';
    
    // Extract m3u8 URL
    const m3u8Match = html.match(/file:\s*["']([^"']*\.m3u8[^"']*)/);
    if (!m3u8Match) {
      console.error(`Could not find m3u8 URL for meeting ${meetingId}`);
      return null;
    }
    
    return {
      id: meetingId,
      title,
      date,
      m3u8Url: m3u8Match[1]
    };
    
  } catch (error) {
    console.error(`Error fetching meeting ${meetingId}:`, error);
    return null;
  }
}

async function main() {
  const outputDir = 'mcps-meetings-full';
  
  // Get meeting IDs from command line or use defaults
  let meetingIds = process.argv.slice(2);
  
  if (meetingIds.length === 0) {
    // Default to some recent meetings
    console.log('No meeting IDs provided. Using recent meetings...');
    meetingIds = ['346546', '345210', '343697', '342093', '341074', '339700'];
  }
  
  console.log(`📋 MCPS Full Meeting Downloader`);
  console.log(`  Meetings to process: ${meetingIds.length}\n`);
  
  await fs.mkdir(outputDir, { recursive: true });
  
  for (let i = 0; i < meetingIds.length; i++) {
    const meetingId = meetingIds[i];
    console.log(`\n[${i + 1}/${meetingIds.length}] Processing meeting ${meetingId}...`);
    
    // Get meeting info
    const meeting = await getMeetingInfo(meetingId);
    if (!meeting) {
      console.log('  ❌ Failed to get meeting info');
      continue;
    }
    
    // Get segment count
    meeting.totalSegments = await getSegmentCount(meeting.m3u8Url);
    meeting.duration = meeting.totalSegments ? 
      `~${Math.round(meeting.totalSegments * 5 / 60)} minutes` : 
      'Unknown';
    
    console.log(`  📅 ${meeting.date} - ${meeting.title}`);
    
    // Create output directory
    const safeName = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
    const dirName = `${meeting.date.replace(/[\/,\s]/g, '-')}_${safeName}_${meeting.id}`;
    const meetingDir = join(outputDir, dirName);
    
    // Save metadata
    await fs.mkdir(meetingDir, { recursive: true });
    await fs.writeFile(
      join(meetingDir, 'metadata.json'),
      JSON.stringify(meeting, null, 2),
      'utf8'
    );
    
    // Download subtitles
    await downloadSubtitlesFFmpeg(meeting, meetingDir);
    
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n✅ Done! Check ${outputDir}/ for full meeting subtitles.`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});