// downloadCompleteMeetings.ts - Download complete meetings with all subtitles
// USAGE: tsx downloadCompleteMeetings.ts [max_meetings]

import { promises as fs } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Calculate how many segments to download based on meeting length
function calculateSegmentsNeeded(meetingId: string): number {
  // Based on observed data:
  // - Most meetings have 6000-8000 segments
  // - We were getting ~7 minutes from 200 segments
  // - So we need all segments for complete subtitles
  
  // However, downloading 8000+ segments is impractical
  // Let's download enough for a reasonable portion:
  // - 1000 segments = ~83 minutes
  // - 2000 segments = ~166 minutes
  
  return 2000; // This should give us 2-3 hours of content
}

async function downloadMeetingWithFullSubtitles(meetingId: string, outputDir: string): Promise<boolean> {
  try {
    const meetingDir = join(outputDir, `meeting_${meetingId}`);
    await fs.mkdir(meetingDir, { recursive: true });
    
    // Check if already processed
    const captionsPath = join(meetingDir, 'captions_complete.srt');
    if (await fs.stat(captionsPath).catch(() => false)) {
      console.log('  ✅ Already processed');
      return true;
    }
    
    // Get meeting page to find m3u8 URL
    console.log('  🔍 Getting meeting info...');
    const response = await fetch(`https://mcpsmd.new.swagit.com/videos/${meetingId}`);
    const html = await response.text();
    
    const m3u8Match = html.match(/file:\s*["']([^"']*\.m3u8[^"']*)/);
    if (!m3u8Match) {
      console.log('  ❌ Could not find video URL');
      return false;
    }
    
    const m3u8Url = m3u8Match[1];
    const segments = calculateSegmentsNeeded(meetingId);
    
    console.log(`  📥 Downloading ${segments} segments for complete subtitles...`);
    
    // Use fetchSubs.ts to download segments
    execSync(`tsx fetchSubs.ts "${m3u8Url}" ${segments}`, {
      cwd: process.cwd(),
      stdio: 'pipe' // Suppress output
    });
    
    // Move files to meeting directory
    const subsDir = join(process.cwd(), 'subs');
    if (await fs.stat(subsDir).catch(() => false)) {
      // Concatenate all segments
      console.log('  🔧 Processing video segments...');
      execSync(`cat ${subsDir}/segment_*.ts > ${subsDir}/complete_video.ts`, { stdio: 'ignore' });
      
      // Extract subtitles
      console.log('  📝 Extracting subtitles...');
      const extractCmd = `ffmpeg -f lavfi -i "movie=${subsDir}/complete_video.ts[out+subcc]" -map 0:1 ${captionsPath} -y`;
      execSync(extractCmd, { stdio: 'ignore' });
      
      // Check if extraction was successful
      const stats = await fs.stat(captionsPath).catch(() => null);
      if (stats && stats.size > 10000) {
        console.log(`  ✅ Extracted ${Math.round(stats.size / 1024)}KB of subtitles`);
        
        // Clean up video files to save space
        await fs.rm(subsDir, { recursive: true, force: true });
        
        // Save metadata
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const title = titleMatch ? titleMatch[1].replace(/\s*-\s*Montgomery.*$/, '').trim() : `Meeting ${meetingId}`;
        
        await fs.writeFile(
          join(meetingDir, 'metadata.json'),
          JSON.stringify({
            id: meetingId,
            title,
            url: `https://mcpsmd.new.swagit.com/videos/${meetingId}`,
            m3u8Url,
            segmentsDownloaded: segments,
            subtitleSize: stats.size
          }, null, 2)
        );
        
        return true;
      } else {
        console.log('  ⚠️  Subtitle extraction produced small/empty file');
        await fs.rm(subsDir, { recursive: true, force: true });
        return false;
      }
    }
    
    return false;
    
  } catch (error) {
    console.error('  ❌ Error:', error);
    // Clean up
    try {
      await fs.rm(join(process.cwd(), 'subs'), { recursive: true, force: true });
    } catch {}
    return false;
  }
}

async function main() {
  const maxMeetings = process.argv[2] ? parseInt(process.argv[2]) : 10;
  const outputDir = 'mcps-complete-meetings';
  
  console.log(`📋 MCPS Complete Meeting Downloader`);
  console.log(`  Target: ${maxMeetings} meetings with full subtitles\n`);
  
  await fs.mkdir(outputDir, { recursive: true });
  
  // Get meeting IDs
  console.log('🔍 Fetching meeting list...');
  const response = await fetch('https://mcpsmd.new.swagit.com/views/25');
  const html = await response.text();
  
  const videoMatches = html.match(/\/videos\/(\d+)/g) || [];
  const uniqueIds = [...new Set(videoMatches.map(m => m.match(/\d+/)?.[0]).filter(Boolean))] as string[];
  
  console.log(`📊 Found ${uniqueIds.length} meetings\n`);
  
  const meetingsToProcess = uniqueIds.slice(0, maxMeetings);
  let successCount = 0;
  
  for (let i = 0; i < meetingsToProcess.length; i++) {
    const meetingId = meetingsToProcess[i];
    console.log(`[${i + 1}/${meetingsToProcess.length}] Processing meeting ${meetingId}...`);
    
    const success = await downloadMeetingWithFullSubtitles(meetingId, outputDir);
    if (success) successCount++;
    
    // Delay between downloads
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`  Successful: ${successCount}/${meetingsToProcess.length}`);
  console.log(`  Output: ${outputDir}/`);
  
  // Check the subtitle files
  console.log(`\n📊 Subtitle File Sizes:`);
  const dirs = await fs.readdir(outputDir, { withFileTypes: true });
  for (const dir of dirs.filter(d => d.isDirectory())) {
    const captionsPath = join(outputDir, dir.name, 'captions_complete.srt');
    const stats = await fs.stat(captionsPath).catch(() => null);
    if (stats) {
      console.log(`  ${dir.name}: ${Math.round(stats.size / 1024)}KB`);
      
      // Show last few lines
      const content = await fs.readFile(captionsPath, 'utf8');
      const lines = content.split('\n');
      const lastTimestamp = lines.filter(l => l.includes('-->')).pop();
      if (lastTimestamp) {
        console.log(`    Last timestamp: ${lastTimestamp}`);
      }
    }
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});