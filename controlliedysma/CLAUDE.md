# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an SEO checker tool built with Playwright that automates SEO audits of websites. The tool crawls websites, checks SEO elements like meta tags and heading structure, and generates reports in HTML and Markdown formats.

## Architecture

### Core Components

- **SEOChecker class** (`seo-checker.js`): Main class that handles browser automation, page crawling, and SEO checks
- **CLI interface** (`seo-cli.js`): Command-line interface with argument parsing and execution flow
- **Example scripts**: Various usage examples (`example.js`, `example-with-profile.js`, `example-full-crawl.js`, `generate-report-only.js`)

### Key Features

- Automated website crawling with configurable page limits
- SEO checks: heading structure (H1-H6), meta tags (title/description), duplicate detection
- Browser automation with Playwright/Chromium
- Support for Chrome profile usage for authenticated crawling
- Report generation in HTML and Markdown formats
- CLI with comprehensive options

## Development Commands

### Setup
```bash
npm install
npx playwright install
```

### Running the Tool
```bash
# Basic usage via CLI
npm run seo <url>

# Direct CLI usage with options
node seo-cli.js <url> [options]

# Example usage
node seo-cli.js https://example.com -p 10 -f html
node seo-cli.js https://example.com --crawl --headless
```

### CLI Options
- `-p, --pages <number>`: Max pages to check (default: 5)
- `-c, --crawl`: Full site crawling mode
- `-o, --output <file>`: Report filename
- `-f, --format <type>`: Report format (html, md, both)
- `-h, --headless`: Run without browser UI
- `--no-profile`: Don't use Chrome profile

### Example Scripts
```bash
# Run basic example
node example.js

# Test single page
node generate-report-only.js

# Full crawl example
node example-full-crawl.js
```

## Code Structure

### SEOChecker Class Methods
- `init(options)`: Initialize browser/context with optional Chrome profile
- `checkHeadingStructure(url)`: Analyze H1-H6 heading hierarchy
- `checkMetaTags(url)`: Check title and description meta tags
- `navigateAndCheck(url, maxPages)`: Crawl site and perform checks
- `generateReport()`: Create HTML and/or Markdown reports
- `close()`: Clean up browser resources

### Configuration
- Browser runs in non-headless mode by default for observation
- Slow motion enabled (500ms) for debugging
- 1-second timeout between pages to avoid server overload
- Title length validation: 30-60 characters
- Description length validation: 70-155 characters

## Testing

No formal test framework is configured. Testing is done through example scripts and manual verification of reports.