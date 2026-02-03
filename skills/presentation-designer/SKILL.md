---
name: presentation-designer
description: Interactive presentation design assistant that guides you through planning a presentation by asking questions about intent, audience, structure, style, and content. Outputs a structured design document that can be used by AI agents to generate Typst presentations. Use when the user wants to design or plan a presentation before creating slides.
---

# Presentation Designer

An interactive tool to help you design presentations systematically before writing them. This skill guides you through a structured design process and outputs a comprehensive design document that can be used by AI agents to generate Typst presentations.

## Overview

The presentation design process consists of these stages:

1. **Intent & Context** - What are you trying to achieve?
2. **Audience Analysis** - Who will be watching?
3. **Structure & Flow** - How will you organize the content?
4. **Visual Style** - What should it look like?
5. **Content Planning** - What goes on each slide?

## Usage

There are two versions of the designer:

### Version 2 (Recommended) - Smart & Iterative

```bash
node /home/rpaz/code/ai_tools/skills/presentation-designer/designer-v2.js
```

**Features:**
- 🧠 **Intelligent suggestions** based on presentation type and context
- 🔄 **Iterative refinement** - review and adjust any part of your design
- 📋 **Smart templates** with auto-generated structure
- 💡 **Contextual recommendations** for content, style, and structure
- 🎯 **Guided workflow** with tips and examples
- 📂 **Load existing designs** to iterate and improve

### Version 1 - Direct & Straightforward

```bash
node /home/rpaz/code/ai_tools/skills/presentation-designer/designer.js
```

**Features:**
- Simple question-and-answer flow
- Direct input without suggestions
- Good for when you know exactly what you want

Both versions create the same output format and can be used interchangeably.

### Quick Start with Options

You can also provide information upfront to skip some questions:

```bash
# Specify presentation type
node designer.js --type conference

# Specify duration
node designer.js --duration 20

# Specify audience
node designer.js --audience "Software engineers"

# Combine multiple options
node designer.js --type workshop --duration 60 --audience "Beginners"
```

### Available Options

- `--type <type>` - Presentation type: conference, workshop, pitch, academic, internal, training, sales
- `--duration <minutes>` - Presentation duration in minutes
- `--audience <description>` - Target audience description
- `--title <title>` - Presentation title
- `--output <file>` - Output file path (default: presentation-design.yaml)
- `--format <format>` - Output format: yaml, json, markdown (default: yaml)

## Output

The tool generates a structured design document containing:

- **Metadata**: Title, author, date, duration, type
- **Purpose & Goals**: What you want to achieve
- **Audience Profile**: Who they are and what they need
- **Key Messages**: Core points to convey
- **Structure**: Slide-by-slide breakdown
- **Visual Style**: Colors, fonts, layout preferences
- **Content Guidelines**: Tone, language, complexity level
- **Technical Notes**: Special requirements or considerations

### Example Output (YAML)

```yaml
presentation:
  metadata:
    title: "Introduction to Rust Programming"
    author: "Jane Developer"
    date: "2026-02-15"
    duration: 45
    type: workshop
    version: "1.0"
  
  purpose:
    primary_goal: "Teach basic Rust concepts to beginners"
    objectives:
      - "Introduce Rust syntax and ownership model"
      - "Demonstrate practical examples"
      - "Provide hands-on exercises"
    success_criteria:
      - "Attendees can write simple Rust programs"
      - "Understand basic ownership rules"
  
  audience:
    profile: "Software developers with experience in other languages"
    size: "20-30 people"
    knowledge_level: "Beginner in Rust, intermediate in programming"
    expectations:
      - "Practical, hands-on learning"
      - "Real-world examples"
      - "Q&A opportunities"
  
  key_messages:
    - "Rust provides memory safety without garbage collection"
    - "Ownership model is the key concept"
    - "Practical applications in systems programming"
  
  structure:
    total_slides: 20
    sections:
      - name: "Introduction"
        slides: 3
        duration: 5
        content:
          - "Title slide"
          - "About the speaker"
          - "What we'll cover"
      
      - name: "Why Rust?"
        slides: 4
        duration: 10
        content:
          - "Problems Rust solves"
          - "Key features"
          - "Use cases"
          - "Who uses Rust"
      
      - name: "Core Concepts"
        slides: 8
        duration: 20
        content:
          - "Variables and mutability"
          - "Ownership basics"
          - "Borrowing and references"
          - "Example: string handling"
          - "The borrow checker"
          - "Common patterns"
          - "Error handling"
          - "Practice exercise"
      
      - name: "Practical Example"
        slides: 3
        duration: 8
        content:
          - "Building a small CLI tool"
          - "Code walkthrough"
          - "Running the example"
      
      - name: "Conclusion"
        slides: 2
        duration: 2
        content:
          - "Key takeaways"
          - "Resources and next steps"
  
  visual_style:
    theme: "Modern and clean"
    color_scheme:
      primary: "#CE412B"
      secondary: "#5C2C91"
      accent: "#149ECA"
      background: "#FFFFFF"
      text: "#1A1A1A"
    
    typography:
      heading_font: "Montserrat"
      body_font: "Open Sans"
      code_font: "Fira Code"
    
    layout_preferences:
      - "Generous white space"
      - "Left-aligned text"
      - "Code examples with syntax highlighting"
      - "Minimal bullet points per slide"
    
    visual_elements:
      - "Code snippets"
      - "Simple diagrams for ownership concepts"
      - "Icons for key features"
      - "Screenshots of compiler errors"
  
  content_guidelines:
    tone: "Friendly and approachable"
    language_level: "Clear and accessible, avoid jargon"
    complexity: "Start simple, gradually increase"
    
    dos:
      - "Use concrete examples"
      - "Show real code"
      - "Relate to familiar concepts"
      - "Include practice opportunities"
    
    donts:
      - "Don't overwhelm with theory"
      - "Avoid advanced topics"
      - "Don't assume Rust knowledge"
  
  technical_notes:
    tools_needed:
      - "Code editor with live demos"
      - "Terminal for running examples"
    
    special_requirements:
      - "Interactive coding environment"
      - "Rust playground links for exercises"
    
    backup_plans:
      - "Pre-recorded demos if live coding fails"
      - "Printed code examples"
```

## Using the Design Document

Once you have your design document, you can use it to:

1. **Generate a Typst presentation** - Provide the design document to an AI agent along with instructions to create slides
2. **Get feedback** - Share the design with colleagues for review before creating slides
3. **Iterate on the design** - Refine the structure and content without touching slide code
4. **Maintain consistency** - Use as a reference while developing the presentation

### Example: Generating Slides with the Design

```bash
# After running the designer
node designer.js --output my-talk-design.yaml

# Use with an AI agent (in pi)
pi "Using the design document in my-talk-design.yaml, generate a Typst presentation"
```

## Design Tips

### Structure

- **Rule of Three**: Group content in threes (3 key points, 3 sections, etc.)
- **Logical Flow**: Each slide should lead naturally to the next
- **Time Budget**: Allocate ~2-3 minutes per slide for most presentations
- **Transitions**: Plan how you'll transition between sections

### Content

- **One Idea per Slide**: Don't overcrowd slides
- **Visual Over Text**: Use images, diagrams, and examples over bullet points
- **Tell a Story**: Even technical presentations should have a narrative arc
- **Engage the Audience**: Plan interactive elements, questions, or exercises

### Visual Design

- **Consistency**: Use the same fonts, colors, and layout throughout
- **Contrast**: Ensure text is readable against backgrounds
- **Hierarchy**: Use size and weight to show importance
- **White Space**: Don't fill every pixel - let the content breathe

### Audience Considerations

- **Know Your Audience**: Adjust complexity and examples to their level
- **Anticipate Questions**: Think about what they'll want to know
- **Cultural Sensitivity**: Consider cultural context and references
- **Accessibility**: Ensure slides are readable (font size, color contrast)

## Advanced Usage

### Resume from Previous Design

If you have an existing design file, you can update it:

```bash
node designer.js --input existing-design.yaml --output updated-design.yaml
```

### Generate Multiple Formats

```bash
# Generate YAML (default)
node designer.js --format yaml --output design.yaml

# Generate JSON for programmatic use
node designer.js --format json --output design.json

# Generate Markdown for easy reading
node designer.js --format markdown --output design.md
```

### Template Mode

Start from a template for common presentation types:

```bash
# List available templates
node designer.js --list-templates

# Use a template
node designer.js --template conference-talk
```

## Integration with Typst

The design document includes all the information needed to generate a Typst presentation:

- Slide count and structure guide the document organization
- Visual style maps to Typst theme variables
- Content specifications inform slide layouts
- Technical notes guide package selection

Example prompt for generating Typst from the design:

```
Using the design document in presentation-design.yaml, create a Typst presentation that:
1. Implements the visual style (colors, fonts, layout)
2. Creates slides for each section with the specified content
3. Uses appropriate Typst packages for code highlighting
4. Includes speaker notes based on the content guidelines
```

## Troubleshooting

### Missing Dependencies

If you get a "module not found" error, install dependencies:

```bash
cd /home/rpaz/code/ai_tools/skills/presentation-designer
npm install
```

### Validation Errors

The tool validates your input. Common issues:

- **Duration too short**: Ensure you have enough time for your content
- **Too many slides**: More than 60 slides usually indicates over-complexity
- **Missing required fields**: Some fields are required for a complete design

### Getting Help

View detailed help:

```bash
node designer.js --help
```

View examples:

```bash
node designer.js --examples
```

## Examples

See the `examples/` directory for sample design documents:

- `examples/conference-talk.yaml` - 20-minute conference presentation
- `examples/workshop.yaml` - 2-hour hands-on workshop
- `examples/pitch.yaml` - 10-minute investor pitch
- `examples/academic.yaml` - 45-minute academic lecture
- `examples/training.yaml` - Half-day training session

## Related Tools

- **Typst** - The presentation format we target
- **Polylux** - Typst presentation package
- **Touying** - Alternative Typst presentation framework

## Feedback and Contributions

This skill is designed to help you think through your presentation systematically. If you have suggestions for improving the design process or additional questions to ask, please contribute!
