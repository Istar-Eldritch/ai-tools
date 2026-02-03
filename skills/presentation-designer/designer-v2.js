#!/usr/bin/env node

/**
 * Presentation Designer v2 - Iterative, AI-assisted design tool
 * 
 * Provides suggestions, options, and iterative refinement based on user input.
 * Helps draft presentations with intelligent defaults and recommendations.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

// Knowledge base for suggestions
const KNOWLEDGE_BASE = {
  presentationTypes: {
    conference: {
      description: 'Technical talk at a conference',
      typical_duration: [15, 20, 30, 45],
      typical_slides: [10, 15, 20, 25],
      structure_templates: ['intro', 'problem', 'solution', 'demo', 'conclusion'],
      tone: 'confident and engaging',
      tips: 'Keep it punchy, show real code, end with clear takeaways'
    },
    workshop: {
      description: 'Hands-on learning session',
      typical_duration: [60, 90, 120, 180, 240],
      typical_slides: [30, 40, 50, 60],
      structure_templates: ['intro', 'setup', 'basics', 'exercise', 'advanced', 'exercise', 'wrap-up'],
      tone: 'encouraging and supportive',
      tips: 'Include frequent breaks, hands-on exercises, and checkpoints'
    },
    pitch: {
      description: 'Investor or sales pitch',
      typical_duration: [5, 10, 15],
      typical_slides: [8, 10, 12],
      structure_templates: ['hook', 'problem', 'solution', 'market', 'traction', 'team', 'ask'],
      tone: 'confident but data-driven',
      tips: 'Lead with the problem, show momentum, be clear about the ask'
    },
    academic: {
      description: 'Academic lecture or seminar',
      typical_duration: [45, 50, 60, 90],
      typical_slides: [25, 30, 40, 50],
      structure_templates: ['background', 'methodology', 'results', 'discussion', 'conclusion'],
      tone: 'authoritative and thorough',
      tips: 'Cite sources, show methodology clearly, allow for questions'
    },
    internal: {
      description: 'Internal company presentation',
      typical_duration: [15, 30, 45, 60],
      typical_slides: [10, 15, 20, 30],
      structure_templates: ['context', 'status', 'challenges', 'plan', 'next-steps'],
      tone: 'professional and collaborative',
      tips: 'Focus on actionable insights, show data, be transparent'
    },
    training: {
      description: 'Training or onboarding session',
      typical_duration: [60, 120, 180, 240, 480],
      typical_slides: [30, 50, 70, 100],
      structure_templates: ['overview', 'fundamentals', 'practice', 'advanced', 'resources'],
      tone: 'clear and methodical',
      tips: 'Build progressively, include exercises, provide resources'
    }
  },

  audienceProfiles: {
    'developers': ['technical', 'code examples', 'best practices', 'efficiency'],
    'executives': ['business value', 'ROI', 'strategic impact', 'metrics'],
    'students': ['fundamentals', 'examples', 'practice', 'resources'],
    'general': ['clear explanations', 'visuals', 'relatable examples', 'stories'],
    'engineers': ['technical depth', 'architecture', 'trade-offs', 'implementation'],
    'designers': ['visual examples', 'user experience', 'design patterns', 'aesthetics'],
    'product-managers': ['features', 'roadmap', 'user stories', 'priorities']
  },

  colorSchemes: {
    modern: { primary: '#2563EB', secondary: '#7C3AED', accent: '#10B981', bg: '#FFFFFF', text: '#1F2937' },
    dark: { primary: '#60A5FA', secondary: '#A78BFA', accent: '#34D399', bg: '#111827', text: '#F9FAFB' },
    warm: { primary: '#DC2626', secondary: '#F59E0B', accent: '#EF4444', bg: '#FEF3C7', text: '#78350F' },
    cool: { primary: '#0891B2', secondary: '#3B82F6', accent: '#8B5CF6', bg: '#F0F9FF', text: '#0C4A6E' },
    professional: { primary: '#1E40AF', secondary: '#475569', accent: '#0EA5E9', bg: '#FFFFFF', text: '#1E293B' },
    vibrant: { primary: '#EC4899', secondary: '#8B5CF6', accent: '#F59E0B', bg: '#FFFFFF', text: '#1F2937' },
    minimal: { primary: '#000000', secondary: '#6B7280', accent: '#9CA3AF', bg: '#FFFFFF', text: '#111827' }
  },

  visualStyles: {
    'code-heavy': ['Large code blocks', 'Syntax highlighting', 'Terminal output', 'Monospace fonts'],
    'data-driven': ['Charts and graphs', 'Metrics callouts', 'Comparison tables', 'Infographics'],
    'visual-story': ['Full-screen images', 'Minimal text', 'Photo backgrounds', 'Icon systems'],
    'diagram-based': ['Architecture diagrams', 'Flow charts', 'Sequence diagrams', 'Mind maps'],
    'minimalist': ['Lots of whitespace', 'Simple layouts', 'One idea per slide', 'Large text'],
    'corporate': ['Consistent branding', 'Data tables', 'Professional charts', 'Bullet points']
  }
};

class SmartPresentationDesigner {
  constructor() {
    this.design = {
      presentation: {
        metadata: {},
        purpose: {},
        audience: {},
        key_messages: [],
        structure: { sections: [] },
        visual_style: {},
        content_guidelines: {},
        technical_notes: {}
      }
    };
    
    this.context = {
      presentationType: null,
      audienceType: null,
      expertise: null
    };
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async ask(question, defaultValue = null, suggestions = null) {
    let prompt = `${colors.cyan}${question}${colors.reset}`;
    
    if (suggestions && suggestions.length > 0) {
      prompt += `\n${colors.dim}Suggestions: ${suggestions.join(', ')}${colors.reset}`;
    }
    
    if (defaultValue) {
      prompt += ` ${colors.dim}[${defaultValue}]${colors.reset}`;
    }
    
    prompt += ' ';
    
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  async askChoice(question, choices, showDescriptions = false) {
    console.log(`\n${colors.bright}${question}${colors.reset}`);
    
    if (typeof choices[0] === 'object') {
      choices.forEach((choice, index) => {
        console.log(`  ${colors.dim}${index + 1}.${colors.reset} ${colors.bright}${choice.name}${colors.reset}`);
        if (showDescriptions && choice.description) {
          console.log(`     ${colors.dim}${choice.description}${colors.reset}`);
        }
      });
    } else {
      choices.forEach((choice, index) => {
        console.log(`  ${colors.dim}${index + 1}.${colors.reset} ${choice}`);
      });
    }
    
    const answer = await this.ask('\nYour choice (number or name)', '1');
    
    // Try to parse as number first
    const index = parseInt(answer) - 1;
    if (index >= 0 && index < choices.length) {
      return typeof choices[index] === 'object' ? choices[index].name : choices[index];
    }
    
    // Try to match by name
    const match = choices.find(c => {
      const name = typeof c === 'object' ? c.name : c;
      return name.toLowerCase() === answer.toLowerCase();
    });
    
    if (match) {
      return typeof match === 'object' ? match.name : match;
    }
    
    // Default to first choice
    return typeof choices[0] === 'object' ? choices[0].name : choices[0];
  }

  async askYesNo(question, defaultValue = true) {
    const defaultText = defaultValue ? 'Y/n' : 'y/N';
    const answer = await this.ask(`${question} (${defaultText})`);
    
    if (!answer) return defaultValue;
    return answer.toLowerCase().startsWith('y');
  }

  async askMultiChoice(question, options, minChoices = 0) {
    console.log(`\n${colors.bright}${question}${colors.reset}`);
    console.log(`${colors.dim}Enter numbers separated by spaces, or just press Enter when done${colors.reset}`);
    
    options.forEach((option, index) => {
      console.log(`  ${colors.dim}${index + 1}.${colors.reset} ${option}`);
    });
    
    const answer = await this.ask('\nYour choices');
    
    if (!answer && minChoices === 0) return [];
    
    const indices = answer.split(/[\s,]+/).map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < options.length);
    const selected = indices.map(i => options[i]);
    
    if (selected.length < minChoices) {
      console.log(`${colors.yellow}Please select at least ${minChoices} option(s)${colors.reset}`);
      return this.askMultiChoice(question, options, minChoices);
    }
    
    return selected;
  }

  async askList(question, suggestions = [], minItems = 0) {
    console.log(`\n${colors.bright}${question}${colors.reset}`);
    
    if (suggestions.length > 0) {
      console.log(`${colors.dim}Suggestions (press S to use): ${suggestions.join(', ')}${colors.reset}`);
    }
    
    console.log(`${colors.dim}Enter items one per line. Press Enter on empty line when done.${colors.reset}`);
    
    const items = [];
    let index = 1;
    
    while (true) {
      const item = await this.ask(`  ${index}.`);
      
      if (!item) {
        if (items.length >= minItems) break;
        
        // Offer to use suggestions
        if (suggestions.length > 0 && items.length === 0) {
          const useSuggestions = await this.askYesNo('Use suggested items?', true);
          if (useSuggestions) {
            return [...suggestions];
          }
        }
        
        console.log(`${colors.yellow}Please enter at least ${minItems} item(s)${colors.reset}`);
        continue;
      }
      
      if (item.toLowerCase() === 's' && suggestions.length > 0 && items.length === 0) {
        return [...suggestions];
      }
      
      items.push(item);
      index++;
    }
    
    return items;
  }

  printSection(title, subtitle = null) {
    console.log(`\n${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}  ${title}${colors.reset}`);
    if (subtitle) {
      console.log(`${colors.dim}  ${subtitle}${colors.reset}`);
    }
    console.log(`${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
  }

  printInfo(message) {
    console.log(`${colors.dim}ℹ ${message}${colors.reset}`);
  }

  printTip(message) {
    console.log(`${colors.yellow}💡 Tip: ${message}${colors.reset}`);
  }

  printSuggestion(message) {
    console.log(`${colors.green}✨ Suggestion: ${message}${colors.reset}`);
  }

  async run(options = {}) {
    console.log(`\n${colors.bright}${colors.magenta}🎨 Smart Presentation Designer${colors.reset}`);
    console.log(`${colors.dim}Let me help you design your presentation with smart suggestions${colors.reset}\n`);

    // Load existing design if provided
    if (options.input) {
      await this.loadDesign(options.input);
      console.log(`${colors.green}✓ Loaded existing design from ${options.input}${colors.reset}\n`);
    }

    // Stage 1: Quick Context Discovery
    await this.discoverContext(options);
    
    // Stage 2: Smart Metadata Collection
    await this.collectSmartMetadata(options);
    
    // Stage 3: Intelligent Purpose Definition
    await this.collectSmartPurpose();
    
    // Stage 4: Audience Analysis with Suggestions
    await this.collectSmartAudience(options);
    
    // Stage 5: Generate Key Messages
    await this.collectSmartKeyMessages();
    
    // Stage 6: Auto-generate Structure with Options
    await this.collectSmartStructure(options);
    
    // Stage 7: Suggest Visual Style
    await this.collectSmartVisualStyle();
    
    // Stage 8: Smart Content Guidelines
    await this.collectSmartContentGuidelines();
    
    // Stage 9: Technical Notes
    await this.collectTechnicalNotes();
    
    // Stage 10: Review and Iterate
    await this.reviewAndIterate();
    
    // Save the design
    await this.saveDesign(options.output || 'presentation-design.yaml', options.format || 'yaml');
    
    this.rl.close();
  }

  async loadDesign(filepath) {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const data = yaml.parse(content);
      this.design = data;
      
      // Extract context for suggestions
      if (data.presentation.metadata.type) {
        this.context.presentationType = data.presentation.metadata.type;
      }
    } catch (error) {
      console.log(`${colors.yellow}Could not load design: ${error.message}${colors.reset}`);
    }
  }

  async discoverContext(options) {
    this.printSection('🎯 Quick Discovery', 'Help me understand what you\'re creating');
    
    // Presentation type
    let type = options.type;
    if (!type) {
      const typeChoices = Object.keys(KNOWLEDGE_BASE.presentationTypes).map(key => ({
        name: key,
        description: KNOWLEDGE_BASE.presentationTypes[key].description
      }));
      
      type = await this.askChoice('What type of presentation?', typeChoices, true);
    }
    
    this.context.presentationType = type;
    const typeInfo = KNOWLEDGE_BASE.presentationTypes[type];
    
    this.printInfo(`Great! ${typeInfo.description}`);
    this.printTip(typeInfo.tips);
    
    // Quick topic/title to understand context
    const quickTitle = options.title || await this.ask('\nQuick: What\'s the main topic or working title?');
    this.context.mainTopic = quickTitle;
    
    // Expertise level
    const expertiseChoices = [
      { name: 'beginner', description: 'New to this topic, need basics' },
      { name: 'intermediate', description: 'Some familiarity, need practical knowledge' },
      { name: 'advanced', description: 'Deep expertise, need specialized content' },
      { name: 'mixed', description: 'Varied skill levels in audience' }
    ];
    
    this.context.expertise = await this.askChoice('\nAudience expertise level?', expertiseChoices, true);
    
    this.printSuggestion(`I'll tailor suggestions for a ${this.context.expertise} ${type} about ${quickTitle}`);
  }

  async collectSmartMetadata(options) {
    this.printSection('📋 Presentation Details');
    
    const typeInfo = KNOWLEDGE_BASE.presentationTypes[this.context.presentationType];
    
    // Title (already have working title)
    const finalTitle = await this.ask('Final title', this.context.mainTopic);
    
    // Author
    const author = await this.ask('Author name', process.env.USER || 'Author');
    
    // Date
    const date = await this.ask('Date (YYYY-MM-DD)', new Date().toISOString().split('T')[0]);
    
    // Duration with smart suggestions
    let duration = options.duration;
    if (!duration) {
      console.log(`\n${colors.dim}Typical durations for ${this.context.presentationType}:${colors.reset}`);
      typeInfo.typical_duration.forEach((d, i) => {
        console.log(`  ${colors.dim}${i + 1}.${colors.reset} ${d} minutes`);
      });
      
      const suggested = typeInfo.typical_duration[0];
      duration = parseInt(await this.ask(`\nDuration in minutes`, suggested.toString()));
    }
    
    this.design.presentation.metadata = {
      title: finalTitle,
      author,
      date,
      duration,
      type: this.context.presentationType,
      version: '1.0'
    };
  }

  async collectSmartPurpose() {
    this.printSection('🎯 Purpose & Goals');
    
    // Generate suggested goals based on type and topic
    const suggestions = this.generatePurposeSuggestions();
    
    this.printInfo('What do you want to achieve?');
    console.log(`\n${colors.dim}Examples for your presentation type:${colors.reset}`);
    suggestions.examples.forEach(ex => console.log(`  • ${colors.dim}${ex}${colors.reset}`));
    
    const primary_goal = await this.ask('\nYour primary goal', suggestions.default);
    
    // Suggest objectives
    this.printInfo('\nKey objectives (what should attendees learn/do?)');
    const objectives = await this.askList(
      'List 2-4 objectives:',
      suggestions.objectives,
      2
    );
    
    // Suggest success criteria
    const success_criteria = await this.askList(
      'How will you measure success?',
      suggestions.success,
      1
    );
    
    this.design.presentation.purpose = {
      primary_goal,
      objectives,
      success_criteria
    };
  }

  generatePurposeSuggestions() {
    const type = this.context.presentationType;
    const expertise = this.context.expertise;
    
    const suggestions = {
      conference: {
        default: `Share practical insights about ${this.context.mainTopic}`,
        examples: [
          'Inspire audience to try a new technology',
          'Share lessons learned from production experience',
          'Demonstrate innovative approach to common problem'
        ],
        objectives: [
          'Explain key concepts clearly',
          'Show real-world implementation',
          'Provide actionable takeaways'
        ],
        success: [
          'Attendees can apply concepts to their work',
          'Multiple questions during Q&A',
          'Positive feedback on practical examples'
        ]
      },
      workshop: {
        default: `Teach practical skills in ${this.context.mainTopic}`,
        examples: [
          'Enable participants to build something from scratch',
          'Upskill team on new technology',
          'Provide hands-on experience with best practices'
        ],
        objectives: [
          'Set up development environment',
          'Complete hands-on exercises',
          'Build working example project',
          'Understand key concepts through practice'
        ],
        success: [
          'Everyone completes the exercises',
          'Participants leave with working code',
          'Can continue learning independently'
        ]
      },
      pitch: {
        default: `Secure funding/partnership for ${this.context.mainTopic}`,
        examples: [
          'Convince investors of market opportunity',
          'Demonstrate traction and momentum',
          'Show why now is the right time'
        ],
        objectives: [
          'Present clear problem and solution',
          'Show market size and opportunity',
          'Demonstrate traction and validation',
          'Build confidence in team'
        ],
        success: [
          'Follow-up meeting scheduled',
          'Term sheet interest',
          'Detailed questions about metrics'
        ]
      }
    };
    
    return suggestions[type] || suggestions.conference;
  }

  async collectSmartAudience(options) {
    this.printSection('👥 Audience Analysis');
    
    // Suggest audience profiles based on detected keywords
    const profiles = Object.keys(KNOWLEDGE_BASE.audienceProfiles);
    
    let profile = options.audience;
    if (!profile) {
      this.printInfo('Who is your audience? (You can select multiple types)');
      const selectedProfiles = await this.askMultiChoice(
        'Select audience type(s):',
        profiles,
        1
      );
      
      // Show what these audiences typically expect
      console.log(`\n${colors.dim}These audiences typically value:${colors.reset}`);
      selectedProfiles.forEach(p => {
        const keywords = KNOWLEDGE_BASE.audienceProfiles[p];
        console.log(`  ${colors.cyan}${p}:${colors.reset} ${colors.dim}${keywords.join(', ')}${colors.reset}`);
      });
      
      profile = await this.ask('\nDescribe your audience', selectedProfiles.join(' and '));
    }
    
    const size = await this.ask('Expected audience size', this.estimateAudienceSize());
    
    // Suggest knowledge level based on expertise
    const knowledgeLevels = [
      'Complete beginner',
      'Some familiarity',
      'Intermediate knowledge',
      'Advanced practitioners',
      'Expert level',
      'Mixed levels'
    ];
    
    const suggestedLevel = this.context.expertise === 'beginner' ? 'Complete beginner' :
                          this.context.expertise === 'advanced' ? 'Advanced practitioners' :
                          'Intermediate knowledge';
    
    const knowledge_level = await this.askChoice('Knowledge level?', knowledgeLevels);
    
    // Generate expectations based on audience type
    const expectations = await this.askList(
      'What are they expecting?',
      this.generateAudienceExpectations(profile),
      1
    );
    
    this.design.presentation.audience = {
      profile,
      size,
      knowledge_level,
      expectations
    };
  }

  estimateAudienceSize() {
    const type = this.context.presentationType;
    const sizes = {
      conference: '50-200 people',
      workshop: '15-30 people',
      pitch: '3-10 people',
      academic: '20-50 students',
      internal: '10-30 people',
      training: '15-25 people'
    };
    return sizes[type] || '20-50 people';
  }

  generateAudienceExpectations(profile) {
    const baseExpectations = {
      developers: ['Practical code examples', 'Best practices', 'Real-world use cases'],
      executives: ['Business impact', 'ROI analysis', 'Strategic vision'],
      students: ['Clear fundamentals', 'Step-by-step guidance', 'Practice opportunities'],
      general: ['Clear explanations', 'Engaging stories', 'Actionable insights'],
      engineers: ['Technical depth', 'Architecture details', 'Trade-off analysis']
    };
    
    // Find matching profile
    for (const [key, expectations] of Object.entries(baseExpectations)) {
      if (profile.toLowerCase().includes(key)) {
        return expectations;
      }
    }
    
    return baseExpectations.general;
  }

  async collectSmartKeyMessages() {
    this.printSection('💡 Key Messages');
    
    // Generate suggested messages based on purpose
    const suggestions = this.generateKeyMessageSuggestions();
    
    this.printInfo('What are the 3-5 main takeaways?');
    this.printTip('Make these memorable, actionable, and aligned with your goal');
    
    console.log(`\n${colors.dim}Suggested messages based on your presentation:${colors.reset}`);
    suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${colors.dim}${s}${colors.reset}`));
    
    const useSuggestions = await this.askYesNo('\nUse these suggestions as starting point?', false);
    
    let messages;
    if (useSuggestions) {
      messages = [...suggestions];
      const addMore = await this.askYesNo('Add more messages?', false);
      if (addMore) {
        const additional = await this.askList('Additional messages:', [], 0);
        messages.push(...additional);
      }
    } else {
      messages = await this.askList('Your key messages:', suggestions, 3);
    }
    
    this.design.presentation.key_messages = messages;
  }

  generateKeyMessageSuggestions() {
    const type = this.context.presentationType;
    const topic = this.context.mainTopic;
    
    const templates = {
      conference: [
        `${topic} solves [specific problem] effectively`,
        `Key concept: [main technical insight]`,
        `Real-world impact: [practical benefit]`
      ],
      workshop: [
        `You can build [something] with ${topic}`,
        `The key to success is [core principle]`,
        `Common mistakes to avoid: [pitfall]`
      ],
      pitch: [
        `We solve [major problem] for [target market]`,
        `Market opportunity: [size] and growing`,
        `Our traction: [key metrics]`
      ]
    };
    
    return templates[type] || templates.conference;
  }

  async collectSmartStructure(options) {
    this.printSection('📐 Structure & Flow');
    
    const duration = this.design.presentation.metadata.duration;
    const typeInfo = KNOWLEDGE_BASE.presentationTypes[this.context.presentationType];
    
    // Calculate smart recommendations
    const avgTimePerSlide = 2.5; // minutes
    const suggestedSlides = Math.round(duration / avgTimePerSlide);
    
    this.printInfo(`For ${duration} minutes, I suggest ~${suggestedSlides} slides`);
    this.printTip(`${typeInfo.structure_templates.length} sections work well for ${this.context.presentationType}`);
    
    // Offer template structure
    console.log(`\n${colors.dim}Suggested structure for ${this.context.presentationType}:${colors.reset}`);
    typeInfo.structure_templates.forEach((s, i) => {
      console.log(`  ${i + 1}. ${colors.bright}${this.capitalizeFirst(s)}${colors.reset}`);
    });
    
    const useTemplate = await this.askYesNo('\nUse this structure template?', true);
    
    let sections;
    if (useTemplate) {
      sections = await this.generateStructureFromTemplate(typeInfo.structure_templates, duration, suggestedSlides);
    } else {
      sections = await this.createCustomStructure(duration, suggestedSlides);
    }
    
    this.design.presentation.structure = {
      total_slides: sections.reduce((sum, s) => sum + s.slides, 0),
      sections
    };
    
    // Offer to refine
    const refine = await this.askYesNo('Want to refine any sections?', false);
    if (refine) {
      await this.refineStructure();
    }
  }

  async generateStructureFromTemplate(template, totalDuration, totalSlides) {
    const sections = [];
    
    // Allocate time and slides based on section importance
    const weights = this.getSectionWeights(template);
    let remainingTime = totalDuration;
    let remainingSlides = totalSlides;
    
    for (let i = 0; i < template.length; i++) {
      const name = this.capitalizeFirst(template[i]);
      const weight = weights[i];
      
      // Calculate allocation
      const isLast = i === template.length - 1;
      const slides = isLast ? remainingSlides : Math.round(totalSlides * weight);
      const duration = isLast ? remainingTime : Math.round(totalDuration * weight);
      
      // Generate content suggestions
      const content = this.generateSectionContent(template[i], this.context.mainTopic);
      
      sections.push({ name, slides, duration, content });
      
      remainingTime -= duration;
      remainingSlides -= slides;
    }
    
    return sections;
  }

  getSectionWeights(template) {
    // Different sections get different weights
    const weights = {
      intro: 0.10,
      introduction: 0.10,
      problem: 0.15,
      solution: 0.30,
      demo: 0.20,
      conclusion: 0.08,
      'wrap-up': 0.08,
      setup: 0.10,
      basics: 0.20,
      exercise: 0.15,
      advanced: 0.20,
      hook: 0.05,
      market: 0.15,
      traction: 0.15,
      team: 0.10,
      ask: 0.10
    };
    
    return template.map(t => weights[t.toLowerCase()] || (1.0 / template.length));
  }

  generateSectionContent(sectionType, topic) {
    const contentTemplates = {
      intro: [`Title slide`, `Agenda overview`, `Why this matters`],
      introduction: [`Title slide`, `About the speaker`, `What we'll cover`],
      problem: [`Current challenges`, `Real-world example`, `Cost of inaction`],
      solution: [`Our approach to ${topic}`, `Key features/benefits`, `How it works`],
      demo: [`Live demonstration`, `Key features walkthrough`, `Q&A`],
      conclusion: [`Key takeaways`, `Resources and next steps`, `Thank you + Q&A`],
      setup: [`Prerequisites check`, `Environment setup`, `Clone starter code`],
      basics: [`Core concepts`, `Simple examples`, `Practice exercise`],
      exercise: [`Exercise instructions`, `Guided implementation`, `Solution review`],
      advanced: [`Advanced concepts`, `Complex example`, `Best practices`],
      'wrap-up': [`Summary and recap`, `Next steps`, `Resources`],
      hook: [`Attention-grabbing statistic`, `Compelling problem statement`],
      market: [`Market size (TAM/SAM/SOM)`, `Growth trends`, `Target segment`],
      traction: [`Revenue/user metrics`, `Growth chart`, `Key customers`],
      team: [`Founders and backgrounds`, `Key hires`, `Advisors`],
      ask: [`Funding amount`, `Use of funds`, `Milestones`]
    };
    
    return contentTemplates[sectionType.toLowerCase()] || [`Content for ${sectionType}`];
  }

  async createCustomStructure(duration, suggestedSlides) {
    this.printInfo('Create your own structure');
    
    const sections = [];
    const totalSlides = parseInt(await this.ask('Total number of slides', suggestedSlides.toString()));
    
    let remainingSlides = totalSlides;
    let remainingTime = duration;
    
    while (remainingSlides > 0) {
      const name = await this.ask(`\nSection name (${remainingSlides} slides left):`);
      if (!name) break;
      
      const slides = Math.min(parseInt(await this.ask('Number of slides', '3')), remainingSlides);
      const sectionDuration = Math.min(parseInt(await this.ask('Duration (minutes)', '5')), remainingTime);
      
      const content = await this.askList(`Content for "${name}":`, [], 1);
      
      sections.push({ name, slides, duration: sectionDuration, content });
      
      remainingSlides -= slides;
      remainingTime -= sectionDuration;
    }
    
    return sections;
  }

  async refineStructure() {
    const sections = this.design.presentation.structure.sections;
    
    console.log(`\n${colors.dim}Current sections:${colors.reset}`);
    sections.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.name} (${s.slides} slides, ${s.duration} min)`);
    });
    
    const choice = await this.ask('\nWhich section to refine? (number or name)', '0');
    const index = parseInt(choice) - 1;
    
    if (index >= 0 && index < sections.length) {
      const section = sections[index];
      
      console.log(`\n${colors.bright}Refining: ${section.name}${colors.reset}`);
      
      section.slides = parseInt(await this.ask('Slides', section.slides.toString()));
      section.duration = parseInt(await this.ask('Duration', section.duration.toString()));
      
      const changeContent = await this.askYesNo('Update content?', false);
      if (changeContent) {
        section.content = await this.askList('Content items:', section.content, 1);
      }
      
      this.printInfo('✓ Section updated');
      
      const refineMore = await this.askYesNo('Refine another section?', false);
      if (refineMore) {
        await this.refineStructure();
      }
    }
  }

  async collectSmartVisualStyle() {
    this.printSection('🎨 Visual Style');
    
    // Suggest visual style based on content type
    const styleTypes = Object.keys(KNOWLEDGE_BASE.visualStyles);
    
    this.printInfo('What visual style fits your content?');
    const selectedStyles = await this.askMultiChoice(
      'Select style elements (you can pick multiple):',
      styleTypes,
      1
    );
    
    // Show what these styles include
    console.log(`\n${colors.dim}Your selected styles include:${colors.reset}`);
    selectedStyles.forEach(style => {
      const elements = KNOWLEDGE_BASE.visualStyles[style];
      console.log(`  ${colors.cyan}${style}:${colors.reset}`);
      elements.forEach(e => console.log(`    • ${colors.dim}${e}${colors.reset}`));
    });
    
    // Suggest theme
    const theme = await this.ask('\nOverall theme/mood', this.suggestTheme());
    
    // Suggest color scheme
    console.log(`\n${colors.dim}Available color schemes:${colors.reset}`);
    Object.keys(KNOWLEDGE_BASE.colorSchemes).forEach((scheme, i) => {
      console.log(`  ${i + 1}. ${scheme}`);
    });
    
    const schemeChoice = await this.askChoice('Choose a color scheme:', Object.keys(KNOWLEDGE_BASE.colorSchemes));
    const color_scheme = KNOWLEDGE_BASE.colorSchemes[schemeChoice];
    
    // Typography suggestions
    const fontSuggestions = this.suggestFonts(selectedStyles);
    
    const typography = {
      heading_font: await this.ask('Heading font', fontSuggestions.heading),
      body_font: await this.ask('Body font', fontSuggestions.body),
      code_font: await this.ask('Code font (if needed)', fontSuggestions.code)
    };
    
    // Generate layout preferences based on style
    const layout_preferences = this.generateLayoutPreferences(selectedStyles);
    
    // Collect visual elements
    const visual_elements = [];
    for (const style of selectedStyles) {
      visual_elements.push(...KNOWLEDGE_BASE.visualStyles[style]);
    }
    
    this.design.presentation.visual_style = {
      theme,
      color_scheme,
      typography,
      layout_preferences,
      visual_elements: [...new Set(visual_elements)] // Remove duplicates
    };
  }

  suggestTheme() {
    const type = this.context.presentationType;
    const themes = {
      conference: 'Modern and professional',
      workshop: 'Clean and code-focused',
      pitch: 'Bold and impactful',
      academic: 'Classic and scholarly',
      internal: 'Corporate and consistent',
      training: 'Clear and organized'
    };
    return themes[type] || 'Modern and clean';
  }

  suggestFonts(styles) {
    const hasCode = styles.some(s => s.includes('code'));
    
    return {
      heading: 'Roboto',
      body: 'Open Sans',
      code: hasCode ? 'Fira Code' : 'monospace'
    };
  }

  generateLayoutPreferences(styles) {
    const preferences = [];
    
    if (styles.includes('minimalist')) {
      preferences.push('Generous white space', 'One idea per slide', 'Large text');
    }
    if (styles.includes('code-heavy')) {
      preferences.push('Large code blocks', 'High contrast', 'Syntax highlighting');
    }
    if (styles.includes('data-driven')) {
      preferences.push('Clear chart labels', 'Data callouts', 'Comparison layouts');
    }
    if (styles.includes('visual-story')) {
      preferences.push('Full-bleed images', 'Minimal text overlay', 'Bold typography');
    }
    if (styles.includes('corporate')) {
      preferences.push('Consistent branding', 'Professional layouts', 'Structured grids');
    }
    
    return preferences.length > 0 ? preferences : ['Clean and readable', 'Consistent layout'];
  }

  async collectSmartContentGuidelines() {
    this.printSection('📝 Content Guidelines');
    
    const typeInfo = KNOWLEDGE_BASE.presentationTypes[this.context.presentationType];
    
    const tone = await this.ask('Tone of presentation', typeInfo.tone);
    
    const language_level = await this.ask(
      'Language complexity',
      this.context.expertise === 'beginner' ? 'Simple and clear' : 'Technical and precise'
    );
    
    const complexity = await this.ask(
      'Content complexity',
      `${this.capitalizeFirst(this.context.expertise)}-friendly`
    );
    
    // Generate smart dos and don'ts
    const suggestedDos = this.generateContentDos();
    const suggestedDonts = this.generateContentDonts();
    
    const dos = await this.askList('Content DO\'s:', suggestedDos, 2);
    const donts = await this.askList('Content DON\'Ts:', suggestedDonts, 1);
    
    this.design.presentation.content_guidelines = {
      tone,
      language_level,
      complexity,
      dos,
      donts
    };
  }

  generateContentDos() {
    const type = this.context.presentationType;
    const expertise = this.context.expertise;
    
    const base = [
      'Use concrete, specific examples',
      'Show, don\'t just tell',
      'Connect to real-world applications'
    ];
    
    if (expertise === 'beginner') {
      base.push('Define technical terms', 'Build concepts progressively');
    }
    
    if (type === 'workshop') {
      base.push('Include hands-on exercises', 'Provide time for practice');
    }
    
    if (type === 'conference') {
      base.push('Share real production experiences', 'Include code examples');
    }
    
    return base;
  }

  generateContentDonts() {
    const type = this.context.presentationType;
    const expertise = this.context.expertise;
    
    const base = [
      'Don\'t overload slides with text',
      'Don\'t use jargon without explanation'
    ];
    
    if (expertise === 'beginner') {
      base.push('Don\'t assume prior knowledge', 'Don\'t skip foundational concepts');
    }
    
    if (type === 'pitch') {
      base.push('Don\'t show unrealistic projections', 'Don\'t trash competitors');
    }
    
    return base;
  }

  async collectTechnicalNotes() {
    this.printSection('🔧 Technical Notes');
    
    const hasDemo = this.design.presentation.structure.sections.some(s => 
      s.name.toLowerCase().includes('demo') || 
      s.content.some(c => c.toLowerCase().includes('demo'))
    );
    
    if (hasDemo) {
      this.printTip('I noticed you have a demo. Make sure to plan for technical requirements!');
    }
    
    const has_tools = await this.askYesNo('Need specific tools during presentation?');
    let tools_needed = [];
    if (has_tools) {
      tools_needed = await this.askList('Tools needed:', hasDemo ? ['Code editor', 'Terminal'] : [], 0);
    }
    
    const has_requirements = await this.askYesNo('Any special requirements?');
    let special_requirements = [];
    if (has_requirements) {
      special_requirements = await this.askList('Special requirements:', [], 0);
    }
    
    const has_backup = await this.askYesNo('Want to note backup plans?');
    let backup_plans = [];
    if (has_backup) {
      backup_plans = await this.askList('Backup plans:', hasDemo ? ['Pre-recorded demo video'] : [], 0);
    }
    
    this.design.presentation.technical_notes = {};
    
    if (tools_needed.length > 0) this.design.presentation.technical_notes.tools_needed = tools_needed;
    if (special_requirements.length > 0) this.design.presentation.technical_notes.special_requirements = special_requirements;
    if (backup_plans.length > 0) this.design.presentation.technical_notes.backup_plans = backup_plans;
  }

  async reviewAndIterate() {
    this.printSection('👁️  Review & Iterate');
    
    this.displayDesignSummary();
    
    const satisfied = await this.askYesNo('\nHappy with this design?', true);
    
    if (!satisfied) {
      console.log(`\n${colors.yellow}What would you like to change?${colors.reset}`);
      console.log(`  1. Adjust structure (sections, slides, timing)`);
      console.log(`  2. Update key messages`);
      console.log(`  3. Change visual style`);
      console.log(`  4. Modify audience profile`);
      console.log(`  5. Refine content guidelines`);
      console.log(`  6. Start over from scratch`);
      console.log(`  7. Continue with current design`);
      
      const choice = await this.ask('\nYour choice', '7');
      
      switch (choice) {
        case '1':
          await this.refineStructure();
          await this.reviewAndIterate();
          break;
        case '2':
          await this.collectSmartKeyMessages();
          await this.reviewAndIterate();
          break;
        case '3':
          await this.collectSmartVisualStyle();
          await this.reviewAndIterate();
          break;
        case '4':
          await this.collectSmartAudience({});
          await this.reviewAndIterate();
          break;
        case '5':
          await this.collectSmartContentGuidelines();
          await this.reviewAndIterate();
          break;
        case '6':
          this.design = {
            presentation: {
              metadata: {},
              purpose: {},
              audience: {},
              key_messages: [],
              structure: { sections: [] },
              visual_style: {},
              content_guidelines: {},
              technical_notes: {}
            }
          };
          await this.run({});
          break;
        default:
          this.printInfo('Continuing with current design...');
      }
    }
  }

  displayDesignSummary() {
    console.log(`${colors.bright}Your Presentation Design:${colors.reset}\n`);
    
    const meta = this.design.presentation.metadata;
    const structure = this.design.presentation.structure;
    
    console.log(`${colors.cyan}Title:${colors.reset} ${meta.title}`);
    console.log(`${colors.cyan}Type:${colors.reset} ${meta.type}`);
    console.log(`${colors.cyan}Duration:${colors.reset} ${meta.duration} minutes`);
    console.log(`${colors.cyan}Slides:${colors.reset} ${structure.total_slides}`);
    console.log(`${colors.cyan}Sections:${colors.reset} ${structure.sections.length}`);
    console.log(`${colors.cyan}Key Messages:${colors.reset} ${this.design.presentation.key_messages.length}`);
    
    console.log(`\n${colors.dim}Structure:${colors.reset}`);
    structure.sections.forEach((section, i) => {
      console.log(`  ${i + 1}. ${colors.bright}${section.name}${colors.reset} ${colors.dim}(${section.slides} slides, ${section.duration} min)${colors.reset}`);
      if (section.content && section.content.length > 0) {
        section.content.slice(0, 2).forEach(c => {
          console.log(`     ${colors.dim}• ${c}${colors.reset}`);
        });
        if (section.content.length > 2) {
          console.log(`     ${colors.dim}• ... and ${section.content.length - 2} more${colors.reset}`);
        }
      }
    });
    
    console.log(`\n${colors.dim}Key Messages:${colors.reset}`);
    this.design.presentation.key_messages.forEach((msg, i) => {
      console.log(`  ${i + 1}. ${colors.dim}${msg}${colors.reset}`);
    });
  }

  async saveDesign(outputPath, format) {
    this.printSection('💾 Saving Design');
    
    let content;
    let actualPath = outputPath;
    
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
    console.log(`  1. Review and refine the design file`);
    console.log(`  2. Share with stakeholders for feedback`);
    console.log(`  3. Use with an AI agent to generate your presentation`);
    console.log(`\n${colors.dim}Example AI prompt:${colors.reset}`);
    console.log(`  ${colors.yellow}pi "Create a Typst presentation using Polylux based on ${actualPath}.`);
    console.log(`      Follow the structure, apply the visual style, and match the tone exactly."${colors.reset}\n`);
    
    console.log(`${colors.dim}To iterate on this design later:${colors.reset}`);
    console.log(`  ${colors.cyan}node designer-v2.js --input ${actualPath}${colors.reset}\n`);
  }

  toMarkdown() {
    // Similar to v1, but with improvements
    const meta = this.design.presentation.metadata;
    const purpose = this.design.presentation.purpose;
    const audience = this.design.presentation.audience;
    const structure = this.design.presentation.structure;
    const style = this.design.presentation.visual_style;
    const guidelines = this.design.presentation.content_guidelines;
    
    let md = `# ${meta.title}\n\n`;
    md += `**Author:** ${meta.author}  \n`;
    md += `**Date:** ${meta.date}  \n`;
    md += `**Duration:** ${meta.duration} minutes  \n`;
    md += `**Type:** ${meta.type}  \n\n`;
    
    md += `## Purpose\n\n`;
    md += `**Goal:** ${purpose.primary_goal}\n\n`;
    md += `**Objectives:**\n`;
    purpose.objectives.forEach(obj => md += `- ${obj}\n`);
    md += `\n**Success Criteria:**\n`;
    purpose.success_criteria.forEach(crit => md += `- ${crit}\n`);
    
    md += `\n## Audience\n\n`;
    md += `**Profile:** ${audience.profile}  \n`;
    md += `**Size:** ${audience.size}  \n`;
    md += `**Knowledge Level:** ${audience.knowledge_level}  \n\n`;
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
    md += `**Tone:** ${guidelines.tone}  \n`;
    md += `**Language:** ${guidelines.language_level}  \n`;
    md += `**Complexity:** ${guidelines.complexity}  \n\n`;
    md += `**DO:**\n`;
    guidelines.dos.forEach(item => md += `- ${item}\n`);
    md += `\n**DON'T:**\n`;
    guidelines.donts.forEach(item => md += `- ${item}\n`);
    
    return md;
  }

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
${colors.bright}Smart Presentation Designer v2${colors.reset}

${colors.bright}USAGE:${colors.reset}
  node designer-v2.js [OPTIONS]

${colors.bright}FEATURES:${colors.reset}
  • Intelligent suggestions based on presentation type
  • Iterative design with review and refinement
  • Smart defaults for structure and content
  • Template-based generation with customization
  • Load and modify existing designs

${colors.bright}OPTIONS:${colors.reset}
  --help, -h              Show this help message
  --type <type>           Presentation type
  --duration <minutes>    Duration in minutes
  --audience <desc>       Audience description
  --title <title>         Presentation title
  --output <file>         Output file (default: presentation-design.yaml)
  --format <format>       Output format: yaml, json, markdown (default: yaml)
  --input <file>          Load existing design to iterate on

${colors.bright}EXAMPLES:${colors.reset}
  # Interactive mode with suggestions
  node designer-v2.js

  # Quick start with type
  node designer-v2.js --type workshop --duration 120

  # Load and iterate on existing design
  node designer-v2.js --input my-design.yaml

  # Generate JSON output
  node designer-v2.js --format json --output design.json
`);
}

// Main execution
async function main() {
  const options = parseArgs();
  const designer = new SmartPresentationDesigner();
  
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
