// analyzeSubtitles.ts - Analyze downloaded subtitles
// USAGE: tsx analyzeSubtitles.ts

import { promises as fs } from 'fs';
import { join } from 'path';

interface SubtitleAnalysis {
  directory: string;
  hasSubtitles: boolean;
  fileSize?: number;
  lineCount?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  duration?: string;
  sampleText?: string;
}

function parseTimestamp(timestamp: string): number {
  const match = timestamp.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;
  
  const [, hours, minutes, seconds, ms] = match;
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms) / 1000;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

async function analyzeSubtitleFile(filePath: string): Promise<Partial<SubtitleAnalysis>> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // Find all timestamps
    const timestamps = lines.filter(line => line.includes('-->'));
    if (timestamps.length === 0) {
      return { fileSize: content.length, lineCount: lines.length };
    }
    
    const firstTimestamp = timestamps[0];
    const lastTimestamp = timestamps[timestamps.length - 1];
    
    // Parse duration
    const lastTime = parseTimestamp(lastTimestamp.split('-->')[0].trim());
    const duration = formatDuration(lastTime);
    
    // Get sample text (last few subtitle entries)
    const textLines = lines.filter(line => 
      !line.match(/^\d+$/) && 
      !line.includes('-->') && 
      line.trim().length > 0
    );
    
    const sampleText = textLines.slice(-3).join(' | ');
    
    return {
      fileSize: content.length,
      lineCount: lines.length,
      firstTimestamp,
      lastTimestamp,
      duration,
      sampleText
    };
    
  } catch (error) {
    return {};
  }
}

async function main() {
  const outputDir = 'mcps-meetings';
  
  console.log('📊 MCPS Meeting Subtitles Analysis\n');
  
  // Get all meeting directories
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const meetingDirs = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
  
  const analyses: SubtitleAnalysis[] = [];
  
  for (const dirName of meetingDirs) {
    const meetingDir = join(outputDir, dirName);
    const files = await fs.readdir(meetingDir);
    
    // Look for subtitle files
    const subtitleFile = files.find(f => f.endsWith('.srt') || f.endsWith('.vtt'));
    
    const analysis: SubtitleAnalysis = {
      directory: dirName,
      hasSubtitles: !!subtitleFile
    };
    
    if (subtitleFile) {
      const subtitlePath = join(meetingDir, subtitleFile);
      const details = await analyzeSubtitleFile(subtitlePath);
      Object.assign(analysis, details);
    }
    
    analyses.push(analysis);
  }
  
  // Print summary
  console.log(`Total meetings analyzed: ${analyses.length}`);
  console.log(`Meetings with subtitles: ${analyses.filter(a => a.hasSubtitles).length}`);
  console.log(`Meetings without subtitles: ${analyses.filter(a => !a.hasSubtitles).length}\n`);
  
  // Print details for each meeting
  console.log('Meeting Details:');
  console.log('================\n');
  
  for (const analysis of analyses) {
    console.log(`📁 ${analysis.directory}`);
    
    if (analysis.hasSubtitles) {
      console.log(`   ✅ Has subtitles`);
      if (analysis.fileSize) {
        console.log(`   📏 Size: ${Math.round(analysis.fileSize / 1024)}KB (${analysis.lineCount} lines)`);
      }
      if (analysis.duration) {
        console.log(`   ⏱️  Duration: ${analysis.duration}`);
      }
      if (analysis.lastTimestamp) {
        console.log(`   🕐 Time range: ${analysis.firstTimestamp?.split(' ')[0]} to ${analysis.lastTimestamp.split(' ')[0]}`);
      }
      if (analysis.sampleText) {
        console.log(`   💬 End content: "${analysis.sampleText.substring(0, 100)}..."`);
      }
    } else {
      console.log(`   ❌ No subtitles found`);
    }
    console.log('');
  }
  
  // Summary of durations
  const durationsFound = analyses.filter(a => a.duration);
  if (durationsFound.length > 0) {
    console.log('\n⚠️  IMPORTANT: Subtitle Duration Analysis');
    console.log('==========================================');
    console.log('All extracted subtitles appear to be truncated:');
    durationsFound.forEach(a => {
      console.log(`- ${a.directory}: Only ${a.duration} extracted`);
    });
    console.log('\nThis is because we only downloaded a small portion of each meeting.');
    console.log('Board meetings typically run 2-11 hours, but we only captured ~7 minutes each.');
    console.log('\nTo get complete subtitles, you would need to:');
    console.log('1. Download all video segments (thousands per meeting)');
    console.log('2. Use a streaming approach with ffmpeg');
    console.log('3. Or check if transcripts are available on the meeting pages');
  }
  
  // Save analysis to file
  const reportPath = join(outputDir, 'subtitle_analysis.json');
  await fs.writeFile(reportPath, JSON.stringify(analyses, null, 2));
  console.log(`\n📄 Full analysis saved to: ${reportPath}`);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});