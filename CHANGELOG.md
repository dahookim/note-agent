# Changelog

All notable changes to OSBA (Obsidian Second Brain Agent) will be documented in this file.

## [0.2.0] - 2025-01-24

### Added
- **xAI Grok 4 Fast Support**: Added xAI Grok API integration for Quick Draft and Analysis models
- **Gemini 2.5 Flash Support**: Added Google's latest Gemini 2.5 Flash model option
- **Frontmatter Manager**: Complete YAML frontmatter management for OSBA analysis results
  - Automatic frontmatter updates with analysis metadata
  - Connected Insights section generation
  - Embedding ID tracking
- **Enhanced Provider Detection**: Dynamic provider detection for accurate usage logging

### Fixed
- **Provider Logging**: Fixed hardcoded provider issue in generateQuickDraft - now correctly identifies xAI, Claude, OpenAI, and Gemini models
- **Database Schema**: Added 'xai' provider support to CHECK constraint
- **Model Selection**: All model dropdowns now include xAI Grok option

### Changed
- Improved settings UI organization with xAI API key section
- Enhanced error handling across all AI provider integrations

## [0.1.1] - 2025-01-23

### Fixed
- **BRAT Installation Error**: Replaced better-sqlite3 with sql.js (WebAssembly) for cross-platform compatibility
- Fixed native module loading issues that prevented installation via BRAT

## [0.1.0] - 2025-01-22

### Added
- Initial release
- Multi-provider AI support (Gemini, Claude, OpenAI)
- Vector embeddings for semantic note search
- Note connection analysis with LLM
- Knowledge gap discovery
- Cost tracking and budget management
- Quick Draft generation with RAG context
- Status bar with real-time statistics
