// extractAllSubtitles.ts - Extract subtitles from all downloaded meetings
// USAGE: tsx extractAllSubtitles.ts

import { promises as fs } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

async function extractSubtitlesFromMeeting(meetingDir: string): Promise<boolean> {
  try {
    const files = await fs.readdir(meetingDir);
    
    // Check if subtitles already exist
    if (files.some(f => f.endsWith('.srt') || f.endsWith('.vtt'))) {
      console.log('  ✅ Subtitles already exist');
      return true;
    }
    
    // Check if we have video segments
    const hasSegments = files.some(f => f.endsWith('.ts') && f.includes('segment'));
    const hasVideo = files.includes('video.ts');
    
    if (!hasSegments && !hasVideo) {
      console.log('  ⚠️  No video files found');
      return false;
    }
    
    // If we don't have concatenated video, create it
    if (!hasVideo && hasSegments) {
      console.log('  🔧 Concatenating video segments...');
      try {
        execSync(`cat ${meetingDir}/segment_*.ts > ${meetingDir}/video.ts`, { stdio: 'ignore' });
      } catch (e) {
        console.log('  ❌ Failed to concatenate segments');
        return false;
      }
    }
    
    // Try multiple extraction methods
    console.log('  🔍 Attempting subtitle extraction...');
    
    const methods = [
      // Method 1: Extract CEA-608 captions as SRT
      {
        name: 'CEA-608 to SRT',
        cmd: `ffmpeg -f lavfi -i "movie=${meetingDir}/video.ts[out+subcc]" -map 0:1 ${meetingDir}/captions.srt -y`
      },
      // Method 2: Extract any subtitle stream
      {
        name: 'Subtitle stream extraction',
        cmd: `ffmpeg -i ${meetingDir}/video.ts -c:s srt ${meetingDir}/captions.srt -y`
      },
      // Method 3: Extract closed captions using different filter
      {
        name: 'Closed caption filter',
        cmd: `ffmpeg -i ${meetingDir}/video.ts -vf "subtitles=${meetingDir}/video.ts" -c:s srt ${meetingDir}/captions.srt -y`
      },
      // Method 4: Try to extract text from video using OCR (if tesseract is available)
      {
        name: 'OCR extraction',
        cmd: `ffmpeg -i ${meetingDir}/video.ts -vf "ocr" -f srt ${meetingDir}/captions.srt -y`
      }
    ];
    
    for (const method of methods) {
      try {
        console.log(`    Trying ${method.name}...`);
        execSync(method.cmd, { stdio: 'ignore' });
        
        // Check if file was created and has content
        const captionFile = join(meetingDir, 'captions.srt');
        const stats = await fs.stat(captionFile).catch(() => null);
        
        if (stats && stats.size > 100) {
          console.log(`  ✅ Successfully extracted subtitles using ${method.name}`);
          
          // Clean up video files to save space
          if (hasSegments) {
            const segments = files.filter(f => f.endsWith('.ts') && f.includes('segment'));
            for (const segment of segments) {
              await fs.unlink(join(meetingDir, segment)).catch(() => {});
            }
            await fs.unlink(join(meetingDir, 'video.ts')).catch(() => {});
          }
          
          return true;
        }
      } catch (e) {
        // Try next method
      }
    }
    
    // If nothing worked, check if there might be transcripts available online
    console.log('  ℹ️  No embedded captions found. Checking for online transcripts...');
    
    // Read metadata to get meeting URL
    const metadataPath = join(meetingDir, 'metadata.json');
    if (await fs.stat(metadataPath).catch(() => false)) {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      console.log(`    Meeting URL: ${metadata.videoUrl}`);
      console.log('    Note: Transcripts may be available on the meeting page');
    }
    
    return false;
    
  } catch (error) {
    console.error('  ❌ Error:', error);
    return false;
  }
}

async function main() {
  const outputDir = 'mcps-meetings';
  
  console.log('📋 MCPS Meeting Subtitle Extractor\n');
  
  // Get all meeting directories
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const meetingDirs = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name);
  
  console.log(`Found ${meetingDirs.length} meeting directories\n`);
  
  let successCount = 0;
  let alreadyHadSubtitles = 0;
  let noSubtitlesFound = 0;
  
  for (let i = 0; i < meetingDirs.length; i++) {
    const dirName = meetingDirs[i];
    const meetingDir = join(outputDir, dirName);
    
    console.log(`[${i + 1}/${meetingDirs.length}] Processing ${dirName}`);
    
    const result = await extractSubtitlesFromMeeting(meetingDir);
    
    if (result) {
      const files = await fs.readdir(meetingDir);
      if (files.some(f => f === 'captions.srt' || f === 'captions.vtt')) {
        successCount++;
      } else {
        alreadyHadSubtitles++;
      }
    } else {
      noSubtitlesFound++;
    }
    
    console.log('');
  }
  
  console.log('\n📊 Summary:');
  console.log(`  ✅ Successfully extracted: ${successCount}`);
  console.log(`  📝 Already had subtitles: ${alreadyHadSubtitles}`);
  console.log(`  ❌ No subtitles found: ${noSubtitlesFound}`);
  console.log(`  📁 Total processed: ${meetingDirs.length}`);
  
  // Generate report of meetings without subtitles
  const noSubtitleMeetings: string[] = [];
  for (const dirName of meetingDirs) {
    const meetingDir = join(outputDir, dirName);
    const files = await fs.readdir(meetingDir);
    if (!files.some(f => f.endsWith('.srt') || f.endsWith('.vtt'))) {
      noSubtitleMeetings.push(dirName);
    }
  }
  
  if (noSubtitleMeetings.length > 0) {
    const reportContent = `Meetings without extracted subtitles:
${noSubtitleMeetings.join('\n')}

These meetings may:
1. Not contain embedded captions
2. Have captions in a format that couldn't be extracted
3. Have transcripts available on the meeting webpage

To check for online transcripts, visit the meeting URLs listed in each metadata.json file.
`;
    
    await fs.writeFile(join(outputDir, 'no_subtitles_report.txt'), reportContent, 'utf8');
    console.log(`\n📄 Report saved to ${outputDir}/no_subtitles_report.txt`);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});