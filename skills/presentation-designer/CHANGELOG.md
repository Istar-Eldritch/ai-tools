# Changelog

All notable changes to the Presentation Designer skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-03

### Added
- Initial release of Presentation Designer skill
- Interactive design process with 8 stages:
  - Metadata and Context
  - Purpose and Goals
  - Audience Analysis
  - Key Messages
  - Structure and Flow
  - Visual Style
  - Content Guidelines
  - Technical Notes
- Command-line interface with options:
  - `--type` - Presentation type
  - `--duration` - Duration in minutes
  - `--audience` - Audience description
  - `--title` - Presentation title
  - `--output` - Output file path
  - `--format` - Output format (yaml/json/markdown)
- Output formats:
  - YAML (default, best for AI consumption)
  - JSON (programmatic use)
  - Markdown (human-readable)
- Example design documents:
  - `conference-talk.yaml` - 20-minute tech conference presentation
  - `workshop.yaml` - 2-hour hands-on workshop
  - `pitch.yaml` - 10-minute investor pitch
- Documentation:
  - `SKILL.md` - Main skill documentation for pi
  - `README.md` - Developer quick reference
  - `USAGE_GUIDE.md` - Detailed AI integration guide
  - `SUMMARY.md` - Project overview
- Helper scripts:
  - `quick-start.sh` - Interactive menu for common tasks
- Design validation:
  - Slide count checks
  - Timing validation
  - Required field validation
- Color-coded terminal output for better UX
- Graceful Ctrl+C handling
- Help and examples commands

### Technical Details
- Built with Node.js (ES modules)
- Dependencies: yaml@2.3.4
- Follows Agent Skills specification
- Compatible with pi coding agent
- MIT licensed

## [2.0.0] - 2026-02-03

### Added - Version 2 (Smart Designer)
- **Intelligent context discovery** - Understands presentation type and tailors all suggestions
- **Smart suggestions** - Context-aware recommendations for every input
- **Template-based structure generation** - Auto-generates complete presentation structures
- **Iterative refinement** - Review and modify any part of the design without starting over
- **Multi-choice selection** - Select multiple options where appropriate
- **Load existing designs** - `--input` flag to iterate on previous designs
- **Knowledge base integration** - Built-in best practices for:
  - 6 presentation types with specific guidance
  - 7 audience profiles with expectations
  - 6 visual style categories
  - 7 color scheme presets
  - 20+ section templates
- **Contextual tips** - Tips, suggestions, and information throughout
- **Smart time allocation** - Intelligent distribution of slides and duration
- **Visual style presets** - Pre-configured color schemes and style combinations
- **Purpose suggestions** - Auto-generated goals based on context
- **Audience templates** - Predefined audience expectations
- **Enhanced content guidelines** - Smarter do's and don'ts generation

### Changed
- Both V1 and V2 designers now available
- V2 is recommended for new users
- Quick-start script updated with V2 options
- Documentation expanded with V2 features

### Technical
- `designer-v2.js` - Complete smart designer implementation
- Extensive knowledge base (500+ lines)
- Context-aware suggestion engine
- Iterative refinement workflow
- Multi-choice input handling

## [Unreleased]

### Planned Features
- More example designs (academic, training)
- Export to additional formats (PowerPoint specs, reveal.js)
- Visual preview of design structure
- Slide-by-slide content editing mode
- Auto-timing calculator based on content
- Accessibility validation
- Multi-language support
- Integration with presentation generation tools
- Web-based UI option
- Collaborative design features

### Future Enhancements
- AI-powered design suggestions
- Content library integration
- Image and asset management
- Real-time collaboration
- Design templates marketplace
- Analytics and metrics tracking
- Version diffing for design documents
- Export to presentation builders (Canva, etc.)

---

[1.0.0]: https://github.com/yourrepo/presentation-designer/releases/tag/v1.0.0
