# Getting Started with Presentation Designer

Welcome! This guide will get you up and running with the Presentation Designer in 5 minutes.

## What is This?

Presentation Designer is a tool that helps you **design** presentations before you **build** them. It asks you systematic questions about your presentation's purpose, audience, structure, and style, then creates a detailed design document that AI agents can use to generate actual slides.

Think of it like an architect creating blueprints before construction begins.

## Why Should I Use It?

### Before: The Old Way
```
You → "AI, make me a presentation about microservices"
AI → [generates generic slides]
You → "No, I meant... [tries to explain]"
AI → [regenerates, still not quite right]
You → [repeat 5 more times, frustrated]
```

### After: The New Way
```
You → [run designer, answer questions thoughtfully]
Designer → [creates detailed design.yaml]
You → "AI, build this: design.yaml"
AI → [generates exactly what you specified]
You → "Perfect!" ✨
```

## Quick Start (30 seconds)

```bash
# Navigate to the skill directory
cd /home/rpaz/code/ai_tools/skills/presentation-designer

# Run the quick-start helper
./quick-start.sh

# Choose option 1 and follow the prompts
# Or choose options 2-4 for quick templates
```

## Longer Start (5 minutes)

### Step 1: Run the Designer

```bash
node designer.js
```

You'll see:
```
🎨 Presentation Designer
Let's design your presentation step by step

============================================================
  📋 Metadata and Context
============================================================

Presentation title: [My Presentation]
```

### Step 2: Answer the Questions

The designer will guide you through 8 stages:

1. **📋 Metadata** - Basic info (title, duration, type)
2. **🎯 Purpose** - What you want to achieve
3. **👥 Audience** - Who you're presenting to
4. **💡 Key Messages** - Main points to convey
5. **📐 Structure** - How to organize the content
6. **🎨 Visual Style** - How it should look
7. **📝 Content Guidelines** - Tone and approach
8. **🔧 Technical Notes** - Requirements and backups

Just answer honestly - the tool will guide you.

### Step 3: Review Your Design

At the end, you'll see a summary:
```
👁️ Review

Your Presentation Design:

Title: Building Resilient Microservices
Type: conference
Duration: 20 minutes
Slides: 15
Sections: 4
Key Messages: 3

Sections:
  1. Introduction (2 slides, 2 min)
  2. The Problem (3 slides, 4 min)
  3. Key Patterns (7 slides, 11 min)
  4. Conclusion (1 slides, 1 min)
```

### Step 4: Get Your Design File

The tool creates `presentation-design.yaml`:
```
💾 Saving Design

✓ Design saved to: presentation-design.yaml

Next steps:
  1. Review and refine the design document
  2. Share with stakeholders for feedback
  3. Use with an AI agent to generate your Typst presentation

Example: pi "Using presentation-design.yaml, generate a Typst presentation"
```

## Using with AI Agents

Now that you have your design, use it with pi (or any AI assistant):

```bash
pi "Create a Typst presentation using Polylux based on presentation-design.yaml. Follow the structure and style exactly as specified."
```

The AI will:
- Read your complete design document
- Generate slides matching your structure
- Apply your visual style
- Follow your content guidelines
- Create exactly what you designed

## Command-Line Options

Speed things up with options:

```bash
# Skip some questions
node designer.js --type conference --duration 20 --title "My Talk"

# Choose output format
node designer.js --format json --output design.json

# Get markdown for easy reading
node designer.js --format markdown --output design.md
```

## Examples to Learn From

Check out complete examples:

```bash
# View examples
ls examples/

# Read a conference talk design
cat examples/conference-talk.yaml

# Use an example as a template
cp examples/workshop.yaml my-workshop.yaml
# Edit my-workshop.yaml with your content
```

## The Design Document Explained

Here's what each section does:

### Metadata
Basic facts about your presentation
```yaml
metadata:
  title: "My Amazing Talk"
  duration: 20
  type: conference
```

### Purpose
Why this presentation exists
```yaml
purpose:
  primary_goal: "Teach developers about X"
  objectives:
    - "Explain concept Y"
    - "Show example Z"
```

### Audience
Who's watching and what they need
```yaml
audience:
  profile: "Backend developers"
  knowledge_level: "Intermediate"
  expectations:
    - "Practical examples"
    - "Code samples"
```

### Key Messages
The 3-5 things you want people to remember
```yaml
key_messages:
  - "Message 1"
  - "Message 2"
  - "Message 3"
```

### Structure
Section-by-section breakdown
```yaml
structure:
  sections:
    - name: "Introduction"
      slides: 3
      duration: 5
      content:
        - "Title slide"
        - "Problem statement"
```

### Visual Style
How it should look
```yaml
visual_style:
  theme: "modern"
  color_scheme:
    primary: "#2563EB"
  typography:
    heading_font: "Roboto"
```

### Content Guidelines
How to write the content
```yaml
content_guidelines:
  tone: "professional but friendly"
  dos:
    - "Use concrete examples"
  donts:
    - "Avoid jargon"
```

### Technical Notes
Special requirements
```yaml
technical_notes:
  tools_needed:
    - "Live demo environment"
  backup_plans:
    - "Pre-recorded video"
```

## Common Workflows

### Creating a Conference Talk
```bash
./quick-start.sh
# Choose option 2 (Quick conference talk)
# Enter title and filename
# Get instant 20-minute talk template
```

### Creating a Workshop
```bash
node designer.js --type workshop --duration 120
# Answer questions about hands-on content
# Get comprehensive workshop design
```

### Iterative Design
```bash
# Create initial design
node designer.js --output v1.yaml

# Review and manually edit
vim v1.yaml

# Use with AI
pi "Generate presentation from v1.yaml"

# Get feedback, update design
vim v2.yaml

# Regenerate
pi "Update presentation using v2.yaml"
```

## Tips for Great Designs

### Be Specific
❌ "Talk about the solution"
✅ "Show architecture diagram with 3 microservices, explain communication pattern with sequence diagram"

### Think About Timing
- Budget 2-3 minutes per slide
- Leave time for questions
- Account for demos and interactions

### Know Your Audience
- Adjust technical depth appropriately
- Choose relevant examples
- Consider their background

### Plan the Story
- Clear beginning, middle, end
- Logical flow between sections
- Build to your key messages

## Troubleshooting

### "Module not found"
```bash
cd /home/rpaz/code/ai_tools/skills/presentation-designer
npm install
```

### "Permission denied"
```bash
chmod +x designer.js
chmod +x quick-start.sh
```

### "AI doesn't follow my design"
- Make your design more specific
- Reference the design explicitly in your prompt
- Generate section by section
- Provide examples

## Next Steps

1. **Try it now**: Run `./quick-start.sh`
2. **Read examples**: Check `examples/` directory
3. **Create your first design**: Answer the questions
4. **Generate slides**: Use with pi or another AI
5. **Iterate and improve**: Refine your design

## Getting Help

- **Full Documentation**: See `SKILL.md`
- **AI Integration Guide**: See `USAGE_GUIDE.md`
- **Project Overview**: See `SUMMARY.md`
- **Quick Reference**: See `README.md`

## Have Fun! 🎉

Designing presentations should be thoughtful, not tedious. This tool handles the structure so you can focus on your message.

Happy presenting! 🎤✨
