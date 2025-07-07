# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a HLS (HTTP Live Streaming) subtitle and video segment scraper written in TypeScript. The main script `fetchSubs.ts` downloads subtitles from HLS/m3u8 video streams, with a fallback to download video segments when subtitles are not available as separate WebVTT tracks.

## Development Commands

### Running the scrapers
```bash
# Basic subtitle extraction from HLS stream
tsx fetchSubs.ts <master.m3u8_url>

# Limited segments for testing
tsx fetchSubs.ts <master.m3u8_url> <max_segments>

# Download COMPLETE MCPS meetings with full subtitles (resource intensive)
tsx fetchMCPSComplete.ts <max_meetings>

# Analyze downloaded subtitles
tsx analyzeSubtitles.ts

# Extract subtitles from existing downloads
tsx extractAllSubtitles.ts
```

### Installing dependencies
```bash
npm install
```

## Architecture

The project consists of a single main script (`fetchSubs.ts`) with two primary workflows:

1. **WebVTT Subtitle Extraction**: When the HLS stream includes SUBTITLES media groups, the script downloads and concatenates all WebVTT segments into language-specific files.

2. **Video Segment Download**: When no subtitle tracks are found, the script downloads video segments (assuming embedded CEA-608/708 captions) and provides instructions for caption extraction using ffmpeg or CCExtractor.

Key functions:
- `concatWebVtt()`: Handles WebVTT subtitle track download and concatenation
- `downloadAllSegments()`: Downloads video segments when subtitles aren't available separately
- `text()`: Fetches text content from URLs
- `resolve()`: Resolves relative URLs against base URLs

Output is saved to the `subs/` directory with files named by language code for subtitles or as numbered segments for video files.

## MCPS Board Meeting Scripts

### Complete Meeting Downloader (`fetchMCPSComplete.ts`)
Downloads complete MCPS Board of Education meetings with full subtitles:
- Downloads ALL video segments (6000-8000 per meeting)
- Extracts complete subtitles covering entire meetings (2-11 hours)
- Includes meeting metadata, agendas, and progress tracking
- Resource intensive: ~2-8 GB per meeting, 30-60 minutes download time
- Automatically cleans up video files after subtitle extraction

### Analysis Tools
- `analyzeSubtitles.ts` - Analyzes completeness of downloaded subtitles
- `extractAllSubtitles.ts` - Extracts captions from existing video segments

## Important Notes

- No TypeScript configuration file exists; the project uses tsx/ts-node defaults
- No testing framework is configured
- The project operates directly with tsx without a build step
- MCPS meetings contain embedded CEA-608 captions that can be extracted
- Complete meeting downloads are very resource intensive but provide full transcripts