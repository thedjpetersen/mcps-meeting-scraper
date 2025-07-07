// fetchMCPSComplete.ts - Complete MCPS meeting downloader with metadata, subtitles, and agendas
// USAGE: tsx fetchMCPSComplete.ts [max_meetings] [segments_per_meeting]

import { promises as fs } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

interface Meeting {
  id: string;
  title: string;
  date: string;
  committee?: string;
  duration?: string;
  agendaUrl?: string;
  minutesUrl?: string;
  description?: string;
  videoUrl?: string;
  m3u8Url?: string;
}

// Load progress tracking
async function loadProgress(outputDir: string): Promise<Set<string>> {
  const progressFile = join(outputDir, '.progress.json');
  try {
    const data = await fs.readFile(progressFile, 'utf8');
    return new Set(JSON.parse(data).completed || []);
  } catch {
    return new Set();
  }
}

// Save progress
async function saveProgress(outputDir: string, completed: Set<string>) {
  const progressFile = join(outputDir, '.progress.json');
  await fs.writeFile(progressFile, JSON.stringify({
    completed: Array.from(completed),
    lastUpdate: new Date().toISOString()
  }, null, 2));
}

// Download file with proper error handling
async function downloadFile(url: string, outputPath: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      console.error(`Failed to download ${url}: ${response.status}`);
      return false;
    }
    
    await fs.mkdir(join(outputPath, '..'), { recursive: true });
    await streamPipeline(response.body, createWriteStream(outputPath));
    return true;
  } catch (error) {
    console.error(`Error downloading ${url}:`, error);
    return false;
  }
}

// Extract clean metadata from meeting page
async function getMeetingMetadata(meetingId: string): Promise<Meeting | null> {
  try {
    const response = await fetch(`https://mcpsmd.new.swagit.com/videos/${meetingId}`);
    const html = await response.text();
    
    // Extract title from JSON-LD or title tag
    let title = `Meeting ${meetingId}`;
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        title = jsonData.name || title;
      } catch {}
    } else {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      if (titleMatch) {
        title = titleMatch[1].replace(/\s*-\s*Montgomery.*$/, '').trim();
      }
    }
    
    // Extract date more reliably
    let date = 'Unknown';
    // Look for the date in the page content
    const dateMatch = html.match(/datetime="([^"]+)"/) || 
                     html.match(/(\w+\s+\d{1,2},\s+\d{4})/) ||
                     html.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) {
      date = dateMatch[1];
      // Clean up datetime format if needed
      if (date.includes('T')) {
        date = new Date(date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      }
    }
    
    // Extract committee type
    let committee = 'Board of Education';
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('fiscal')) committee = 'Fiscal Management Committee';
    else if (lowerTitle.includes('strategic')) committee = 'Strategic Planning Committee';
    else if (lowerTitle.includes('special pop')) committee = 'Committee on Special Populations';
    else if (lowerTitle.includes('policy')) committee = 'Policy Management Committee';
    else if (lowerTitle.includes('closed session')) committee = 'Closed Session';
    
    // Extract m3u8 URL from player setup
    const m3u8Match = html.match(/file:\s*["']([^"']*\.m3u8[^"']*)/);
    if (!m3u8Match) {
      console.error(`Could not find m3u8 URL for meeting ${meetingId}`);
      return null;
    }
    
    // Extract agenda and minutes URLs
    let agendaUrl: string | undefined;
    let minutesUrl: string | undefined;
    
    // Look for agenda link
    const agendaMatch = html.match(/href="([^"]+)"[^>]*>\s*(?:Agenda|AGENDA)\s*</i);
    if (agendaMatch) {
      agendaUrl = agendaMatch[1];
      if (!agendaUrl.startsWith('http')) {
        agendaUrl = `https://mcpsmd.new.swagit.com${agendaUrl}`;
      }
    }
    
    // Look for minutes link
    const minutesMatch = html.match(/href="([^"]+)"[^>]*>\s*(?:Minutes|MINUTES)\s*</i);
    if (minutesMatch) {
      minutesUrl = minutesMatch[1];
      if (!minutesUrl.startsWith('http')) {
        minutesUrl = `https://mcpsmd.new.swagit.com${minutesUrl}`;
      }
    }
    
    // Extract duration if available
    let duration = 'Unknown';
    const durationMatch = html.match(/Duration[^>]*>\s*([^<]+)</) ||
                         html.match(/>(\d+:\d+:\d+)</);
    if (durationMatch) {
      duration = durationMatch[1].trim();
    }
    
    return {
      id: meetingId,
      title,
      date,
      committee,
      duration,
      agendaUrl,
      minutesUrl,
      videoUrl: `https://mcpsmd.new.swagit.com/videos/${meetingId}`,
      m3u8Url: m3u8Match[1]
    };
    
  } catch (error) {
    console.error(`Error fetching metadata for meeting ${meetingId}:`, error);
    return null;
  }
}

// Get all meeting IDs
async function getAllMeetingIds(maxMeetings: number): Promise<string[]> {
  const meetingIds: string[] = [];
  
  try {
    // Fetch main page
    const response = await fetch('https://mcpsmd.new.swagit.com/views/25');
    const html = await response.text();
    
    // Extract all unique video IDs
    const videoMatches = html.match(/\/videos\/(\d+)/g) || [];
    const uniqueIds = [...new Set(videoMatches.map(m => m.match(/\d+/)?.[0]).filter(Boolean))] as string[];
    
    console.log(`Found ${uniqueIds.length} unique meeting IDs`);
    return uniqueIds.slice(0, maxMeetings);
    
  } catch (error) {
    console.error('Error fetching meeting IDs:', error);
    return [];
  }
}

// Download subtitles with ALL segments for complete meetings
async function downloadSubtitles(meeting: Meeting, outputDir: string): Promise<boolean> {
  try {
    if (!meeting.m3u8Url) return false;
    
    // Check if complete subtitles already exist
    const files = await fs.readdir(outputDir).catch(() => []);
    const completeSubtitles = files.find(f => f === 'captions_complete.srt' || f === 'captions_complete.vtt');
    if (completeSubtitles) {
      const stats = await fs.stat(join(outputDir, completeSubtitles));
      if (stats.size > 50000) { // At least 50KB for a complete meeting
        console.log('    ✅ Complete subtitles already exist');
        return true;
      }
    }
    
    // Use fetchSubs.ts with ALL segments (no limit)
    console.log(`    🎥 Downloading ALL video segments for complete subtitles...`);
    console.log(`    ⚠️  This may take 30-60 minutes per meeting and use several GB of space`);
    execSync(`tsx fetchSubs.ts "${meeting.m3u8Url}"`, {
      cwd: process.cwd(),
      stdio: 'inherit' // Show progress
    });
    
    // Move files to meeting directory and process
    const subsDir = join(process.cwd(), 'subs');
    if (await fs.stat(subsDir).catch(() => false)) {
      const subFiles = await fs.readdir(subsDir);
      console.log(`    📁 Moving ${subFiles.length} files to meeting directory...`);
      
      for (const file of subFiles) {
        await fs.rename(join(subsDir, file), join(outputDir, file));
      }
      
      // Extract captions from the complete video
      if (subFiles.some(f => f.endsWith('.ts'))) {
        console.log('    🔧 Concatenating all video segments...');
        console.log('    ⏳ This may take 10-20 minutes...');
        
        try {
          // Concatenate all segments into one file
          execSync(`cat ${outputDir}/segment_*.ts > ${outputDir}/complete_video.ts`, { 
            stdio: 'inherit',
            timeout: 1800000 // 30 minute timeout
          });
          
          console.log('    📝 Extracting complete subtitles...');
          console.log('    ⏳ This may take 5-15 minutes...');
          
          // Extract captions using multiple methods
          const captionMethods = [
            `ffmpeg -f lavfi -i "movie=${outputDir}/complete_video.ts[out+subcc]" -map 0:1 -c:s srt ${outputDir}/captions_complete.srt -y`,
            `ffmpeg -i ${outputDir}/complete_video.ts -map 0:s:0 -c:s srt ${outputDir}/captions_complete.srt -y`,
            `ffmpeg -i ${outputDir}/complete_video.ts -c:s srt ${outputDir}/captions_complete.srt -y`
          ];
          
          let extractionSuccess = false;
          for (let i = 0; i < captionMethods.length && !extractionSuccess; i++) {
            try {
              console.log(`    🔧 Trying extraction method ${i + 1}...`);
              execSync(captionMethods[i], { 
                stdio: 'pipe',
                timeout: 900000 // 15 minute timeout
              });
              
              // Check if extraction succeeded
              const captionFile = join(outputDir, 'captions_complete.srt');
              if (await fs.stat(captionFile).catch(() => false)) {
                const stats = await fs.stat(captionFile);
                if (stats.size > 10000) { // At least 10KB for meaningful content
                  console.log(`    ✅ Successfully extracted ${Math.round(stats.size / 1024)}KB of complete subtitles!`);
                  extractionSuccess = true;
                  
                  // Analyze the subtitle duration
                  const content = await fs.readFile(captionFile, 'utf8');
                  const timestamps = content.match(/\d{2}:\d{2}:\d{2},\d{3}/g);
                  if (timestamps && timestamps.length > 0) {
                    const lastTimestamp = timestamps[timestamps.length - 1];
                    console.log(`    📊 Complete duration: ${lastTimestamp.split(',')[0]}`);
                  }
                }
              }
            } catch (error) {
              console.log(`    ⚠️  Method ${i + 1} failed, trying next...`);
            }
          }
          
          if (extractionSuccess) {
            // Clean up video files to save space (keep only the complete subtitle file)
            console.log('    🧹 Cleaning up video files to save space...');
            for (const file of subFiles.filter(f => f.endsWith('.ts'))) {
              await fs.unlink(join(outputDir, file)).catch(() => {});
            }
            await fs.unlink(join(outputDir, 'complete_video.ts')).catch(() => {});
            
            return true;
          } else {
            console.log('    ❌ Failed to extract captions with all methods');
            return false;
          }
          
        } catch (error) {
          console.log('    ❌ Error during video processing:', error);
          return false;
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('    ❌ Error downloading subtitles:', error);
    return false;
  }
}

// Download agenda if available
async function downloadAgenda(meeting: Meeting, outputDir: string): Promise<boolean> {
  if (!meeting.agendaUrl) return false;
  
  try {
    const agendaPath = join(outputDir, 'agenda.pdf');
    if (await fs.stat(agendaPath).catch(() => false)) {
      console.log('    📄 Agenda already downloaded');
      return true;
    }
    
    console.log('    📄 Downloading agenda...');
    const success = await downloadFile(meeting.agendaUrl, agendaPath);
    if (success) {
      console.log('    ✅ Agenda downloaded');
    }
    return success;
  } catch (error) {
    console.error('    ❌ Error downloading agenda:', error);
    return false;
  }
}

// Main function
async function main() {
  const maxMeetings = process.argv[2] ? parseInt(process.argv[2]) : 100;
  const outputDir = 'mcps-meetings-complete';
  
  console.log(`📋 MCPS Complete Board Meeting Downloader`);
  console.log(`  Max meetings: ${maxMeetings}`);
  console.log(`  Mode: COMPLETE DOWNLOAD (all segments + full subtitles)`);
  console.log(`  Output directory: ${outputDir}`);
  console.log(`  ⚠️  WARNING: This will download COMPLETE meetings (6000-8000 segments each)`);
  console.log(`  📊 Expected: 2-8 GB per meeting, 30-60 minutes per meeting`);
  console.log(`  🕐 Total time estimate: ${maxMeetings * 45} minutes for ${maxMeetings} meetings\n`);
  
  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });
  
  // Load progress
  const completed = await loadProgress(outputDir);
  console.log(`  Previously completed: ${completed.size} meetings\n`);
  
  // Get meeting IDs
  console.log(`🔍 Fetching meeting list...`);
  const meetingIds = await getAllMeetingIds(maxMeetings);
  
  if (meetingIds.length === 0) {
    console.error('No meetings found!');
    return;
  }
  
  console.log(`📊 Processing ${meetingIds.length} meetings...\n`);
  
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const allMeetings: Meeting[] = [];
  
  for (let i = 0; i < meetingIds.length; i++) {
    const meetingId = meetingIds[i];
    
    // Skip if already completed
    if (completed.has(meetingId)) {
      console.log(`[${i + 1}/${meetingIds.length}] Skipping ${meetingId} (already completed)`);
      skippedCount++;
      continue;
    }
    
    console.log(`[${i + 1}/${meetingIds.length}] Processing meeting ${meetingId}...`);
    
    // Get metadata
    const metadata = await getMeetingMetadata(meetingId);
    if (!metadata) {
      console.log(`  ❌ Failed to get metadata`);
      failedCount++;
      continue;
    }
    
    allMeetings.push(metadata);
    
    console.log(`  📅 ${metadata.date} - ${metadata.title}`);
    console.log(`  🏛️  ${metadata.committee}`);
    
    // Create meeting directory
    const safeName = metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
    const dirName = `${metadata.date.replace(/[\/,\s]/g, '-')}_${safeName}_${metadata.id}`;
    const meetingDir = join(outputDir, dirName);
    await fs.mkdir(meetingDir, { recursive: true });
    
    // Save metadata
    await fs.writeFile(
      join(meetingDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8'
    );
    
    // Download agenda
    if (metadata.agendaUrl) {
      await downloadAgenda(metadata, meetingDir);
    }
    
    // Download complete subtitles (all segments)
    await downloadSubtitles(metadata, meetingDir);
    
    // Mark as completed
    completed.add(meetingId);
    await saveProgress(outputDir, completed);
    
    console.log(`  ✅ Completed\n`);
    successCount++;
    
    // Small delay to be respectful
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Generate summary report
  console.log(`\n📊 Final Summary:`);
  console.log(`  ✅ Successful: ${successCount}`);
  console.log(`  ⏭️  Skipped: ${skippedCount}`);
  console.log(`  ❌ Failed: ${failedCount}`);
  console.log(`  📁 Total meetings: ${allMeetings.length}`);
  
  // Create summary file
  const summaryContent = `MCPS Board of Education Meetings
Generated: ${new Date().toISOString()}

Summary:
- Total meetings processed: ${allMeetings.length}
- Successful downloads: ${successCount}
- Previously completed: ${skippedCount}
- Failed: ${failedCount}

Meetings by Committee:
${Object.entries(
  allMeetings.reduce((acc, m) => {
    acc[m.committee || 'Unknown'] = (acc[m.committee || 'Unknown'] || 0) + 1;
    return acc;
  }, {} as Record<string, number>)
).map(([committee, count]) => `- ${committee}: ${count}`).join('\n')}

All Meetings:
${allMeetings.map(m => `
${m.date} - ${m.title}
  Committee: ${m.committee}
  ID: ${m.id}
  Video: ${m.videoUrl}
  ${m.agendaUrl ? `Agenda: Available` : 'Agenda: Not available'}
  ${m.duration !== 'Unknown' ? `Duration: ${m.duration}` : ''}
`).join('\n')}`;
  
  await fs.writeFile(join(outputDir, 'summary.txt'), summaryContent, 'utf8');
  console.log(`\n📄 Summary saved to ${outputDir}/summary.txt`);
  console.log(`\n✨ Done! Check the ${outputDir}/ directory for all downloaded content.`);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});