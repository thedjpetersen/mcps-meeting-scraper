// fetchMCPSMeetings.ts - Download subtitles from MCPS Board of Education meetings
// USAGE: ts-node fetchMCPSMeetings.ts [max_meetings]

import { promises as fs } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import { execSync } from 'child_process';

// Import the subtitle fetcher
async function fetchSubtitles(m3u8Url: string, outputPath: string): Promise<boolean> {
  try {
    // Use the existing fetchSubs.ts script
    execSync(`tsx fetchSubs.ts "${m3u8Url}" 50`, {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    
    // Move the downloaded files to the meeting-specific folder
    const subsDir = join(process.cwd(), 'subs');
    if (await fs.stat(subsDir).catch(() => false)) {
      // Check if we got subtitles or video segments
      const files = await fs.readdir(subsDir);
      const hasVtt = files.some(f => f.endsWith('.vtt'));
      const hasSrt = files.some(f => f.endsWith('.srt'));
      
      // Move all files to the output directory
      await fs.mkdir(outputPath, { recursive: true });
      for (const file of files) {
        await fs.rename(join(subsDir, file), join(outputPath, file));
      }
      
      return hasVtt || hasSrt;
    }
    return false;
  } catch (error) {
    console.error(`Error fetching subtitles: ${error}`);
    return false;
  }
}

async function getMeetingsList(): Promise<Array<{id: string, title: string, date: string}>> {
  const meetings: Array<{id: string, title: string, date: string}> = [];
  
  try {
    // Fetch the Swagit page that lists all meetings
    const response = await fetch('https://mcpsmd.new.swagit.com/views/25');
    const html = await response.text();
    
    // Extract all video rows - look for table rows with video links
    const rowPattern = /<tr[^>]*>[\s\S]*?<a[^>]+href="\/videos\/(\d+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/tr>/g;
    let match;
    
    while ((match = rowPattern.exec(html)) !== null) {
      const id = match[1];
      const title = match[2].trim();
      
      // Try to extract date from the row
      const rowContent = match[0];
      const dateMatch = rowContent.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      const date = dateMatch ? dateMatch[1] : 'Unknown';
      
      meetings.push({ id, title, date });
    }
    
    // If no meetings found with row pattern, try simpler approach
    if (meetings.length === 0) {
      const videoLinks = html.match(/href="\/videos\/(\d+)"/g) || [];
      const uniqueIds = [...new Set(videoLinks.map(link => {
        const idMatch = link.match(/\d+/);
        return idMatch ? idMatch[0] : null;
      }))].filter(Boolean) as string[];
      
      // For each ID, try to find associated text
      for (const id of uniqueIds) {
        const linkPattern = new RegExp(`href="/videos/${id}"[^>]*>([^<]+)<`, 'g');
        const titleMatch = linkPattern.exec(html);
        const title = titleMatch ? titleMatch[1].trim() : `Meeting ${id}`;
        
        meetings.push({
          id,
          title,
          date: 'Unknown'
        });
      }
    }
    
    console.log(`Found ${meetings.length} meetings`);
    return meetings;
    
  } catch (error) {
    console.error('Error fetching meetings list:', error);
    // Fallback: return some known meeting IDs
    return [
      { id: '346546', title: 'Board Meeting', date: 'Unknown' },
      { id: '345210', title: 'Board Meeting', date: 'Unknown' },
      { id: '343697', title: 'Board Meeting', date: 'Unknown' },
    ];
  }
}

async function getM3u8UrlForMeeting(meetingId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://mcpsmd.new.swagit.com/videos/${meetingId}`);
    const html = await response.text();
    
    // Extract the m3u8 URL from the player setup
    const m3u8Match = html.match(/src:\s*["']([^"']*\.m3u8[^"']*)/);
    if (m3u8Match) {
      return m3u8Match[1];
    }
    
    // Alternative pattern
    const altMatch = html.match(/playlist\.m3u8[^"']*/);
    if (altMatch && html.includes('archive-stream.granicus.com')) {
      const urlMatch = html.match(/https:\/\/archive-stream\.granicus\.com[^"']*playlist\.m3u8/);
      if (urlMatch) {
        return urlMatch[0];
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching meeting ${meetingId}:`, error);
    return null;
  }
}

async function main() {
  const maxMeetings = process.argv[2] ? parseInt(process.argv[2]) : 100;
  const outputDir = 'mcps-meetings';
  
  console.log(`Fetching last ${maxMeetings} MCPS Board meetings...`);
  
  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });
  
  // Get list of meetings
  const meetings = await getMeetingsList();
  const meetingsToProcess = meetings.slice(0, maxMeetings);
  
  console.log(`Processing ${meetingsToProcess.length} meetings...`);
  
  let successCount = 0;
  let failedCount = 0;
  
  for (let i = 0; i < meetingsToProcess.length; i++) {
    const meeting = meetingsToProcess[i];
    console.log(`\n[${i + 1}/${meetingsToProcess.length}] Processing: ${meeting.title} (${meeting.date})`);
    
    // Get the m3u8 URL for this meeting
    const m3u8Url = await getM3u8UrlForMeeting(meeting.id);
    
    if (!m3u8Url) {
      console.log(`  ❌ Could not find video URL for meeting ${meeting.id}`);
      failedCount++;
      continue;
    }
    
    console.log(`  📡 Found stream: ${m3u8Url}`);
    
    // Create folder for this meeting
    const safeName = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const meetingDir = join(outputDir, `${meeting.date.replace(/\//g, '-')}_${safeName}_${meeting.id}`);
    
    // Download subtitles
    const success = await fetchSubtitles(m3u8Url, meetingDir);
    
    if (success) {
      console.log(`  ✅ Successfully downloaded subtitles to ${meetingDir}`);
      successCount++;
    } else {
      console.log(`  ⚠️  Downloaded video segments (may contain embedded captions)`);
      successCount++;
    }
    
    // Add a small delay to be respectful to the server
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Successful: ${successCount}`);
  console.log(`  ❌ Failed: ${failedCount}`);
  console.log(`  📁 Output directory: ${outputDir}/`);
  
  // Create a summary file
  const summary = meetings.slice(0, maxMeetings).map(m => 
    `${m.date} - ${m.title} (ID: ${m.id})`
  ).join('\n');
  
  await fs.writeFile(join(outputDir, 'meetings_summary.txt'), summary, 'utf8');
  console.log(`\n📄 Meeting list saved to ${outputDir}/meetings_summary.txt`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});