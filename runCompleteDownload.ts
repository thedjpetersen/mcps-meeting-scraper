// runCompleteDownload.ts - Run complete MCPS meeting downloads with proper error handling
// USAGE: tsx runCompleteDownload.ts [max_meetings]

import { promises as fs } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

async function main() {
  const maxMeetings = process.argv[2] ? parseInt(process.argv[2]) : 100;
  const outputDir = 'mcps-meetings-complete';
  
  console.log(`🚀 MCPS Complete Meeting Download Manager`);
  console.log(`==========================================`);
  console.log(`Target: ${maxMeetings} complete meetings`);
  console.log(`Output: ${outputDir}/`);
  console.log(`\n📋 Features:`);
  console.log(`  ✅ Downloads ALL video segments (complete meetings)`);
  console.log(`  ✅ Extracts complete subtitles (full duration)`);
  console.log(`  ✅ Includes meeting metadata and agendas`);
  console.log(`  ✅ Progress tracking and resumability`);
  console.log(`  ✅ Automatic cleanup of video files`);
  console.log(`\n⚠️  Resource Requirements:`);
  console.log(`  💾 Disk space: ~${maxMeetings * 4}GB total (temp), ~${maxMeetings * 100}MB final`);
  console.log(`  ⏱️  Time estimate: ~${maxMeetings * 45} minutes total`);
  console.log(`  🌐 Network: Stable connection required`);
  
  console.log(`\n🎯 Ready to download ${maxMeetings} complete MCPS Board meetings?`);
  console.log(`   This will give you FULL transcripts covering entire meetings.`);
  console.log(`\n▶️  To start the download, run:`);
  console.log(`   tsx fetchMCPSComplete.ts ${maxMeetings}`);
  console.log(`\n📝 Example usage for different scenarios:`);
  console.log(`   tsx fetchMCPSComplete.ts 1     # Test with 1 meeting`);
  console.log(`   tsx fetchMCPSComplete.ts 10    # Download 10 meetings`);
  console.log(`   tsx fetchMCPSComplete.ts 100   # Download all 100 meetings`);
  console.log(`\n🔧 Troubleshooting:`);
  console.log(`   - If download fails, re-run the same command to resume`);
  console.log(`   - Check disk space: df -h`);
  console.log(`   - Monitor progress in terminal output`);
  console.log(`\n📊 After completion:`);
  console.log(`   tsx analyzeSubtitles.ts  # Analyze subtitle completeness`);
  
  // Check if we already have some progress
  const progressFile = join(outputDir, '.progress.json');
  if (await fs.stat(progressFile).catch(() => false)) {
    const progressData = JSON.parse(await fs.readFile(progressFile, 'utf8'));
    const completed = progressData.completed || [];
    console.log(`\n✅ Found existing progress: ${completed.length} meetings already completed`);
    
    if (completed.length > 0) {
      console.log(`   Recent completions: ${completed.slice(-3).join(', ')}`);
      console.log(`   To resume where you left off, just run the download command.`);
    }
  }
  
  console.log(`\n🏁 Ready when you are!`);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});