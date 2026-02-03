#!/usr/bin/env node

/**
 * Presentation Designer - Interactive presentation design tool
 * 
 * Guides users through a structured design process and outputs
 * a comprehensive design document for AI-assisted presentation generation.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// ANSI color codes for better UX
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

class PresentationDesigner {
  constructor() {
    this.design = {
      presentation: {
        metadata: {},
        purpose: {},
        audience: {},
        key_messages: [],
        structure: {
          sections: []
        },
        visual_style: {},
        content_guidelines: {},
        technical_notes: {}
      }
    };
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  // Helper to ask questions
  async ask(question, defaultValue = null) {
    const defaultText = defaultValue ? ` ${colors.dim}[${defaultValue}]${colors.reset}` : '';
    return new Promise((resolve) => {
      this.rl.question(`${colors.cyan}${question}${defaultText} ${colors.reset}`, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  // Helper to ask multiple choice
  async askChoice(question, choices) {
    console.log(`\n${colors.bright}${question}${colors.reset}`);
    choices.forEach((choice, index) => {
      console.log(`  ${colors.dim}${index + 1}.${colors.reset} ${choice}`);
    });
    
    const answer = await this.ask('Enter your choice (number)');
    const index = parseInt(answer) - 1;
    
    if (index >= 0 && index < choices.length) {
      return choices[index];
    }
    
    console.log(`${colors.yellow}Invalid choice, using default: ${choices[0]}${colors.reset}`);
    return choices[0];
  }

  // Helper to ask yes/no
  async askYesNo(question, defaultValue = true) {
    const defaultText = defaultValue ? 'Y/n' : 'y/N';
    const answer = await this.ask(`${question} (${defaultText})`);
    
    if (!answer) return defaultValue;
    return answer.toLowerCase().startsWith('y');
  }

  // Helper to ask for list items
  async askList(question, minItems = 0) {
    console.log(`\n${colors.bright}${question}${colors.reset}`);
    console.log(`${colors.dim}Enter items one per line. Press Enter on empty line when done.${colors.reset}`);
    
    const items = [];
    let index = 1;
    
    while (true) {
      const item = await this.ask(`  ${index}.`);
      if (!item) {
        if (items.length >= minItems) break;
        console.log(`${colors.yellow}Please enter at least ${minItems} item(s)${colors.reset}`);
        continue;
      }
      items.push(item);
      index++;
    }
    
    return items;
  }

  // Print section header
  printSection(title) {
    console.log(`\n${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}  ${title}${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
  }

  // Print info message
  printInfo(message) {
    console.log(`${colors.dim}ℹ ${message}${colors.reset}`);
  }

  // Main design flow
  async run(options = {}) {
    console.log(`\n${colors.bright}${colors.magenta}🎨 Presentation Designer${colors.reset}`);
    console.log(`${colors.dim}Let's design your presentation step by step${colors.reset}\n`);

    // Stage 1: Metadata and Context
    await this.collectMetadata(options);
    
    // Stage 2: Purpose and Goals
    await this.collectPurpose();
    
    // Stage 3: Audience Analysis
    await this.collectAudience(options);
    
    // Stage 4: Key Messages
    await this.collectKeyMessages();
    
    // Stage 5: Structure
    await this.collectStructure(options);
    
    // Stage 6: Visual Style
    await this.collectVisualStyle();
    
    // Stage 7: Content Guidelines
    await this.collectContentGuidelines();
    
    // Stage 8: Technical Notes
    await this.collectTechnicalNotes();
    
    // Review and finalize
    await this.reviewDesign();
    
    // Save the design
    await this.saveDesign(options.output || 'presentation-design.yaml', options.format || 'yaml');
    
    this.rl.close();
  }

  async collectMetadata(options) {
    this.printSection('📋 Metadata and Context');
    
    const title = options.title || await this.ask('Presentation title:', 'My Presentation');
    const author = await this.ask('Author name:', process.env.USER || 'Author');
    const date = await this.ask('Date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
    
    let duration = options.duration;
    if (!duration) {
      duration = parseInt(await this.ask('Duration in minutes:', '30'));
    }
    
    let type = options.type;
    if (!type) {
      type = await this.askChoice(
        'Presentation type:',
        ['conference', 'workshop', 'pitch', 'academic', 'internal', 'training', 'sales', 'other']
      );
    }
    
    this.design.presentation.metadata = {
      title,
      author,
      date,
      duration,
      type,
      version: '1.0'
    };
    
    this.printInfo(`✓ Metadata collected`);
  }

  async collectPurpose() {
    this.printSection('🎯 Purpose and Goals');
    
    this.printInfo('What do you want to achieve with this presentation?');
    const primary_goal = await this.ask('Primary goal:');
    
    const objectives = await this.askList('List your key objectives:', 2);
    
    this.printInfo('How will you know if the presentation was successful?');
    const success_criteria = await this.askList('Success criteria:', 1);
    
    this.design.presentation.purpose = {
      primary_goal,
      objectives,
      success_criteria
    };
    
    this.printInfo(`✓ Purpose defined`);
  }

  async collectAudience(options) {
    this.printSection('👥 Audience Analysis');
    
    let profile = options.audience;
    if (!profile) {
      profile = await this.ask('Who is your audience? (describe them):');
    }
    
    const size = await this.ask('Expected audience size (e.g., "20-30 people" or "100+"):', '20-30');
    const knowledge_level = await this.ask('Their knowledge level on this topic:', 'Beginner');
    
    this.printInfo('What are they expecting or hoping to get from this?');
    const expectations = await this.askList('Audience expectations:', 1);
    
    const needs_analysis = await this.askYesNo('Add specific needs/pain points?');
    let needs = [];
    if (needs_analysis) {
      needs = await this.askList('What problems or needs does your audience have?', 1);
    }
    
    this.design.presentation.audience = {
      profile,
      size,
      knowledge_level,
      expectations
    };
    
    if (needs.length > 0) {
      this.design.presentation.audience.needs = needs;
    }
    
    this.printInfo(`✓ Audience analyzed`);
  }

  async collectKeyMessages() {
    this.printSection('💡 Key Messages');
    
    this.printInfo('What are the 3-5 main points you want your audience to remember?');
    const messages = await this.askList('Key messages:', 3);
    
    this.design.presentation.key_messages = messages;
    
    this.printInfo(`✓ Key messages defined`);
  }

  async collectStructure(options) {
    this.printSection('📐 Structure and Flow');
    
    const duration = this.design.presentation.metadata.duration;
    const suggested_slides = Math.floor(duration / 2);
    
    this.printInfo(`For a ${duration}-minute presentation, we suggest ~${suggested_slides} slides`);
    this.printInfo(`Rule of thumb: 2-3 minutes per slide for most content`);
    
    const total_slides = parseInt(await this.ask('Total number of slides:', suggested_slides.toString()));
    
    this.printInfo('Now let\'s break this into sections...');
    
    const sections = [];
    let remaining_slides = total_slides;
    let remaining_time = duration;
    
    const default_sections = [
      { name: 'Introduction', suggested_slides: Math.ceil(total_slides * 0.1) },
      { name: 'Main Content', suggested_slides: Math.ceil(total_slides * 0.7) },
      { name: 'Conclusion', suggested_slides: Math.ceil(total_slides * 0.1) }
    ];
    
    const use_defaults = await this.askYesNo('Use default structure (Intro/Body/Conclusion)?', true);
    
    if (use_defaults) {
      for (const def of default_sections) {
        const section = await this.collectSection(def.name, def.suggested_slides, remaining_time);
        sections.push(section);
        remaining_slides -= section.slides;
        remaining_time -= section.duration;
      }
    } else {
      console.log(`\n${colors.dim}Enter sections one by one. Press Enter on empty name when done.${colors.reset}`);
      
      while (remaining_slides > 0) {
        const name = await this.ask(`\nSection name (${remaining_slides} slides left):`);
        if (!name) break;
        
        const section = await this.collectSection(name, remaining_slides, remaining_time);
        sections.push(section);
        remaining_slides -= section.slides;
        remaining_time -= section.duration;
      }
    }
    
    this.design.presentation.structure = {
      total_slides,
      sections
    };
    
    this.printInfo(`✓ Structure defined with ${sections.length} sections`);
  }

  async collectSection(name, suggested_slides, remaining_time) {
    const slides = parseInt(await this.ask(`  Number of slides for "${name}":`, suggested_slides.toString()));
    const duration = parseInt(await this.ask(`  Duration in minutes:`, Math.ceil(remaining_time / 3).toString()));
    
    this.printInfo(`  What content will go in this section?`);
    const content = await this.askList(`  Content items for "${name}":`, 1);
    
    return { name, slides, duration, content };
  }

  async collectVisualStyle() {
    this.printSection('🎨 Visual Style');
    
    const theme = await this.ask('Overall theme/mood (e.g., "modern", "corporate", "playful"):', 'modern');
    
    this.printInfo('Color scheme - enter hex colors or color names');
    const color_scheme = {
      primary: await this.ask('Primary color:', '#2563EB'),
      secondary: await this.ask('Secondary color:', '#7C3AED'),
      accent: await this.ask('Accent color:', '#10B981'),
      background: await this.ask('Background color:', '#FFFFFF'),
      text: await this.ask('Text color:', '#1F2937')
    };
    
    this.printInfo('Typography');
    const typography = {
      heading_font: await this.ask('Heading font:', 'sans-serif'),
      body_font: await this.ask('Body font:', 'sans-serif'),
      code_font: await this.ask('Code font (if needed):', 'monospace')
    };
    
    const layout_preferences = await this.askList('Layout preferences (e.g., "minimal", "lots of white space"):', 1);
    
    const has_visual_elements = await this.askYesNo('Will you use specific visual elements (diagrams, icons, etc.)?');
    let visual_elements = [];
    if (has_visual_elements) {
      visual_elements = await this.askList('Visual elements you plan to use:', 1);
    }
    
    this.design.presentation.visual_style = {
      theme,
      color_scheme,
      typography,
      layout_preferences
    };
    
    if (visual_elements.length > 0) {
      this.design.presentation.visual_style.visual_elements = visual_elements;
    }
    
    this.printInfo(`✓ Visual style defined`);
  }

  async collectContentGuidelines() {
    this.printSection('📝 Content Guidelines');
    
    const tone = await this.ask('Tone of the presentation (e.g., "formal", "casual", "enthusiastic"):', 'professional');
    const language_level = await this.ask('Language complexity (e.g., "simple", "technical", "academic"):', 'clear and accessible');
    const complexity = await this.ask('Content complexity (e.g., "beginner-friendly", "advanced"):', 'moderate');
    
    this.printInfo('Content do\'s and don\'ts help maintain consistency');
    
    const dos = await this.askList('Content DO\'s (best practices):', 2);
    const donts = await this.askList('Content DON\'Ts (things to avoid):', 1);
    
    this.design.presentation.content_guidelines = {
      tone,
      language_level,
      complexity,
      dos,
      donts
    };
    
    this.printInfo(`✓ Content guidelines defined`);
  }

  async collectTechnicalNotes() {
    this.printSection('🔧 Technical Notes');
    
    const has_tools = await this.askYesNo('Will you need specific tools during the presentation (live demos, etc.)?');
    let tools_needed = [];
    if (has_tools) {
      tools_needed = await this.askList('Tools needed:', 1);
    }
    
    const has_requirements = await this.askYesNo('Any special requirements (equipment, software, etc.)?');
    let special_requirements = [];
    if (has_requirements) {
      special_requirements = await this.askList('Special requirements:', 1);
    }
    
    const has_backup = await this.askYesNo('Want to note any backup plans?');
    let backup_plans = [];
    if (has_backup) {
      backup_plans = await this.askList('Backup plans:', 1);
    }
    
    this.design.presentation.technical_notes = {};
    
    if (tools_needed.length > 0) {
      this.design.presentation.technical_notes.tools_needed = tools_needed;
    }
    
    if (special_requirements.length > 0) {
      this.design.presentation.technical_notes.special_requirements = special_requirements;
    }
    
    if (backup_plans.length > 0) {
      this.design.presentation.technical_notes.backup_plans = backup_plans;
    }
    
    this.printInfo(`✓ Technical notes recorded`);
  }

  async reviewDesign() {
    this.printSection('👁️ Review');
    
    console.log(`${colors.bright}Your Presentation Design:${colors.reset}\n`);
    
    const meta = this.design.presentation.metadata;
    console.log(`${colors.cyan}Title:${colors.reset} ${meta.title}`);
    console.log(`${colors.cyan}Type:${colors.reset} ${meta.type}`);
    console.log(`${colors.cyan}Duration:${colors.reset} ${meta.duration} minutes`);
    console.log(`${colors.cyan}Slides:${colors.reset} ${this.design.presentation.structure.total_slides}`);
    console.log(`${colors.cyan}Sections:${colors.reset} ${this.design.presentation.structure.sections.length}`);
    console.log(`${colors.cyan}Key Messages:${colors.reset} ${this.design.presentation.key_messages.length}`);
    
    console.log(`\n${colors.dim}Sections:${colors.reset}`);
    this.design.presentation.structure.sections.forEach((section, i) => {
      console.log(`  ${i + 1}. ${section.name} (${section.slides} slides, ${section.duration} min)`);
    });
    
    const satisfied = await this.askYesNo('\nAre you satisfied with this design?', true);
    
    if (!satisfied) {
      console.log(`\n${colors.yellow}You can manually edit the output file after generation${colors.reset}`);
      console.log(`${colors.yellow}Or run the designer again to start fresh${colors.reset}`);
    }
  }

  async saveDesign(outputPath, format) {
    this.printSection('💾 Saving Design');
    
    let content;
    let actualPath = outputPath;
    
    // Ensure correct extension
    const ext = path.extname(outputPath);
    if (format === 'yaml' && ext !== '.yaml' && ext !== '.yml') {
      actualPath = outputPath.replace(/\.[^.]*$/, '') + '.yaml';
    } else if (format === 'json' && ext !== '.json') {
      actualPath = outputPath.replace(/\.[^.]*$/, '') + '.json';
    } else if (format === 'markdown' && ext !== '.md') {
      actualPath = outputPath.replace(/\.[^.]*$/, '') + '.md';
    }
    
    switch (format) {
      case 'json':
        content = JSON.stringify(this.design, null, 2);
        break;
      case 'markdown':
        content = this.toMarkdown();
        break;
      case 'yaml':
      default:
        content = yaml.stringify(this.design);
        break;
    }
    
    fs.writeFileSync(actualPath, content, 'utf8');
    
    console.log(`\n${colors.green}✓ Design saved to: ${actualPath}${colors.reset}`);
    console.log(`\n${colors.bright}Next steps:${colors.reset}`);
    console.log(`  1. Review and refine the design document`);
    console.log(`  2. Share with stakeholders for feedback`);
    console.log(`  3. Use with an AI agent to generate your Typst presentation`);
    console.log(`\n${colors.dim}Example: pi "Using ${actualPath}, generate a Typst presentation"${colors.reset}\n`);
  }

  toMarkdown() {
    const meta = this.design.presentation.metadata;
    const purpose = this.design.presentation.purpose;
    const audience = this.design.presentation.audience;
    const structure = this.design.presentation.structure;
    const style = this.design.presentation.visual_style;
    const guidelines = this.design.presentation.content_guidelines;
    const technical = this.design.presentation.technical_notes;
    
    let md = `# ${meta.title}\n\n`;
    md += `**Author:** ${meta.author}\n`;
    md += `**Date:** ${meta.date}\n`;
    md += `**Duration:** ${meta.duration} minutes\n`;
    md += `**Type:** ${meta.type}\n\n`;
    
    md += `## Purpose\n\n`;
    md += `**Goal:** ${purpose.primary_goal}\n\n`;
    md += `**Objectives:**\n`;
    purpose.objectives.forEach(obj => md += `- ${obj}\n`);
    md += `\n**Success Criteria:**\n`;
    purpose.success_criteria.forEach(crit => md += `- ${crit}\n`);
    
    md += `\n## Audience\n\n`;
    md += `**Profile:** ${audience.profile}\n`;
    md += `**Size:** ${audience.size}\n`;
    md += `**Knowledge Level:** ${audience.knowledge_level}\n\n`;
    md += `**Expectations:**\n`;
    audience.expectations.forEach(exp => md += `- ${exp}\n`);
    
    md += `\n## Key Messages\n\n`;
    this.design.presentation.key_messages.forEach((msg, i) => {
      md += `${i + 1}. ${msg}\n`;
    });
    
    md += `\n## Structure\n\n`;
    md += `**Total Slides:** ${structure.total_slides}\n\n`;
    structure.sections.forEach((section, i) => {
      md += `### ${i + 1}. ${section.name}\n`;
      md += `- **Slides:** ${section.slides}\n`;
      md += `- **Duration:** ${section.duration} minutes\n`;
      md += `- **Content:**\n`;
      section.content.forEach(item => md += `  - ${item}\n`);
      md += `\n`;
    });
    
    md += `## Visual Style\n\n`;
    md += `**Theme:** ${style.theme}\n\n`;
    md += `**Colors:**\n`;
    Object.entries(style.color_scheme).forEach(([key, value]) => {
      md += `- ${key}: ${value}\n`;
    });
    md += `\n**Typography:**\n`;
    Object.entries(style.typography).forEach(([key, value]) => {
      md += `- ${key}: ${value}\n`;
    });
    
    md += `\n## Content Guidelines\n\n`;
    md += `**Tone:** ${guidelines.tone}\n`;
    md += `**Language:** ${guidelines.language_level}\n`;
    md += `**Complexity:** ${guidelines.complexity}\n\n`;
    md += `**DO:**\n`;
    guidelines.dos.forEach(item => md += `- ${item}\n`);
    md += `\n**DON'T:**\n`;
    guidelines.donts.forEach(item => md += `- ${item}\n`);
    
    if (Object.keys(technical).length > 0) {
      md += `\n## Technical Notes\n\n`;
      if (technical.tools_needed) {
        md += `**Tools Needed:**\n`;
        technical.tools_needed.forEach(tool => md += `- ${tool}\n`);
        md += `\n`;
      }
      if (technical.special_requirements) {
        md += `**Special Requirements:**\n`;
        technical.special_requirements.forEach(req => md += `- ${req}\n`);
        md += `\n`;
      }
      if (technical.backup_plans) {
        md += `**Backup Plans:**\n`;
        technical.backup_plans.forEach(plan => md += `- ${plan}\n`);
      }
    }
    
    return md;
  }
}

// CLI argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--examples') {
      printExamples();
      process.exit(0);
    } else if (arg === '--list-templates') {
      printTemplates();
      process.exit(0);
    } else if (arg === '--type') {
      options.type = args[++i];
    } else if (arg === '--duration') {
      options.duration = parseInt(args[++i]);
    } else if (arg === '--audience') {
      options.audience = args[++i];
    } else if (arg === '--title') {
      options.title = args[++i];
    } else if (arg === '--output') {
      options.output = args[++i];
    } else if (arg === '--format') {
      options.format = args[++i];
    } else if (arg === '--input') {
      options.input = args[++i];
    } else if (arg === '--template') {
      options.template = args[++i];
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
${colors.bright}Presentation Designer${colors.reset} - Interactive presentation design tool

${colors.bright}USAGE:${colors.reset}
  node designer.js [OPTIONS]

${colors.bright}OPTIONS:${colors.reset}
  --help, -h              Show this help message
  --examples              Show example design documents
  --list-templates        List available templates
  
  --type <type>           Presentation type
  --duration <minutes>    Duration in minutes
  --audience <desc>       Audience description
  --title <title>         Presentation title
  
  --output <file>         Output file (default: presentation-design.yaml)
  --format <format>       Output format: yaml, json, markdown (default: yaml)
  --input <file>          Load existing design to update
  --template <name>       Start from a template

${colors.bright}PRESENTATION TYPES:${colors.reset}
  conference, workshop, pitch, academic, internal, training, sales

${colors.bright}EXAMPLES:${colors.reset}
  node designer.js
  node designer.js --type workshop --duration 60
  node designer.js --format json --output design.json
  node designer.js --template conference-talk

${colors.bright}DOCUMENTATION:${colors.reset}
  See SKILL.md for detailed information and tips
`);
}

function printExamples() {
  console.log(`
${colors.bright}Example Design Documents${colors.reset}

Check the examples/ directory for:
- conference-talk.yaml    20-minute conference presentation
- workshop.yaml           2-hour hands-on workshop
- pitch.yaml              10-minute investor pitch
- academic.yaml           45-minute academic lecture
- training.yaml           Half-day training session

You can also run the designer interactively to see examples in action.
`);
}

function printTemplates() {
  console.log(`
${colors.bright}Available Templates${colors.reset}

Templates are coming in a future update. For now, run the designer
interactively and choose a presentation type to get sensible defaults.

Planned templates:
- conference-talk         Standard conference presentation
- workshop                Interactive workshop format
- pitch                   Investor/sales pitch structure
- academic                Academic lecture layout
- training                Training session format
`);
}

// Main execution
async function main() {
  const options = parseArgs();
  const designer = new PresentationDesigner();
  
  try {
    await designer.run(options);
  } catch (error) {
    console.error(`\n${colors.yellow}Design process interrupted${colors.reset}`);
    if (error.message !== 'canceled') {
      console.error(`${colors.dim}Error: ${error.message}${colors.reset}`);
    }
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(`\n\n${colors.yellow}Design process canceled${colors.reset}`);
  process.exit(0);
});

main();
