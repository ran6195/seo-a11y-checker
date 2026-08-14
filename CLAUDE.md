# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web analysis toolkit built with Playwright that automates SEO audits, accessibility testing, and Lighthouse audits of websites. The project includes:

1. **SEO Checker**: Audits SEO elements like meta tags, heading structure, page size, favicon, and legal sections
2. **Accessibility Checker**: Tests web accessibility using axe-core and custom checks following WCAG guidelines
3. **Lighthouse Checker**: Runs Google Lighthouse audits (performance, accessibility, SEO, best-practices) with Playwright-based crawling
4. **Unified Web Interface**: Browser-based GUI for running SEO and accessibility checks without using the command line (experimental)
5. **HTML to PDF Converter**: Standalone utility to convert HTML reports to PDF format
6. **URL Utilities**: Python scripts for CSV processing and URL extraction
7. **Link Extractor**: Tool to extract and analyze all links from a webpage
8. **WCAG Checks Suite** (`checks/`): Independent, incremental suite with one script per WCAG 2.1 A/AA success criterion — each combines a deterministic automated check (axe-core and/or hand-written heuristics/DOM interaction) with an optional Claude-powered fallback for cases that need semantic or visual judgment. Includes a multi-page orchestrator and an aggregated HTML/PDF report generator. Currently covers 26 of 50 criteria; see `checks/` directory listing for which, or `checks/CRITERI.md` for the full classification of all 50.

The SEO, accessibility, and Lighthouse checkers can all crawl websites, analyze multiple pages, and generate detailed reports in HTML, Markdown, and/or JSON formats. The WCAG Checks Suite is architecturally separate (its own `checks/lib/` helpers, does not reuse `A11yChecker`) and is documented in its own sections below.

## Architecture

### Core Components

#### SEO Checker
- **SEOChecker class** (`seo-checker.js`): Main class that handles browser automation, page crawling, and SEO checks
- **CLI interface** (`seo-cli.js`): Command-line interface with argument parsing and execution flow
- **Example scripts**: Various usage examples (`example.js`, `example-with-profile.js`, `example-full-crawl.js`, `generate-report-only.js`)

#### Accessibility Checker
- **A11yChecker class** (`a11y-checker.js`): Main class for accessibility testing using axe-core and custom checks
- **CLI interface** (`a11y-cli.js`): Command-line interface for accessibility audits
- **CSV batch processor** (`a11y-from-csv.js`): Extends A11yChecker to process multiple URLs from CSV files
- **From-JSON generator** (`a11y-from-json.js`): Generates `dichiarazione`/`allegato2` reports from an existing JSON report (output of `a11y-cli.js -f json`), without launching a browser
- **axe-core integration**: Uses axe-core library for comprehensive WCAG compliance testing

#### Lighthouse Checker
- **LighthouseChecker class** (`lighthouse-checker.js`): Runs Google Lighthouse audits per URL (always headless), with its own Playwright-based link discovery/crawling (`discoverLinksOnPage`, `crawlSite`)
- **CLI interface** (`lighthouse-cli.js`): Supports `--categories` (performance, accessibility, seo, best-practices), `--device` (mobile/desktop), and `--throttling` (simulate/devtools/none)

#### Web Interface
- **Unified Web Server** (`web-server.js`): Express-based server providing a unified browser GUI for both SEO and Accessibility checking
- **Unified Web UI** (`web-ui.html`): Interactive HTML interface with tabs, real-time output streaming, and report downloads
- **Legacy SEO Web Server** (`seo-web-server.js`): Original HTTP server for SEO checking only
- **Legacy SEO Web UI** (`seo-web-ui.html`): Original HTML interface for SEO checking

#### Supporting Utilities
- **Link extractor** (`list-links.js`): Extracts all links from a webpage with categorization (internal/external/email/tel)
- **URL utilities** (Python scripts): CSV processing, duplicate detection, and URL extraction tools

#### WCAG Checks Suite (`checks/`)
- **Per-criterion scripts** (`checks/<sc>-<slug>.js`, e.g. `checks/1.1.1-contenuto-non-testuale.js`): each exports `{ id, name, level, description, remediation, run(ctx) }`. `run(ctx)` receives `{ page, axeResults, url, options }` and returns `{ id, name, level, status, automated, ai, notes, description, remediation }` where `status` is one of `pass`, `fail`, `needs-review`, `not-applicable`, `error`. Design rule followed by every script: if the automated/heuristic layer already finds a certain fail (or the criterion is fully deterministic, e.g. 2.4.1), the AI fallback is skipped — it only runs to resolve genuine ambiguity, and only when `--ai` is passed.
- **`checks/lib/browser.js`**: `launchBrowser()`/`loadPage()` (split so a browser can be reused across multiple page loads) plus `window.__a11yDeepQuery()`, injected into every page, which traverses Shadow DOM (`document.querySelectorAll` does not) and `autoScroll()`, which scrolls the full page once after load so `visibility:hidden` scroll-reveal content (common in Elementor/Shopify themes) is settled before any check runs.
- **`checks/lib/anthropic.js`**: thin wrapper around `@anthropic-ai/sdk` (`askVision()` for text+image prompts, `parseJSONResponse()`) — model default `claude-haiku-4-5-20251001`.
- **`checks/lib/runner.js`**: `loadChecks()` (loads every file matching `checks/<n>.<n>.<n>-*.js` — a positive filename filter, not an exclusion list, so orchestrator/report scripts are never accidentally required as check modules) and `runChecksOnPage()`.
- **`checks/lib/naming.js`** / **`checks/lib/env.js`**: slug/timestamp helpers and the shared `.env` loader (same hand-rolled mechanism as `a11y-cli.js`, no `dotenv` dependency).
- **CLI: single page** (`checks/run.js`): runs all (or `--criteria`-filtered) checks against one URL.
- **CLI: multi-page** (`checks/run-site.js`): takes multiple URLs of the same site, computes the output run-folder **once** up front (not per page) and reuses a single browser — use this instead of calling `checks/run.js` once per page, since a full multi-criterion AI run easily exceeds a minute and separate invocations would land in different folders.
- **Aggregated report** (`checks/report.js`): reads every JSON in a run folder and generates `report.html` — per-page pass/fail/needs-review/n.a. counts, a "systemic issues" callout (criteria failing on every page where applicable), and full per-page detail. Takes either an exact run-folder path or a site slug (picks the most recent run). For PDF, run the existing `html-to-pdf.js` on the generated `report.html` — no PDF code lives in `checks/`.

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

#### WCAG Checks Suite Features
- One script per WCAG 2.1 A/AA success criterion, incrementally added (26/50 so far — see `checks/` for the current list)
- Deterministic checks where possible: e.g. 1.4.11 computes WCAG contrast ratios directly from computed styles (no AI call needed unless colors are unresolvable — transparency, gradients), 2.4.1 verifies a skip link by actually activating it and checking whether focus really moved
- Optional Claude fallback (`--ai`), always capped by `--limit`, only invoked for genuinely ambiguous cases — never to confirm an already-certain automated result
- Shadow DOM aware (custom form-builder/web-component widgets) and scroll-reveal aware (content that is `visibility:hidden` until scrolled into view)
- 3.3.1 (error identification) tests only via `blur`/`input` events on intentionally invalid values — never submits a form, so it is safe to run against arbitrary live sites
- Multi-page orchestration with a single shared run folder, and an aggregated HTML/PDF report across all pages of a run

## Development Commands

### Setup
```bash
npm install
npx playwright install
```

Requirements: Node.js v18+, Python 3 (only for the CSV/URL utility scripts), Google Chrome installed (optional, for authenticated crawling via Chrome profiles).

### Running the Tools

#### Unified Web Interface (Recommended)
```bash
# Start the unified web server with Express.js
node web-server.js

# Then open in browser: http://localhost:3000
```

The unified web interface provides:
- **Tab-based interface** for both SEO and Accessibility checkers
- User-friendly forms for all parameters (common and tool-specific)
- Real-time output streaming in the browser
- Chrome profile selection dropdown
- Support for all report formats including:
  - SEO reports (HTML, MD, JSON)
  - Accessibility reports (HTML, MD, JSON)
  - Italian Accessibility Declaration (Legge 4/2004)
  - AGID Allegato 2 (WCAG 2.1 AA)
- Automatic report detection and download links
- AI-powered description simplification (with Anthropic API key)
- No command-line knowledge required

This is the **recommended way** to use the toolkit as it provides access to both tools in a single, user-friendly interface.

#### SEO Checker (CLI)
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

#### SEO Checker (Web Interface)
```bash
# Start the web server
node seo-web-server.js

# Then open in browser: http://localhost:3000
```

The web interface provides:
- User-friendly form for all SEO checker parameters
- Real-time output streaming in the browser
- Chrome profile selection dropdown
- Automatic report detection and download links
- No command-line knowledge required

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

#### Lighthouse Checker
```bash
# Basic usage via CLI
npm run lighthouse <url>

# Direct CLI usage with options
node lighthouse-cli.js <url> [options]

# Example usage
node lighthouse-cli.js https://example.com -p 10
node lighthouse-cli.js https://example.com --crawl -f html
node lighthouse-cli.js https://example.com --device desktop
node lighthouse-cli.js https://example.com --categories performance,seo
node lighthouse-cli.js https://example.com --throttling none
```

Note: Lighthouse itself always runs headless (~15-30s per page); `-h/--headless` only affects the Playwright crawling phase used to discover pages. Requires Google Chrome installed.

#### Accessibility from JSON
```bash
# Generate dichiarazione/allegato2 from an existing a11y JSON report, without a browser
node a11y-from-json.js report.json
node a11y-from-json.js report.json --org "ACME SRL" --email info@acme.it
```

#### HTML to PDF Converter
```bash
# Direct CLI usage (no npm script defined for this tool)
node html-to-pdf.js <file.html> [options]

# Example usage
node html-to-pdf.js report.html
node html-to-pdf.js report.html -o output.pdf
node html-to-pdf.js report.html --format A3 --landscape
node html-to-pdf.js report.html --margin 20
node html-to-pdf.js report.html --margin "15,20,15,20"
```

#### Accessibility from CSV
```bash
# Analyze multiple URLs from a CSV file
node a11y-from-csv.js urls.csv

# With custom output and format
node a11y-from-csv.js urls.csv -o myreport -f html

# In headless mode
node a11y-from-csv.js urls.csv --headless

# With Chrome profile for authenticated pages
node a11y-from-csv.js urls.csv --profile ~/Library/Application\ Support/Google/Chrome/Default
```

#### Link Extractor
```bash
# Print links to console
node list-links.js https://example.com

# Save to file in different formats
node list-links.js https://example.com -o links.txt -f txt
node list-links.js https://example.com -o links.json -f json
node list-links.js https://example.com -o links.csv -f csv
node list-links.js https://example.com -o links.md -f md

# With Chrome profile
node list-links.js https://example.com --profile ~/Library/Application\ Support/Google/Chrome/Default
```

#### Python URL Utilities
```bash
# Extract URLs from corrupted CSV
python3 extract_urls.py

# Find duplicate URLs in CSV
python3 find_duplicates.py

# Find duplicate positions
python3 find_duplicate_positions.py

# Remove duplicates from CSV
python3 remove_duplicates.py

# Remove first column from CSV
python3 remove_first_column.py
```

#### WCAG Checks Suite
```bash
# Single page, all available criteria, no AI (heuristics/axe-core only)
node checks/run.js https://example.com

# Single page, only specific criteria, with AI fallback
node checks/run.js https://example.com --criteria 1.1.1,2.4.7 --ai --limit 3

# Multiple pages of the same site in one run (creates one shared output folder)
node checks/run-site.js https://example.com https://example.com/contatti --ai

# Aggregate a run's JSON files into an HTML report (accepts a run-folder path or a site slug — picks the latest run)
node checks/report.js checks/output/example_com_20260101_1200
node checks/report.js example_com

# Convert that report to PDF with the existing tool
node html-to-pdf.js checks/output/example_com_20260101_1200/report.html
```

Options common to `run.js`/`run-site.js`: `--criteria <list>` (default: all scripts found in `checks/`), `--ai` (requires `ANTHROPIC_API_KEY` in `.env` or `--ai-key`), `--limit <n>` (max AI-verified elements per criterion, default 5), `-h/--headless`. `run.js` also supports `-o/--output <file>` and `--no-save` (auto-save to `checks/output/` is the default otherwise); `run-site.js` has no `-o` — output is always the shared run folder, one JSON per page.

### CLI Options (Common to both tools)
- `-p, --pages <number>`: Max pages to check (default: 5)
- `-c, --crawl`: Full site crawling mode (ignores -p)
- `-o, --output <file>`: Report filename (default: auto-generated)
- `-f, --format <type>`: Report format — accepted values differ per tool (see below)
- `-h, --headless`: Run without browser UI
- `--no-profile`: Don't use Chrome profile (uses Chromium instead of Chrome)
- `--select-profile`: Show list of available Chrome profiles for user selection
- `--help`: Show help message

#### SEO Checker Specific Options
- `-f, --format <type>`: `html`, `md`, `json`, or `both` (default: `both`, generates HTML+MD). Note: there is no single value that generates all three formats — use `both` then `json` separately if you need all of them.

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

### Example Scripts (located in tests/)
```bash
# Run basic example
node tests/example.js

# Test single page
node tests/generate-report-only.js

# Full crawl example
node tests/example-full-crawl.js

# Test with Chrome profile
node tests/example-with-profile.js

# Test JSON report generation
node tests/test-json-report.js

# Test URL normalization
node tests/test-url-normalization.js
```

## Code Structure

### Class Hierarchy
- **SEOChecker**: Main class for SEO auditing
- **A11yChecker**: Main class for accessibility testing
- **A11yFromCSV** (extends A11yChecker): Batch processing from CSV files
- **LighthouseChecker**: Main class for Lighthouse-based audits (performance/accessibility/SEO/best-practices)

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
- `generateAllegato2HTML(options)`: Create AGID self-assessment model (Allegato 2) with WCAG 2.1 AA criteria table
- `close()`: Clean up browser resources

### A11yFromCSV Class Methods (extends A11yChecker)
- `parseCSV(csvContent)`: Parse CSV content and extract URLs
- `scanFromCSV(csvPath)`: Process all URLs from CSV file and generate reports

### LighthouseChecker Class Methods
- `init(options)`: Initialize browser/context with optional Chrome profile
- `checkUrl(url, options)`: Run a Lighthouse audit on a single URL
- `crawlSite(baseUrl, maxPages)` / `navigateAndCheck(baseUrl, maxPages)`: Discover pages via Playwright and audit each with Lighthouse
- `generateHTMLReport(filename)`: Create HTML Lighthouse report
- `generateJSONReport(filename)`: Create JSON Lighthouse report
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

## Project Structure

### Directory Organization
- **Root**: CLI tools (`*-cli.js`), main checker classes (`*-checker.js`), utilities, and the Windows user guides (`GUIDA_A11Y_WINDOWS.html`, `GUIDA_SEO_WINDOWS.html`)
- **tests/**: Example and test scripts for development
- **docs/**: Default output folder for generated reports (git-ignored)
- **dichiarazioni/**: Sample declarations/Allegato2 reports generated for a specific past client engagement, not a generic output directory
- **checks/**: WCAG Checks Suite — one script per criterion at the top level, shared code in `checks/lib/`, generated output in `checks/output/` (git-ignored)

### Output Files
Reports are saved into `docs/` with the pattern `YYYYMMDD_HHMM_<domain>_<type>.<ext>` (e.g. `20260525_0942_edysma_net_a11y.html`, `..._seo.json`, `..._lighthouse.html`).

The WCAG Checks Suite saves separately, into `checks/output/<sito>_<YYYYMMDD_HHMM>/<pagina>.json` (one run folder per invocation of `run.js`/`run-site.js`, one JSON per page); `checks/report.js` writes `report.html` into that same run folder.

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

# Test CSV batch processing
node a11y-from-csv.js test_urls.csv --headless

# Test link extraction
node list-links.js https://example.com --visible

# Test the WCAG Checks Suite (single criterion, headless, no AI/no cost)
node checks/run.js https://example.com --headless --no-save --criteria 1.1.1
```

## Important Notes

### Web Interface
The web interface is experimental — some features may be incomplete or subject to change. The toolkit includes two web interfaces:

**Unified Web Interface (Recommended):**
A modern Express-based interface (`web-server.js` + `web-ui.html`) that provides:
- **Tab-based access** to both SEO and Accessibility checkers
- No command-line knowledge required
- Visual forms for all parameters (common and tool-specific)
- Real-time output streaming
- Automatic Chrome profile detection
- One-click report downloads
- Support for all report formats including Italian compliance documents

Start with `node web-server.js` and open `http://localhost:3000` in your browser.

**Legacy SEO Web Interface:**
Original interface for SEO checking only (`seo-web-server.js` + `seo-web-ui.html`).
Start with `node seo-web-server.js`.

### AI-Powered Features
The accessibility checker can use Claude AI (via Anthropic API) to simplify technical violation descriptions for non-technical stakeholders. Set `ANTHROPIC_API_KEY` in `.env` or pass via `--ai-key` parameter.

The WCAG Checks Suite (`checks/`) reads the same `.env`/`ANTHROPIC_API_KEY` (or `--ai-key`) to power its own, separate `--ai` fallback — it is a different feature (per-criterion pass/fail judgment on ambiguous cases, not description simplification) but shares the same key and loading mechanism.

### Italian Compliance Reports
This toolkit generates Italian accessibility compliance documents:
- **Dichiarazione**: Legge 9 gennaio 2004, n. 4 accessibility declaration
- **Allegato 2**: AGID self-assessment model with WCAG 2.1 AA criteria mapping

These reports are specifically designed for Italian public administration websites and map violations to UNI CEI EN 301549 requirements.