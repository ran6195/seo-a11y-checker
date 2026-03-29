# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web analysis toolkit built with Playwright that automates SEO audits and accessibility testing of websites. The project includes:

1. **SEO Checker**: Audits SEO elements like meta tags, heading structure, page size, favicon, and legal sections
2. **Accessibility Checker**: Tests web accessibility using axe-core and custom checks following WCAG guidelines
3. **SEO Web Interface**: Browser-based GUI for running SEO checks without using the command line
4. **HTML to PDF Converter**: Standalone utility to convert HTML reports to PDF format
5. **URL Utilities**: Python scripts for CSV processing and URL extraction
6. **Link Extractor**: Tool to extract and analyze all links from a webpage

Both the SEO and accessibility checkers can crawl websites, analyze multiple pages, and generate detailed reports in HTML, Markdown, and JSON formats.

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
- **axe-core integration**: Uses axe-core library for comprehensive WCAG compliance testing

#### Web Interface
- **Unified Web Server** (`web-server.js`): Express-based server providing a unified browser GUI for both SEO and Accessibility checking
- **Unified Web UI** (`web-ui.html`): Interactive HTML interface with tabs, real-time output streaming, and report downloads
- **Legacy SEO Web Server** (`seo-web-server.js`): Original HTTP server for SEO checking only
- **Legacy SEO Web UI** (`seo-web-ui.html`): Original HTML interface for SEO checking

#### Supporting Utilities
- **Link extractor** (`list-links.js`): Extracts all links from a webpage with categorization (internal/external/email/tel)
- **URL utilities** (Python scripts): CSV processing, duplicate detection, and URL extraction tools

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
- **Root**: CLI tools (`*-cli.js`), main checker classes (`*-checker.js`), and utilities
- **tests/**: Example and test scripts for development
- **reports/**: Generated reports (HTML, MD, JSON)
- **documenti/**: Documentation and archived reports
- **dichiarazioni/**: Italian accessibility declarations and AGID reports (HTML/PDF)
- **gruppo_zatti/**: Project-specific reports for a particular client

### Output Files
- Reports are auto-named with timestamp: `a11y-report-YYYY-MM-DD-HH-MM-SS.{html,md,json}`
- Italian declarations: `{domain}_YYYY-MM-DD-HH-MM-SS_dichiarazione.html`
- AGID Allegato 2: `{domain}_YYYY-MM-DD-HH-MM-SS_allegato2.html`

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
```

## Important Notes

### Web Interface
The toolkit includes two web interfaces:

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

### Italian Compliance Reports
This toolkit generates Italian accessibility compliance documents:
- **Dichiarazione**: Legge 9 gennaio 2004, n. 4 accessibility declaration
- **Allegato 2**: AGID self-assessment model with WCAG 2.1 AA criteria mapping

These reports are specifically designed for Italian public administration websites and map violations to UNI CEI EN 301549 requirements.