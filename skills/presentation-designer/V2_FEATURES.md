# Designer V2 - Smart & Iterative Features

Version 2 of the Presentation Designer adds intelligent suggestions and iterative refinement capabilities. Here's what's new:

## 🆕 Key New Features

### 1. Intelligent Context Discovery

Instead of asking for information in isolation, V2 understands context and tailors all subsequent suggestions.

**Example:**
```
Type: workshop
Topic: "Building REST APIs"
Expertise: beginner

→ V2 automatically suggests:
  - 2-hour duration (typical for workshops)
  - Hands-on structure with exercises
  - Beginner-friendly language
  - Practice-focused content
```

### 2. Smart Suggestions Everywhere

Every question comes with intelligent defaults based on:
- Presentation type (conference, workshop, pitch, etc.)
- Audience expertise level
- Previous answers
- Best practices from knowledge base

**Examples:**

**Purpose Suggestions:**
```
For a conference talk about "microservices":
  ✓ Share practical insights about microservices
  ✓ Demonstrate real-world implementation
  ✓ Provide actionable takeaways
```

**Audience Expectations:**
```
Detected audience: developers
  ✓ Practical code examples
  ✓ Best practices
  ✓ Real-world use cases
```

### 3. Template-Based Structure Generation

V2 can auto-generate complete presentation structures:

```
Conference talk template:
  1. Introduction (2 slides, 2 min)
     • Title slide
     • Why this matters
  
  2. The Problem (3 slides, 4 min)
     • Current challenges
     • Real-world example
     • Cost of inaction
  
  3. Key Patterns (7 slides, 11 min)
     • [Auto-generated based on topic]
  
  4. Conclusion (1 slide, 1 min)
     • Key takeaways
```

### 4. Iterative Refinement

After initial design, you can:
- Review the complete design
- Change any section without starting over
- Refine structure section-by-section
- Update key messages
- Adjust visual style
- Modify audience profile

**Refinement Menu:**
```
What would you like to change?
  1. Adjust structure (sections, slides, timing)
  2. Update key messages
  3. Change visual style
  4. Modify audience profile
  5. Refine content guidelines
  6. Start over from scratch
  7. Continue with current design
```

### 5. Multi-Choice Selection

Select multiple options where appropriate:

```
Select visual style elements:
  1. code-heavy
  2. data-driven
  3. minimalist
  
Your choices: 1 3

→ Design includes:
  • Large code blocks with syntax highlighting
  • Lots of whitespace
  • One idea per slide
```

### 6. Load and Edit Existing Designs

```bash
# Create initial design
node designer-v2.js --output draft-v1.yaml

# Later, load and refine it
node designer-v2.js --input draft-v1.yaml --output draft-v2.yaml
```

### 7. Contextual Tips and Recommendations

Throughout the process, V2 provides:
- 💡 Tips based on best practices
- ✨ Suggestions tailored to your context
- ℹ️ Information about what works well

```
💡 Tip: For workshops, include frequent breaks and hands-on exercises

✨ Suggestion: I'll tailor suggestions for a beginner workshop 
   about Building REST APIs

ℹ️  For 120 minutes, I suggest ~48 slides
```

### 8. Knowledge Base Integration

V2 includes built-in knowledge about:

**Presentation Types:**
- Typical durations
- Common structures
- Appropriate tones
- Best practices

**Audience Profiles:**
- What developers expect
- What executives value
- What students need
- What designers focus on

**Visual Styles:**
- Code-heavy presentations
- Data-driven slides
- Minimalist designs
- Corporate formats

**Color Schemes:**
- Modern, dark, warm, cool themes
- Professional, vibrant, minimal palettes
- Pre-configured color combinations

## 🔄 Workflow Comparison

### V1: Linear Flow

```
Question 1 → Answer
Question 2 → Answer
Question 3 → Answer
...
Question N → Answer
→ Done
```

**Pros:** Simple, straightforward
**Cons:** No suggestions, can't go back

### V2: Iterative Flow

```
Context Discovery → Smart Suggestions
↓
Each Section → Intelligent Defaults
↓
Review → Refine Any Part
↓
Final Design
```

**Pros:** Guided, flexible, smart
**Cons:** Slightly longer initial setup

## 📊 Feature Comparison Table

| Feature | V1 | V2 |
|---------|----|----|
| Basic Q&A | ✅ | ✅ |
| Smart suggestions | ❌ | ✅ |
| Context awareness | ❌ | ✅ |
| Template generation | ❌ | ✅ |
| Iterative refinement | ❌ | ✅ |
| Load existing designs | ❌ | ✅ |
| Knowledge base | ❌ | ✅ |
| Multi-choice selection | ❌ | ✅ |
| Contextual tips | ❌ | ✅ |
| Auto-structure generation | ❌ | ✅ |
| Visual style presets | ❌ | ✅ |
| Color scheme library | ❌ | ✅ |
| Purpose suggestions | ❌ | ✅ |
| Audience templates | ❌ | ✅ |
| Content do's/don'ts | ✅ | ✅ (smarter) |

## 🎯 When to Use Which Version

### Use V1 When:
- ✅ You know exactly what you want
- ✅ You prefer minimal guidance
- ✅ You want fastest possible input
- ✅ You're familiar with presentation design

### Use V2 When:
- ✅ You want intelligent suggestions
- ✅ You're not sure about structure
- ✅ You want to iterate on the design
- ✅ You need best practice guidance
- ✅ You're designing a complex presentation
- ✅ You want to refine an existing design

## 💡 Pro Tips for V2

### 1. Start Broad, Refine Later
Let V2 generate a complete structure first, then refine specific sections.

### 2. Use the Load Feature
```bash
# Day 1: Initial design
node designer-v2.js --output draft.yaml

# Day 2: After thinking it over
node designer-v2.js --input draft.yaml --output final.yaml
```

### 3. Select Multiple Style Elements
Don't limit yourself to one visual style - combine them:
```
code-heavy + minimalist = 
  Large, clean code examples with lots of whitespace
```

### 4. Let Suggestions Guide You
If you're unsure, use the suggested options - they're based on best practices.

### 5. Review and Iterate
Always review the complete design before finalizing. V2 makes it easy to adjust.

## 🚀 Example Session

```bash
$ node designer-v2.js

🎨 Smart Presentation Designer
Let me help you design your presentation with smart suggestions

============================================================
  🎯 Quick Discovery
  Help me understand what you're creating
============================================================

What type of presentation?
  1. conference - Technical talk at a conference
  2. workshop - Hands-on learning session
  3. pitch - Investor or sales pitch
  
Your choice: 2

Great! Hands-on learning session
💡 Tip: Include frequent breaks, hands-on exercises, and checkpoints

Quick: What's the main topic or working title? 
Building Microservices

Audience expertise level?
  1. beginner - New to this topic, need basics
  2. intermediate - Some familiarity, need practical knowledge
  3. advanced - Deep expertise, need specialized content
  
Your choice: 2

✨ Suggestion: I'll tailor suggestions for an intermediate workshop 
   about Building Microservices

============================================================
  📋 Presentation Details
============================================================

Typical durations for workshop:
  1. 60 minutes
  2. 90 minutes
  3. 120 minutes
  4. 180 minutes

Duration in minutes [60]: 120

... [continues with smart suggestions throughout]

============================================================
  👁️  Review & Iterate
============================================================

Your Presentation Design:

Title: Building Microservices with Node.js
Type: workshop
Duration: 120 minutes
Slides: 48
Sections: 7
Key Messages: 4

Structure:
  1. Welcome and Setup (5 slides, 15 min)
     • Welcome and introductions
     • Prerequisites check
  2. Basics (8 slides, 20 min)
     • Core concepts
     • Simple examples
  ... [etc]

Happy with this design? (Y/n): n

What would you like to change?
  1. Adjust structure (sections, slides, timing)
  2. Update key messages
  ... [refine options]

Your choice: 1

[Refines structure interactively]

... [continues until satisfied]

💾 Saving Design

✓ Design saved to: presentation-design.yaml

Next steps:
  1. Review and refine the design file
  2. Share with stakeholders for feedback
  3. Use with an AI agent to generate your presentation

Example AI prompt:
  pi "Create a Typst presentation using Polylux based on 
      presentation-design.yaml. Follow the structure, apply 
      the visual style, and match the tone exactly."

To iterate on this design later:
  node designer-v2.js --input presentation-design.yaml
```

## 🎨 Advanced Features

### Context-Aware Defaults

V2 remembers your choices and adjusts subsequent suggestions:

```
You chose: beginner expertise
→ Language level defaults to "Simple and clear"
→ Content DO's include "Define technical terms"
→ Content DON'Ts include "Don't assume prior knowledge"
```

### Smart Time Allocation

V2 distributes time intelligently based on section importance:

```
Workshop structure:
  Introduction: 10% of time
  Main content: 70% of time
  Conclusion: 8% of time
  Buffer: 12% of time
```

### Visual Style Combinations

Mix and match style elements for unique presentations:

```
Selected: code-heavy + data-driven
→ Combines:
  • Large code blocks
  • Syntax highlighting
  • Charts showing metrics
  • Performance comparisons
```

## 📚 Knowledge Base Contents

V2 includes extensive knowledge about:

**6 Presentation Types** with specific guidance
**7 Audience Profiles** with expectations
**6 Visual Style Categories** with elements
**7 Color Scheme Presets** ready to use
**20+ Section Templates** for common structures
**100+ Content Suggestions** context-aware
**Best Practice Tips** throughout the process

## 🔮 Future Enhancements

Planned for future versions:
- AI-powered content generation for slides
- Integration with presentation templates
- Real-time collaboration features
- Visual preview of structure
- Export to more formats
- Custom knowledge base entries
- Learning from your past presentations

---

**Recommendation:** Start with V2 for your first presentation design, then use V1 if you prefer a more direct approach in the future.
