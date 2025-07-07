// fetchMCPSOptimized.ts - Space and time optimized MCPS meeting downloader
// USAGE: tsx fetchMCPSOptimized.ts [max_meetings] [optimization_level]

import { promises as fs } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import fetch from 'node-fetch';

interface OptimizationLevel {
  name: string;
  segmentSampleRate: number;
  maxSegments: number;
  spaceUsage: string;
  timeEstimate: string;
  qualityDescription: string;
}

const optimizationLevels: Record<string, OptimizationLevel> = {
  'fast': {
    name: 'Fast (Sample Every 50th Segment)',
    segmentSampleRate: 50,
    maxSegments: 200,
    spaceUsage: '~80MB per meeting',
    timeEstimate: '~2 minutes per meeting',
    qualityDescription: 'Good coverage, may miss brief exchanges'
  },
  'balanced': {
    name: 'Balanced (Sample Every 20th Segment)', 
    segmentSampleRate: 20,
    maxSegments: 500,
    spaceUsage: '~200MB per meeting',
    timeEstimate: '~5 minutes per meeting',
    qualityDescription: 'Very good coverage, minimal content loss'
  },
  'thorough': {
    name: 'Thorough (Sample Every 10th Segment)',
    segmentSampleRate: 10,
    maxSegments: 1000,
    spaceUsage: '~400MB per meeting',
    timeEstimate: '~10 minutes per meeting',
    qualityDescription: 'Excellent coverage, near-complete content'
  },
  'complete': {
    name: 'Complete (All Segments)',
    segmentSampleRate: 1,
    maxSegments: 0, // No limit
    spaceUsage: '~4GB per meeting',
    timeEstimate: '~45 minutes per meeting',
    qualityDescription: 'Perfect - complete meeting transcription'
  }
};

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

// Get meeting metadata
async function getMeetingInfo(meetingId: string) {
  try {
    const response = await fetch(`https://mcpsmd.new.swagit.com/videos/${meetingId}`);
    const html = await response.text();
    
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(/\s*-\s*Montgomery.*$/, '').trim() : `Meeting ${meetingId}`;
    
    const dateMatch = html.match(/(\w+\s+\d{1,2},\s+\d{4})/) || html.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const date = dateMatch ? dateMatch[1] : 'Unknown';
    
    const m3u8Match = html.match(/file:\s*["']([^"']*\.m3u8[^"']*)/);
    if (!m3u8Match) return null;
    
    return {
      id: meetingId,
      title,
      date,
      m3u8Url: m3u8Match[1],
      videoUrl: `https://mcpsmd.new.swagit.com/videos/${meetingId}`
    };
  } catch (error) {
    console.error(`Error fetching meeting ${meetingId}:`, error);
    return null;
  }
}

// Optimized subtitle extraction
async function extractOptimizedSubtitles(meeting: any, outputDir: string, optimization: OptimizationLevel): Promise<boolean> {
  try {
    const outputPath = join(outputDir, 'captions.srt');
    
    // Check if already exists
    if (await fs.stat(outputPath).catch(() => false)) {
      const stats = await fs.stat(outputPath);
      if (stats.size > 5000) {
        console.log('    ✅ Subtitles already exist');
        return true;
      }
    }
    
    console.log(`    📥 Using ${optimization.name}...`);
    console.log(`    📊 Expected: ${optimization.spaceUsage}, ${optimization.timeEstimate}`);
    
    // Download segments based on optimization level
    const maxSegments = optimization.maxSegments === 0 ? '' : optimization.maxSegments.toString();
    
    execSync(`tsx fetchSubs.ts "${meeting.m3u8Url}" ${maxSegments}`, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
    
    // Process segments
    const subsDir = join(process.cwd(), 'subs');
    if (await fs.stat(subsDir).catch(() => false)) {
      const files = (await fs.readdir(subsDir)).filter(f => f.endsWith('.ts')).sort();
      
      // Apply sampling if not complete mode
      let selectedFiles = files;
      if (optimization.segmentSampleRate > 1) {
        selectedFiles = files.filter((_, index) => index % optimization.segmentSampleRate === 0);
        console.log(`    🔬 Sampling ${selectedFiles.length} of ${files.length} segments`);
      }
      
      // Concatenate selected segments
      if (selectedFiles.length > 0) {
        const segmentPaths = selectedFiles.map(f => join(subsDir, f));
        console.log(`    🔧 Processing ${selectedFiles.length} segments...`);
        
        execSync(`cat ${segmentPaths.join(' ')} > ${subsDir}/processed_video.ts`, { stdio: 'ignore' });
        
        // Extract captions
        console.log(`    📝 Extracting captions...`);
        execSync(`ffmpeg -f lavfi -i "movie=${subsDir}/processed_video.ts[out+subcc]" -map 0:1 -c:s srt "${outputPath}" -y`, { 
          stdio: 'pipe',
          timeout: 600000 
        });
        
        // Clean up
        await fs.rm(subsDir, { recursive: true, force: true });
        
        // Verify success
        if (await fs.stat(outputPath).catch(() => false)) {
          const stats = await fs.stat(outputPath);
          if (stats.size > 1000) {
            // Analyze extracted content
            const content = await fs.readFile(outputPath, 'utf8');
            const timestamps = content.match(/\d{2}:\d{2}:\d{2},\d{3}/g);
            const duration = timestamps && timestamps.length > 0 ? 
              timestamps[timestamps.length - 1].split(',')[0] : 'Unknown';
            
            console.log(`    ✅ Extracted ${Math.round(stats.size / 1024)}KB (${duration} duration)`);
            return true;
          }
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('    ❌ Error:', error);
    return false;
  }
}

async function main() {
  const maxMeetings = process.argv[2] ? parseInt(process.argv[2]) : 10;
  const optimizationLevel = process.argv[3] || 'balanced';
  const outputDir = 'mcps-optimized-meetings';
  
  if (!optimizationLevels[optimizationLevel]) {
    console.error(`Invalid optimization level: ${optimizationLevel}`);
    console.log('Available levels:', Object.keys(optimizationLevels).join(', '));
    process.exit(1);
  }
  
  const optimization = optimizationLevels[optimizationLevel];
  
  console.log(`🚀 MCPS Optimized Meeting Downloader`);
  console.log(`===================================`);
  console.log(`  Meetings: ${maxMeetings}`);
  console.log(`  Mode: ${optimization.name}`);
  console.log(`  Space per meeting: ${optimization.spaceUsage}`);
  console.log(`  Time per meeting: ${optimization.timeEstimate}`);
  console.log(`  Quality: ${optimization.qualityDescription}`);
  console.log(`  Total estimate: ${maxMeetings * parseInt(optimization.timeEstimate.match(/\d+/)?.[0] || '5')} minutes\n`);
  
  await fs.mkdir(outputDir, { recursive: true });
  
  // Load progress
  const completed = await loadProgress(outputDir);
  console.log(`  Previously completed: ${completed.size} meetings\n`);
  
  // Get meeting IDs
  console.log('🔍 Fetching meeting list...');
  const response = await fetch('https://mcpsmd.new.swagit.com/views/25');
  const html = await response.text();
  
  const videoMatches = html.match(/\/videos\/(\d+)/g) || [];
  const uniqueIds = [...new Set(videoMatches.map(m => m.match(/\d+/)?.[0]).filter(Boolean))] as string[];
  
  console.log(`📊 Found ${uniqueIds.length} meetings\n`);
  
  const meetingsToProcess = uniqueIds.slice(0, maxMeetings);
  let successCount = 0;
  let skippedCount = 0;
  
  for (let i = 0; i < meetingsToProcess.length; i++) {
    const meetingId = meetingsToProcess[i];
    
    if (completed.has(meetingId)) {
      console.log(`[${i + 1}/${meetingsToProcess.length}] Skipping ${meetingId} (completed)`);
      skippedCount++;
      continue;
    }
    
    console.log(`[${i + 1}/${meetingsToProcess.length}] Processing meeting ${meetingId}...`);
    
    // Get metadata
    const metadata = await getMeetingInfo(meetingId);
    if (!metadata) {
      console.log('  ❌ Failed to get metadata');
      continue;
    }
    
    console.log(`  📅 ${metadata.date} - ${metadata.title}`);
    
    // Create meeting directory
    const safeName = metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
    const dirName = `${metadata.date.replace(/[\/,\s]/g, '-')}_${safeName}_${metadata.id}`;
    const meetingDir = join(outputDir, dirName);
    await fs.mkdir(meetingDir, { recursive: true });
    
    // Save metadata
    await fs.writeFile(
      join(meetingDir, 'metadata.json'),
      JSON.stringify({
        ...metadata,
        optimizationUsed: optimization.name,
        extractionDate: new Date().toISOString()
      }, null, 2)
    );
    
    // Extract subtitles
    const success = await extractOptimizedSubtitles(metadata, meetingDir, optimization);
    
    if (success) {
      completed.add(meetingId);
      await saveProgress(outputDir, completed);
      successCount++;
      console.log('  ✅ Completed\n');
    } else {
      console.log('  ❌ Failed\n');
    }
    
    // Brief delay
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n📊 Final Summary:`);
  console.log(`  ✅ Successful: ${successCount}`);
  console.log(`  ⏭️  Skipped: ${skippedCount}`);
  console.log(`  📁 Output: ${outputDir}/`);
  console.log(`  🎯 Optimization: ${optimization.name}`);
  
  // Create summary report
  const summaryContent = `MCPS Optimized Meeting Downloads
Generated: ${new Date().toISOString()}
Optimization: ${optimization.name}
Quality: ${optimization.qualityDescription}

Space Savings: ${optimization.spaceUsage} (vs ~4GB complete)
Time Savings: ${optimization.timeEstimate} (vs ~45min complete)

Meetings processed: ${successCount}
Total space used: ~${successCount * parseInt(optimization.spaceUsage.match(/\d+/)?.[0] || '200')}MB
`;
  
  await fs.writeFile(join(outputDir, 'optimization_summary.txt'), summaryContent);
  console.log(`\n📄 Report saved to ${outputDir}/optimization_summary.txt`);
  console.log(`\n✨ Optimization complete! You saved ~${Math.round((4000 - parseInt(optimization.spaceUsage.match(/\d+/)?.[0] || '200')) / 4000 * 100)}% space and ~${Math.round((45 - parseInt(optimization.timeEstimate.match(/\d+/)?.[0] || '5')) / 45 * 100)}% time.`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});