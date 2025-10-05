# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web analysis toolkit built with Playwright that automates SEO audits and accessibility testing of websites. The project includes:

1. **SEO Checker**: Audits SEO elements like meta tags, heading structure, page size, favicon, and legal sections
2. **Accessibility Checker**: Tests web accessibility using axe-core and custom checks following WCAG guidelines
3. **HTML to PDF Converter**: Standalone utility to convert HTML reports to PDF format

Both tools can crawl websites, analyze multiple pages, and generate detailed reports in HTML and Markdown formats.

## Architecture

### Core Components

#### SEO Checker
- **SEOChecker class** (`seo-checker.js`): Main class that handles browser automation, page crawling, and SEO checks
- **CLI interface** (`seo-cli.js`): Command-line interface with argument parsing and execution flow
- **Example scripts**: Various usage examples (`example.js`, `example-with-profile.js`, `example-full-crawl.js`, `generate-report-only.js`)

#### Accessibility Checker
- **A11yChecker class** (`a11y-checker.js`): Main class for accessibility testing using axe-core and custom checks
- **CLI interface** (`a11y-cli.js`): Command-line interface for accessibility audits
- **axe-core integration**: Uses axe-core library for comprehensive WCAG compliance testing

### Key Features

#### Common Features
- Automated website crawling with configurable page limits
- Browser automation with Playwright/Chromium
- Support for Chrome profile usage for authenticated crawling
- Report generation in HTML and Markdown formats
- CLI with comprehensive options

#### SEO Checker Features
- Heading structure analysis (H1-H6)
- Meta tags validation (title/description)
- Page size analysis
- Favicon detection
- Email exposure detection
- Legal sections verification (Privacy Policy, Terms, Cookies)
- Duplicate content detection

#### Accessibility Checker Features
- WCAG 2.1 AA/AAA compliance testing using axe-core
- Custom accessibility checks (skip links, landmarks, form labels)
- Color contrast validation
- Keyboard navigation testing
- Focus management verification
- Screen reader compatibility checks
- Accessibility score calculation (0-100)

## Development Commands

### Setup
```bash
npm install
npx playwright install
```

### Running the Tools

#### SEO Checker
```bash
# Basic usage via CLI
npm run seo <url>

# Direct CLI usage with options
node seo-cli.js <url> [options]

# Example usage
node seo-cli.js https://example.com -p 10 -f html
node seo-cli.js https://example.com --crawl --headless
node seo-cli.js https://example.com --select-profile
```

#### Accessibility Checker
```bash
# Basic usage via CLI
npm run a11y <url>

# Direct CLI usage with options
node a11y-cli.js <url> [options]

# Example usage
node a11y-cli.js https://example.com -p 10 -f html
node a11y-cli.js https://example.com --crawl --headless
node a11y-cli.js https://example.com --no-profile
node a11y-cli.js https://example.com -f dichiarazione --org "ACME SRL" --email info@acme.it
```

#### HTML to PDF Converter
```bash
# Basic usage via CLI
npm run html2pdf <file.html>

# Direct CLI usage with options
node html-to-pdf.js <file.html> [options]

# Example usage
node html-to-pdf.js report.html
node html-to-pdf.js report.html -o output.pdf
node html-to-pdf.js report.html --format A3 --landscape
node html-to-pdf.js report.html --margin 20
node html-to-pdf.js report.html --margin "15,20,15,20"
```

### CLI Options (Common to both tools)
- `-p, --pages <number>`: Max pages to check (default: 5)
- `-c, --crawl`: Full site crawling mode (ignores -p)
- `-o, --output <file>`: Report filename (default: auto-generated)
- `-f, --format <type>`: Report format (html, md, json, all) (default: all)
- `-h, --headless`: Run without browser UI
- `--no-profile`: Don't use Chrome profile (uses Chromium instead of Chrome)
- `--select-profile`: Show list of available Chrome profiles for user selection
- `--help`: Show help message

#### Accessibility Checker Specific Options
- `-f, --format <type>`: Report format (html, md, json, dichiarazione, allegato2, all) (default: all)
  - `html`: Detailed HTML report with page index and violations
  - `md`: Markdown report
  - `json`: Machine-readable JSON with detailed violation data
  - `dichiarazione`: Italian accessibility declaration (Legge 4/2004)
  - `allegato2`: AGID self-assessment model (Allegato 2) with WCAG 2.1 AA criteria table
  - `all`: Generate all standard formats (html, md, json)

**Dichiarazione (Accessibility Declaration) Options:**
- `--org <name>`: Organization name (default: "L'ORGANIZZAZIONE")
- `--email <email>`: Contact email (default: "contatti@esempio.it")
- `--phone <number>`: Contact phone (optional)
- `--pub-date <date>`: Site publication date (default: "01/01/2020")
- `--cms <system>`: CMS/System used (default: "Custom")
- `--ai-key <key>`: Anthropic API key to simplify descriptions for non-technical managers (default: ANTHROPIC_API_KEY env var)

The `dichiarazione` format generates an Italian accessibility declaration compliant with Legge 9 gennaio 2004, n. 4, mapping violations to UNI CEI EN 301549 requirements. This format is specifically designed for Italian public administration websites.

**AI-Powered Description Simplification:**
When an Anthropic API key is provided (via `--ai-key` parameter or `ANTHROPIC_API_KEY` environment variable), the tool uses Claude AI to automatically rewrite technical violation descriptions into simple, manager-friendly language. This makes the accessibility declaration more understandable for non-technical stakeholders.

To use this feature:
1. Get an API key from https://console.anthropic.com/
2. Set environment variable: `export ANTHROPIC_API_KEY=sk-ant-api03-...`
3. Or use parameter: `--ai-key sk-ant-api03-...`

Example with AI simplification:
```bash
export ANTHROPIC_API_KEY=sk-ant-api03-...
node a11y-cli.js https://example.com -f dichiarazione --org "ACME SRL"
```

**Allegato 2 (AGID Self-Assessment Model):**
The `allegato2` format generates an Italian self-assessment compliance table following AGID guidelines (Allegato 2 alle Linee Guida sull'Accessibilità degli Strumenti Informatici). This report includes:
- Complete table of all WCAG 2.1 A and AA criteria
- Mapping to EN 301 549 standards
- Automatic conformity status (S/NS/NA) based on detected violations
- Professional format suitable for official documentation

Example:
```bash
node a11y-cli.js https://example.com -f allegato2
```

Note: The JSON format provides detailed machine-readable data perfect for integration with other tools and CI/CD pipelines.

#### HTML to PDF Converter Options
- `-o, --output <file>`: Output PDF filename (default: same as input with .pdf extension)
- `--format <formato>`: Page format: A4, A3, A5, Letter, Legal, Tabloid (default: A4)
- `--landscape`: Horizontal orientation (default: vertical)
- `--margin <margine>`: Margin in mm, single value or "top,right,bottom,left" (default: 10mm)
- `--help`: Show help message

This standalone tool converts any HTML file (including generated reports) to PDF format. It uses Playwright's PDF generation with full support for CSS, images, and backgrounds. Perfect for creating printable versions of accessibility and SEO reports.

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

### A11yChecker Class Methods
- `init(options)`: Initialize browser/context with axe-core injection
- `checkAccessibility(url)`: Run comprehensive accessibility tests using axe-core
- `performCustomChecks(url)`: Run custom accessibility checks (skip links, landmarks, etc.)
- `analyzeResults(axeResults, customChecks)`: Analyze and score accessibility results
- `navigateAndCheck(url, maxPages)`: Crawl site and perform accessibility checks
- `generateReport()`: Create console accessibility report
- `generateMarkdownReport()`: Create Markdown accessibility report
- `generateHTMLReport()`: Create HTML accessibility report with page index and detailed violations
- `generateJSONReport()`: Create JSON accessibility report with detailed machine-readable data
- `generateDichiarazioneHTML(options)`: Create Italian accessibility declaration (Legge 4/2004) with WCAG mapping
- `close()`: Clean up browser resources

### Configuration
- Browser runs in non-headless mode by default for observation
- Slow motion enabled (500ms) for debugging
- 1-second timeout between pages to avoid server overload
- Uses Chrome profile by default (can be disabled with `--no-profile`)
- Profile selection available with `--select-profile` flag (shows interactive list)
- Supports both Chrome and Chromium browsers

#### SEO Checker Specific
- Title length validation: 30-60 characters
- Description length validation: 70-155 characters
- Page size limit: 200 KB warning
- Supports JSON export for programmatic usage

#### Accessibility Checker Specific
- Uses axe-core for WCAG 2.1 AA/AAA testing
- Includes custom checks for skip links, landmarks, and form validation
- Accessibility score calculation (0-100 scale)
- Severity classification: critical, serious, moderate, minor
- JSON export with detailed element selectors and violation data
- Machine-readable reports for CI/CD integration
- Immediate and general recommendations based on found issues

## Testing

No formal test framework is configured. Testing is done through example scripts and manual verification of reports.

### Quick Tests
```bash
# Test SEO checker
npm run seo https://example.com -- --headless --no-profile -p 1

# Test accessibility checker
npm run a11y https://example.com -- --headless --no-profile -p 1

# Test with JSON output for CI/CD integration
npm run a11y https://example.com -- --headless --no-profile -f json

# Generate all formats
npm run a11y https://example.com -- --headless --no-profile -f all
```