// fetchMCPSMeetingsV2.ts - Enhanced MCPS meeting downloader with metadata and subtitle extraction
// USAGE: tsx fetchMCPSMeetingsV2.ts [max_meetings]

import { promises as fs } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import { Parser } from 'm3u8-parser';

interface Meeting {
  id: string;
  title: string;
  date: string;
  committee?: string;
  duration?: string;
  agenda?: string;
  minutes?: string;
  description?: string;
}

interface MeetingMetadata extends Meeting {
  videoUrl: string;
  m3u8Url: string;
  segments?: number;
  captionsAvailable?: boolean;
}

// Extract detailed metadata from a meeting page
async function getMeetingMetadata(meetingId: string): Promise<MeetingMetadata | null> {
  try {
    const response = await fetch(`https://mcpsmd.new.swagit.com/videos/${meetingId}`);
    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/) || 
                      html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s*-\s*Montgomery.*$/, '') : `Meeting ${meetingId}`;
    
    // Extract date
    const datePatterns = [
      /(\w+\s+\d{1,2},\s+\d{4})/,  // Month DD, YYYY
      /(\d{1,2}\/\d{1,2}\/\d{4})/,  // MM/DD/YYYY
      /data-date="([^"]+)"/,
      /<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)</
    ];
    let date = 'Unknown';
    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        date = match[1].trim();
        break;
      }
    }
    
    // Extract committee/meeting type
    let committee = 'Board of Education';
    if (title.includes('Fiscal')) committee = 'Fiscal Management Committee';
    else if (title.includes('Strategic')) committee = 'Strategic Planning Committee';
    else if (title.includes('Special Pop')) committee = 'Committee on Special Populations';
    else if (title.includes('Policy')) committee = 'Policy Management Committee';
    
    // Extract duration
    const durationMatch = html.match(/duration[^>]*>([^<]+)</) ||
                         html.match(/(\d+:\d+:\d+)/) ||
                         html.match(/(\d+)\s*(?:hours?|hrs?)/i);
    const duration = durationMatch ? durationMatch[1].trim() : 'Unknown';
    
    // Extract m3u8 URL
    const m3u8Match = html.match(/src:\s*["']([^"']*\.m3u8[^"']*)/);
    if (!m3u8Match) {
      console.error(`Could not find m3u8 URL for meeting ${meetingId}`);
      return null;
    }
    const m3u8Url = m3u8Match[1];
    
    // Extract agenda/minutes links
    const agendaMatch = html.match(/href="([^"]+)"[^>]*>\s*Agenda\s*</i);
    const minutesMatch = html.match(/href="([^"]+)"[^>]*>\s*Minutes\s*</i);
    
    // Build metadata object
    const metadata: MeetingMetadata = {
      id: meetingId,
      title,
      date,
      committee,
      duration,
      videoUrl: `https://mcpsmd.new.swagit.com/videos/${meetingId}`,
      m3u8Url,
      agenda: agendaMatch ? `https://mcpsmd.new.swagit.com${agendaMatch[1]}` : undefined,
      minutes: minutesMatch ? `https://mcpsmd.new.swagit.com${minutesMatch[1]}` : undefined
    };
    
    return metadata;
    
  } catch (error) {
    console.error(`Error fetching metadata for meeting ${meetingId}:`, error);
    return null;
  }
}

// Get all available meetings with pagination
async function getAllMeetings(maxMeetings: number = 100): Promise<Meeting[]> {
  const meetings: Meeting[] = [];
  let page = 1;
  
  while (meetings.length < maxMeetings) {
    try {
      // Swagit uses pagination, try different page numbers
      const url = `https://mcpsmd.new.swagit.com/views/25?page=${page}`;
      const response = await fetch(url);
      const html = await response.text();
      
      // Look for meeting entries in the HTML
      const meetingPattern = /<tr[^>]*>[\s\S]*?href="\/videos\/(\d+)"[^>]*>([^<]+)<[\s\S]*?<\/tr>/g;
      let foundAny = false;
      let match;
      
      while ((match = meetingPattern.exec(html)) !== null) {
        foundAny = true;
        const id = match[1];
        const rowHtml = match[0];
        
        // Extract title
        const titleMatch = rowHtml.match(/href="\/videos\/\d+"[^>]*>([^<]+)</);
        const title = titleMatch ? titleMatch[1].trim() : `Meeting ${id}`;
        
        // Extract date - look for various date formats
        const dateMatch = rowHtml.match(/(\d{1,2}\/\d{1,2}\/\d{4})/) ||
                         rowHtml.match(/(\w+\s+\d{1,2},\s+\d{4})/);
        const date = dateMatch ? dateMatch[1] : 'Unknown';
        
        meetings.push({ id, title, date });
        
        if (meetings.length >= maxMeetings) break;
      }
      
      // If no meetings found on this page, try the main view
      if (!foundAny && page === 1) {
        const mainResponse = await fetch('https://mcpsmd.new.swagit.com/views/25');
        const mainHtml = await mainResponse.text();
        
        // Extract all unique video IDs
        const videoIds = [...new Set(mainHtml.match(/\/videos\/(\d+)/g)?.map(m => m.match(/\d+/)?.[0]).filter(Boolean) || [])] as string[];
        
        for (const id of videoIds.slice(0, maxMeetings)) {
          meetings.push({
            id,
            title: `Meeting ${id}`,
            date: 'Unknown'
          });
        }
        break;
      }
      
      if (!foundAny) break;
      page++;
      
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      break;
    }
  }
  
  return meetings.slice(0, maxMeetings);
}

// Download and process subtitles/captions
async function downloadAndExtractSubtitles(metadata: MeetingMetadata, outputDir: string): Promise<boolean> {
  try {
    // First check if the m3u8 has subtitle tracks
    const response = await fetch(metadata.m3u8Url);
    const m3u8Content = await response.text();
    
    // Parse the m3u8
    const parser = new Parser();
    parser.push(m3u8Content);
    parser.end();
    
    // Check for subtitle tracks
    const hasSubtitles = m3u8Content.includes('SUBTITLES') || m3u8Content.includes('.vtt');
    
    if (hasSubtitles) {
      // Use fetchSubs.ts to download VTT subtitles
      console.log('  📝 Found subtitle tracks, downloading...');
      execSync(`tsx fetchSubs.ts "${metadata.m3u8Url}"`, {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
    } else {
      // Download video segments and extract captions
      console.log('  🎥 No subtitle tracks found, downloading video segments for caption extraction...');
      
      // Download a reasonable number of segments (e.g., first 200 for ~10 minutes)
      execSync(`tsx fetchSubs.ts "${metadata.m3u8Url}" 200`, {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      
      // Try to extract captions using ffmpeg
      const subsDir = join(process.cwd(), 'subs');
      if (await fs.stat(subsDir).catch(() => false)) {
        console.log('  🔍 Attempting to extract embedded captions...');
        
        // Concatenate segments
        try {
          execSync(`cat ${subsDir}/segment_*.ts > ${subsDir}/video.ts`, { stdio: 'ignore' });
          
          // Try to extract captions
          const captionCommands = [
            `ffmpeg -i ${subsDir}/video.ts -map 0:s:0 -c:s srt ${subsDir}/captions.srt -y`,
            `ffmpeg -i ${subsDir}/video.ts -map 0:s:0 -c:s webvtt ${subsDir}/captions.vtt -y`,
            `ccextractor ${subsDir}/video.ts -o ${subsDir}/captions.srt`
          ];
          
          let extracted = false;
          for (const cmd of captionCommands) {
            try {
              execSync(cmd, { stdio: 'ignore' });
              const files = await fs.readdir(subsDir);
              if (files.some(f => f.endsWith('.srt') || f.endsWith('.vtt'))) {
                extracted = true;
                console.log('  ✅ Successfully extracted captions!');
                break;
              }
            } catch (e) {
              // Try next method
            }
          }
          
          if (!extracted) {
            console.log('  ⚠️  Could not extract captions (may not contain any)');
          }
        } catch (e) {
          console.log('  ⚠️  Error processing video segments');
        }
      }
    }
    
    // Move all files to the output directory
    const subsDir = join(process.cwd(), 'subs');
    if (await fs.stat(subsDir).catch(() => false)) {
      await fs.mkdir(outputDir, { recursive: true });
      const files = await fs.readdir(subsDir);
      
      for (const file of files) {
        await fs.rename(join(subsDir, file), join(outputDir, file));
      }
      
      // Save metadata
      await fs.writeFile(
        join(outputDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf8'
      );
      
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('Error downloading subtitles:', error);
    return false;
  }
}

async function main() {
  const maxMeetings = process.argv[2] ? parseInt(process.argv[2]) : 100;
  const outputDir = 'mcps-meetings';
  
  console.log(`🔍 Fetching list of MCPS Board meetings...`);
  
  // Get list of meetings
  const meetings = await getAllMeetings(maxMeetings);
  console.log(`📋 Found ${meetings.length} meetings to process\n`);
  
  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });
  
  let successCount = 0;
  let failedCount = 0;
  const processedMeetings: MeetingMetadata[] = [];
  
  for (let i = 0; i < meetings.length; i++) {
    const meeting = meetings[i];
    console.log(`\n[${i + 1}/${meetings.length}] Processing meeting ${meeting.id}...`);
    
    // Get detailed metadata
    const metadata = await getMeetingMetadata(meeting.id);
    if (!metadata) {
      console.log(`  ❌ Failed to get metadata`);
      failedCount++;
      continue;
    }
    
    console.log(`  📅 ${metadata.date} - ${metadata.title}`);
    console.log(`  🏛️  ${metadata.committee}`);
    console.log(`  ⏱️  Duration: ${metadata.duration}`);
    
    // Create folder for this meeting
    const safeName = metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const folderName = `${metadata.date.replace(/[\/,\s]/g, '-')}_${safeName}_${metadata.id}`.substring(0, 100);
    const meetingDir = join(outputDir, folderName);
    
    // Download and extract subtitles
    const success = await downloadAndExtractSubtitles(metadata, meetingDir);
    
    if (success) {
      console.log(`  ✅ Successfully processed meeting`);
      successCount++;
      processedMeetings.push(metadata);
    } else {
      console.log(`  ❌ Failed to process meeting`);
      failedCount++;
    }
    
    // Add a delay to be respectful to the server
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  // Generate summary report
  console.log(`\n\n📊 Final Summary:`);
  console.log(`  ✅ Successful: ${successCount}`);
  console.log(`  ❌ Failed: ${failedCount}`);
  console.log(`  📁 Output directory: ${outputDir}/`);
  
  // Create detailed summary file
  const summaryContent = `MCPS Board of Education Meetings - Download Summary
Generated: ${new Date().toISOString()}
Total Meetings Processed: ${processedMeetings.length}

Meetings:
${processedMeetings.map(m => `
ID: ${m.id}
Date: ${m.date}
Title: ${m.title}
Committee: ${m.committee}
Duration: ${m.duration}
Video URL: ${m.videoUrl}
${m.agenda ? `Agenda: ${m.agenda}` : ''}
${m.minutes ? `Minutes: ${m.minutes}` : ''}
---`).join('\n')}
`;
  
  await fs.writeFile(join(outputDir, 'download_summary.txt'), summaryContent, 'utf8');
  console.log(`\n📄 Detailed summary saved to ${outputDir}/download_summary.txt`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});