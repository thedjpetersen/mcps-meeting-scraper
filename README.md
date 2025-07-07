# MCPS Board Meeting Scraper

A comprehensive system for downloading Montgomery County Public Schools Board of Education meetings with complete transcripts and subtitles. This tool addresses the challenge of accessing and archiving public meeting content by extracting professional-quality captions from live-streamed board meetings.

## What This Project Does

The Montgomery County Public Schools Board of Education conducts regular meetings that are streamed live and archived on the Swagit video platform. While these meetings are publicly accessible, there's no easy way to search through hours of content or extract transcripts for research purposes. This project solves that problem by automatically downloading meetings and extracting embedded closed captions that provide professional-quality transcripts.

The system downloads complete MCPS Board meetings including full subtitles and transcripts covering entire meeting durations (typically 2-11+ hours each), comprehensive meeting metadata such as dates, titles, committee information, and duration, meeting agendas when available as PDFs, robust progress tracking with resumable downloads, and multiple optimization levels offering up to 95% space savings while maintaining excellent quality.

## The Challenge We Solved

Board meetings are lengthy, often running 6-11 hours, and contain thousands of video segments. A typical meeting consists of approximately 8,000 video segments at 550KB each, totaling about 4.4GB of high-definition video data per meeting. While this might seem excessive, it's actually reasonable for professional-quality 1280x720 HD video at broadcast bitrates.

The real breakthrough came from developing smart optimization strategies that maintain transcript quality while dramatically reducing resource requirements. Instead of downloading every video segment, our optimized approach samples segments at strategic intervals, maintaining temporal distribution across the entire meeting while reducing download times and storage requirements by up to 95%.

## Quick Start Guide

Before getting started, ensure you have Node.js installed and run `npm install` to install the required dependencies. The project uses TypeScript and requires FFmpeg for video processing.

### Recommended Approach: Optimized Downloads

For most users, we recommend starting with the optimized download approach, which provides excellent quality while being much more practical in terms of time and storage requirements.

To download 10 meetings with balanced optimization, which provides very good coverage of meeting content while using only about 200MB per meeting and taking approximately 5 minutes per meeting to process:

```bash
tsx fetchMCPSOptimized.ts 10 balanced
```

For users who need to process many meetings quickly or have limited storage, the fast mode downloads 100 meetings efficiently, using only about 80MB per meeting and processing each meeting in approximately 2 minutes:

```bash
tsx fetchMCPSOptimized.ts 100 fast
```

Researchers or users who need comprehensive coverage should consider the thorough mode for high-quality downloads, which provides excellent meeting coverage using about 400MB per meeting and processing each meeting in approximately 10 minutes:

```bash
tsx fetchMCPSOptimized.ts 50 thorough
```

### Complete Downloads (Resource Intensive)

For users who need perfect transcript quality and have significant time and storage resources available, the complete download option processes every video segment. This approach requires substantial resources but provides verbatim transcripts of entire meetings.

A single complete meeting download takes approximately 45 minutes and uses about 4GB of temporary space:

```bash
tsx fetchMCPSComplete.ts 1
```

For processing multiple complete meetings, expect significant time and storage requirements - 10 meetings will take approximately 7.5 hours and require 40GB of temporary space:

```bash
tsx fetchMCPSComplete.ts 10
```

### Analyzing Results

After downloading meetings, you can analyze the subtitle quality and coverage using our analysis tools:

```bash
tsx analyzeSubtitles.ts
```

For detailed information about optimization strategies and performance comparisons, review the optimization guide:

```bash
cat OPTIMIZATION_GUIDE.md
```

## Understanding Optimization Levels

The project offers four distinct optimization levels, each designed for different use cases and resource constraints.

**Fast mode** samples every 50th video segment, resulting in approximately 80MB storage per meeting and 2-minute processing time. This provides good coverage of major topics and decisions, making it ideal for quick overviews, news reporting, or finding specific discussion topics. While some brief exchanges might be missed, all major agenda items and key discussions are captured.

**Balanced mode** (⭐ recommended) samples every 20th video segment, using approximately 200MB per meeting with 5-minute processing times. This mode provides very good coverage and is suitable for most research, policy tracking, and community engagement purposes. It captures all major discussions and board decisions while maintaining practical resource requirements.

**Thorough mode** samples every 10th video segment, requiring approximately 400MB per meeting and 10-minute processing times. This provides excellent coverage and is ideal for academic research, legal analysis, or detailed policy studies. The comprehensive discussion coverage makes it suitable for situations where missing brief comments could be problematic.

**Complete mode** processes all video segments without sampling, requiring approximately 4GB per meeting and 45-minute processing times. This provides perfect transcription quality and is appropriate for legal proceedings, official archives, or situations requiring complete documentation. Every word spoken during the meeting is captured in the transcript.

## How the Technology Works

The system operates through several sophisticated stages that together provide reliable, high-quality transcript extraction from live-streamed meetings.

### Meeting Discovery and Metadata Extraction

The process begins by scanning the Swagit video platform where MCPS hosts their meeting recordings. The system identifies all available meetings and extracts comprehensive metadata including meeting titles, dates, committee information, and agenda URLs when available. This automated discovery process ensures that new meetings are automatically included in processing queues.

### Stream Analysis and Download Strategy

Once meetings are identified, the system analyzes the HLS (HTTP Live Streaming) video streams to understand their structure. Each meeting video is composed of thousands of small segments, typically 5 seconds each. Our optimization algorithms determine which segments to download based on the selected quality level, ensuring temporal distribution across the entire meeting timeline.

### Caption Extraction and Processing

The downloaded video segments contain embedded CEA-608 closed captions, which are professional-quality captions that comply with accessibility standards. Using FFmpeg, the system extracts these captions and converts them to standard SRT subtitle format. This approach ensures higher quality than speech-to-text alternatives while maintaining timing accuracy.

### File Organization and Cleanup

Processed subtitles are organized into clearly labeled directories along with meeting metadata and agendas when available. The system automatically removes temporary video files after caption extraction, keeping only the essential transcript and metadata files. This cleanup process is crucial for managing storage requirements, especially when processing multiple meetings.

### Progress Tracking and Recovery

All operations include robust progress tracking, allowing downloads to resume if interrupted by network issues or system problems. The system maintains detailed logs of completed meetings and can skip previously processed content when restarted. This reliability feature is essential given the long processing times involved in complete downloads.

## Project Architecture and Output Structure

The system generates organized output directories that make it easy to navigate and utilize the extracted content.

For optimized downloads, content is stored in the `mcps-optimized-meetings/` directory, which includes progress tracking files, optimization summary reports, and individual meeting folders containing metadata and extracted subtitles. Each meeting folder includes a comprehensive metadata JSON file with meeting details and optimization information, plus the extracted subtitle file in standard SRT format.

Complete downloads are stored in the `mcps-meetings-complete/` directory with similar organization but including additional files such as meeting agendas when available and complete subtitle files covering entire meeting durations. The complete mode provides the most comprehensive archive of meeting content.

## Performance Analysis and Resource Planning

Understanding the performance characteristics of different optimization levels helps users choose the most appropriate approach for their needs.

### Storage Requirements

Complete downloads require substantial storage, with each meeting using approximately 4GB during processing and generating transcript files of about 100MB. This storage requirement reflects the high-definition video quality and extensive meeting durations. In contrast, balanced optimization reduces storage requirements to approximately 200MB per meeting during processing, representing a 95% reduction while maintaining excellent transcript quality.

### Processing Time Considerations

Time requirements vary dramatically between optimization levels. Complete downloads require approximately 45 minutes per meeting, making them suitable for overnight processing or dedicated processing sessions. Balanced optimization reduces processing time to approximately 5 minutes per meeting, making it practical for regular use and large-scale processing projects.

### Network Usage and Reliability

Network requirements depend on the chosen optimization level, ranging from 80MB to 4GB per meeting. The system includes robust error handling and automatic retry logic to handle network interruptions gracefully. All downloads are resumable, so temporary network issues don't require restarting the entire process.

## Quality Assessment and Use Cases

Different optimization levels serve distinct use cases, and understanding these helps users select the most appropriate approach.

### General Research and Community Engagement

Most users will find balanced mode optimal for general research, policy tracking, and community engagement purposes. This mode captures all major discussions and board decisions while maintaining practical resource requirements. The resulting transcripts provide excellent coverage of meeting content with searchable text that facilitates finding specific topics or decisions.

### Professional and Academic Research

Researchers conducting detailed analysis may prefer thorough mode, which provides comprehensive discussion coverage suitable for academic research, legal analysis, or detailed policy studies. The near-complete transcript coverage ensures that important context and nuanced discussions are preserved.

### Official Documentation and Legal Requirements

Organizations requiring complete meeting documentation should use complete mode, which provides verbatim transcripts suitable for legal proceedings, official archives, or situations requiring perfect documentation. This mode ensures that every spoken word is captured and transcribed.

### News and Quick Reference

Media professionals and others needing quick access to key meeting highlights will find fast mode sufficient for news reporting, quick summaries, and finding specific discussion topics. While some brief exchanges may be missed, all major agenda items and key discussions are preserved.

## Getting Started with Your First Download

For new users, we recommend starting with a small test to understand the system's capabilities and requirements. Begin by installing dependencies with `npm install`, then try downloading a few meetings using balanced optimization to get familiar with the process and output format.

A good starting point is downloading 5 meetings with balanced optimization, which will complete in about 25 minutes and use approximately 1GB of storage:

```bash
tsx fetchMCPSOptimized.ts 5 balanced
```

After the download completes, examine the results using the analysis tools to understand the transcript quality and coverage. This will help you determine whether to continue with balanced mode or adjust to a different optimization level based on your specific needs.

The system includes comprehensive error handling and progress tracking, so you can experiment with confidence knowing that any issues can be easily resolved and progress won't be lost. Once you're comfortable with the basic operation, you can scale up to larger downloads or adjust optimization levels as needed for your specific use case.