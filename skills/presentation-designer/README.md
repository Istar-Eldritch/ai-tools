# Presentation Designer Skill

An interactive tool for systematically designing presentations before writing them. This skill helps you think through your presentation's purpose, audience, structure, and style, then outputs a comprehensive design document that AI agents can use to generate Typst presentations.

## Why Use This?

- **Structured Thinking**: Forces you to think through key aspects before diving into slide creation
- **Better Results**: AI agents produce better presentations when given comprehensive design specifications
- **Faster Iteration**: Easier to refine the design document than to regenerate slides repeatedly
- **Reusable**: Design documents serve as templates for similar presentations
- **Collaborative**: Share designs for feedback before committing to slide creation

## Quick Start

### Smart Designer (Recommended - V2)

```bash
# Run with intelligent suggestions
node skills/presentation-designer/designer-v2.js

# Quick start with type
node designer-v2.js --type workshop --duration 120

# Iterate on existing design
node designer-v2.js --input my-design.yaml
```

### Simple Designer (V1)

```bash
# Run straightforward Q&A
node skills/presentation-designer/designer.js

# With options
node designer.js --type conference --duration 20 --output my-talk.yaml
```

## What It Does

### Version 2 (Smart Designer)
- 🧠 **Intelligent suggestions** based on presentation type
- 🔄 **Iterative refinement** - adjust any part anytime
- 📋 **Smart templates** - auto-generate structure
- 💡 **Context-aware** - recommendations tailored to your needs
- 📂 **Load existing** - iterate on previous designs

### Version 1 (Simple Designer)
- Direct question-and-answer flow
- No suggestions, full control
- Straightforward input

Both guide you through:
1. **Metadata** - Title, duration, type, date
2. **Purpose** - Goals, objectives, success criteria
3. **Audience** - Who they are, what they need
4. **Key Messages** - Core points to convey
5. **Structure** - Section-by-section breakdown
6. **Visual Style** - Colors, fonts, theme
7. **Content Guidelines** - Tone, dos and don'ts
8. **Technical Notes** - Tools, requirements, backup plans

## Output Formats

- **YAML** (default) - Best for AI agent consumption
- **JSON** - Programmatic use
- **Markdown** - Human-readable review

## Example Workflow

```bash
# Design your presentation
node designer.js --output rust-workshop.yaml

# Review and refine the YAML file
vim rust-workshop.yaml

# Generate the presentation with pi
pi "Using rust-workshop.yaml, create a Typst presentation with Polylux"

# The AI agent will use your design to generate structured slides
```

## Examples

Check the `examples/` directory for:
- `conference-talk.yaml` - 20-minute tech talk
- `workshop.yaml` - 2-hour hands-on workshop
- `pitch.yaml` - Coming soon
- `academic.yaml` - Coming soon

## Tips

### Structure
- Budget 2-3 minutes per slide for most content
- Use the Rule of Three (3 sections, 3 key points)
- Plan transitions between sections

### Content
- One main idea per slide
- Visual > Text whenever possible
- Tell a story with your structure

### Audience
- Know your audience's level and adjust complexity
- Consider their expectations and needs
- Plan for different learning styles

## Integration with Typst

The design document maps directly to Typst/Polylux features:

- **Sections** → `#section()` or title slides
- **Visual Style** → Theme configuration
- **Code Examples** → `#raw()` blocks with syntax highlighting
- **Structure** → Slide count and organization

## Requirements

- Node.js 16+
- npm packages (auto-installed): yaml

## Development

```bash
# Install dependencies
cd skills/presentation-designer
npm install

# Make executable
chmod +x designer.js

# Run
node designer.js
```

## License

MIT
