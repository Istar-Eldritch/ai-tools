---
name: deep-research
description: Comprehensive web research combining Kagi search and browser automation. Use when the user needs in-depth research on a topic, investigating multiple sources, fact-checking, comparing information, synthesizing findings, or creating detailed reports with citations.
allowed-tools: Bash(agent-browser:*), Bash(kagi-search:*)
---

# Deep Research

Perform thorough web research by combining Kagi search for discovery with browser automation for deep content extraction.

## Workflow Overview

1. **Clarify** - Understand the research question and scope
2. **Search** - Use Kagi to find relevant sources
3. **Extract** - Use browser to read full content from key sources
4. **Analyze** - Cross-reference and verify information
5. **Synthesize** - Compile findings into a comprehensive summary

## Tools

### Kagi Search (Discovery)
```bash
~/.pi/agent/skills/kagi-search/search.sh "query" --limit 10
```

### Browser (Deep Reading)
```bash
agent-browser open <url>          # Navigate to source
agent-browser snapshot            # Get full page content
agent-browser snapshot -s "main"  # Get main content area
agent-browser get text @e1        # Extract specific text
agent-browser scroll down 500     # Scroll to load more
agent-browser pdf output.pdf      # Save page as PDF
```

## Research Process

### Step 1: Initial Discovery

Start with broad searches to understand the landscape:

```bash
# Primary search
~/.pi/agent/skills/kagi-search/search.sh "main topic query" --limit 10

# Related searches for context
~/.pi/agent/skills/kagi-search/search.sh "topic background history"
~/.pi/agent/skills/kagi-search/search.sh "topic recent developments 2025"
```

### Step 2: Source Evaluation

From search results, identify sources by type:
- **Primary sources**: Official documentation, research papers, original reports
- **Secondary sources**: News articles, analysis pieces, expert commentary  
- **Reference sources**: Wikipedia, encyclopedias, glossaries

Prioritize:
1. Authoritative domains (.gov, .edu, established organizations)
2. Recent publication dates
3. Expert authors with credentials
4. Sources with citations/references

### Step 3: Deep Content Extraction

For each key source, extract full content:

```bash
# Open the source
agent-browser open "https://example.com/article"

# Get page structure
agent-browser snapshot -i

# Extract main content (adjust selector as needed)
agent-browser snapshot -s "article"
# or
agent-browser snapshot -s "main"
# or
agent-browser snapshot -s ".content"

# For long pages, scroll and extract sections
agent-browser scroll down 1000
agent-browser snapshot -s "article"

# Save important pages as PDF for reference
agent-browser pdf "research/source-name.pdf"
```

### Step 4: Cross-Reference and Verify

For factual claims:
```bash
# Search for corroborating sources
~/.pi/agent/skills/kagi-search/search.sh "specific claim fact check"

# Check multiple authoritative sources
~/.pi/agent/skills/kagi-search/search.sh "claim site:gov OR site:edu"
```

### Step 5: Fill Knowledge Gaps

If initial research reveals gaps:
```bash
# Search for missing information
~/.pi/agent/skills/kagi-search/search.sh "specific subtopic needed"

# Follow references from existing sources
agent-browser click @e5  # Click citation/link
agent-browser snapshot -s "main"
```

## Research Strategies

### For Current Events
```bash
~/.pi/agent/skills/kagi-search/search.sh "topic 2025" --limit 15
~/.pi/agent/skills/kagi-search/search.sh "topic latest news"
```

### For Technical Topics
```bash
~/.pi/agent/skills/kagi-search/search.sh "topic documentation"
~/.pi/agent/skills/kagi-search/search.sh "topic tutorial guide"
~/.pi/agent/skills/kagi-search/search.sh "topic best practices"
```

### For Controversial Topics
Research multiple perspectives:
```bash
~/.pi/agent/skills/kagi-search/search.sh "topic pros advantages"
~/.pi/agent/skills/kagi-search/search.sh "topic cons disadvantages"
~/.pi/agent/skills/kagi-search/search.sh "topic criticism"
~/.pi/agent/skills/kagi-search/search.sh "topic expert opinion"
```

### For Historical Research
```bash
~/.pi/agent/skills/kagi-search/search.sh "topic history timeline"
~/.pi/agent/skills/kagi-search/search.sh "topic origin background"
~/.pi/agent/skills/kagi-search/search.sh "topic primary sources"
```

### For Comparisons
```bash
~/.pi/agent/skills/kagi-search/search.sh "A vs B comparison"
~/.pi/agent/skills/kagi-search/search.sh "A advantages over B"
~/.pi/agent/skills/kagi-search/search.sh "B advantages over A"
```

## Output Format

Structure research findings as:

```markdown
# Research: [Topic]

## Executive Summary
[2-3 paragraph overview of key findings]

## Key Findings

### Finding 1: [Title]
[Detailed explanation with evidence]
- Source: [URL] ([Domain], [Date])
- Corroborated by: [Additional sources]

### Finding 2: [Title]
...

## Areas of Uncertainty
[Topics where sources disagree or information is limited]

## Recommendations / Conclusions
[Actionable insights or final conclusions]

## Sources
1. [Title] - [URL] - [Brief description of what it contributed]
2. ...
```

## Best Practices

1. **Cast a wide net first** - Start with multiple search queries to understand the topic landscape
2. **Verify important facts** - Cross-reference key claims across 2-3 independent sources
3. **Note publication dates** - Prefer recent sources for rapidly evolving topics
4. **Track sources meticulously** - Record URLs and key quotes for citation
5. **Identify bias** - Note the perspective/affiliation of each source
6. **Acknowledge gaps** - Be explicit about what couldn't be verified
7. **Iterative refinement** - Let early findings guide deeper searches

## Example: Researching a Technology

```bash
# 1. Overview search
~/.pi/agent/skills/kagi-search/search.sh "WebGPU technology overview" --limit 10

# 2. Official documentation
agent-browser open "https://www.w3.org/TR/webgpu/"
agent-browser snapshot -s "main"

# 3. Current state and adoption
~/.pi/agent/skills/kagi-search/search.sh "WebGPU browser support 2025"
~/.pi/agent/skills/kagi-search/search.sh "WebGPU adoption statistics"

# 4. Practical applications
~/.pi/agent/skills/kagi-search/search.sh "WebGPU real world applications examples"

# 5. Expert opinions
~/.pi/agent/skills/kagi-search/search.sh "WebGPU review expert opinion"

# 6. Comparisons
~/.pi/agent/skills/kagi-search/search.sh "WebGPU vs WebGL comparison"

# 7. Deep dive into promising source
agent-browser open "https://developer.chrome.com/docs/web-platform/webgpu"
agent-browser snapshot
agent-browser scroll down 1000
agent-browser snapshot
```

## Cleanup

Always close the browser when research is complete:
```bash
agent-browser close
```
