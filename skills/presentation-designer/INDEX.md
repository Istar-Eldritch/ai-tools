# Presentation Designer - Documentation Index

This is your guide to all the documentation in this skill.

## 🚀 New User? Start Here

1. **[GETTING_STARTED.md](GETTING_STARTED.md)** - 5-minute quick start guide
2. **[V2_FEATURES.md](V2_FEATURES.md)** - Learn about smart suggestions (recommended)
3. **[examples/](examples/)** - See real design documents
4. **Run**: `./quick-start.sh` - Interactive helper script

## 📚 Documentation Files

### For Users

| File | Purpose | When to Read |
|------|---------|--------------|
| **[GETTING_STARTED.md](GETTING_STARTED.md)** | Quick start guide | First time using the tool |
| **[V2_FEATURES.md](V2_FEATURES.md)** | Smart designer features | Learn about V2 capabilities |
| **[SKILL.md](SKILL.md)** | Complete skill reference | Need detailed documentation |
| **[USAGE_GUIDE.md](USAGE_GUIDE.md)** | AI integration guide | Using designs with AI agents |
| **[README.md](README.md)** | Quick reference | Quick lookup |
| **[SUMMARY.md](SUMMARY.md)** | Project overview | Understanding what this is |

### For Developers

| File | Purpose | When to Read |
|------|---------|--------------|
| **[CHANGELOG.md](CHANGELOG.md)** | Version history | Track changes and updates |
| **[package.json](package.json)** | Dependencies | Technical setup |
| **[test.sh](test.sh)** | Test suite | Verify installation |

## 🎯 Quick Navigation

### I want to...

**...learn what this tool does**
→ Read [SUMMARY.md](SUMMARY.md) (5 min read)

**...start using it right now**
→ Run `./quick-start.sh` or read [GETTING_STARTED.md](GETTING_STARTED.md)

**...see examples**
→ Check [examples/](examples/) directory

**...understand all features**
→ Read [SKILL.md](SKILL.md)

**...use designs with AI**
→ Read [USAGE_GUIDE.md](USAGE_GUIDE.md)

**...contribute or modify**
→ Read [README.md](README.md) and [CHANGELOG.md](CHANGELOG.md)

**...troubleshoot issues**
→ See [GETTING_STARTED.md](GETTING_STARTED.md#troubleshooting) or [SKILL.md](SKILL.md#troubleshooting)

## 📁 File Structure

```
presentation-designer/
├── Documentation
│   ├── INDEX.md              ← You are here
│   ├── GETTING_STARTED.md    ← Start here for new users
│   ├── SKILL.md              ← Main reference (for pi agent)
│   ├── README.md             ← Quick developer reference
│   ├── USAGE_GUIDE.md        ← How to use with AI agents
│   ├── SUMMARY.md            ← Project overview
│   └── CHANGELOG.md          ← Version history
│
├── Code
│   ├── designer.js           ← Main interactive tool
│   ├── quick-start.sh        ← Helper script with menu
│   ├── test.sh              ← Test suite
│   ├── package.json         ← Dependencies
│   └── package-lock.json    ← Locked dependencies
│
├── Examples
│   ├── conference-talk.yaml  ← 20-min tech talk
│   ├── workshop.yaml         ← 2-hour workshop
│   └── pitch.yaml           ← 10-min investor pitch
│
└── Config
    └── .gitignore           ← Git ignore rules
```

## 🎓 Learning Path

### Beginner
1. Read [SUMMARY.md](SUMMARY.md) to understand what this tool does
2. Read [GETTING_STARTED.md](GETTING_STARTED.md) and run `./quick-start.sh`
3. Look at [examples/conference-talk.yaml](examples/conference-talk.yaml)
4. Create your first design

### Intermediate
1. Read [SKILL.md](SKILL.md) for all features
2. Study all examples in [examples/](examples/)
3. Read [USAGE_GUIDE.md](USAGE_GUIDE.md) for AI integration
4. Create designs for different presentation types

### Advanced
1. Customize designs extensively
2. Create your own templates
3. Integrate with your workflow
4. Contribute improvements

## 📊 Document Sizes & Reading Times

| Document | Size | Reading Time |
|----------|------|--------------|
| GETTING_STARTED.md | ~7.5 KB | 10 minutes |
| SKILL.md | ~11 KB | 15 minutes |
| USAGE_GUIDE.md | ~7 KB | 10 minutes |
| SUMMARY.md | ~6 KB | 8 minutes |
| README.md | ~3 KB | 5 minutes |
| CHANGELOG.md | ~3 KB | 3 minutes |

**Total reading time**: ~50 minutes to read everything

**Minimum to get started**: 10 minutes (GETTING_STARTED.md)

## 🔍 Finding Information

### How do I...

**...install dependencies?**
```bash
# See README.md or run:
npm install
```

**...run the designer?**
```bash
# See GETTING_STARTED.md or run:
node designer.js
# or
./quick-start.sh
```

**...use command-line options?**
```bash
# See SKILL.md or run:
node designer.js --help
```

**...view examples?**
```bash
# See examples/ directory or run:
ls examples/
cat examples/conference-talk.yaml
```

**...generate a presentation from my design?**
See [USAGE_GUIDE.md](USAGE_GUIDE.md#example-prompts-for-ai-agents)

**...understand the design document format?**
See [GETTING_STARTED.md](GETTING_STARTED.md#the-design-document-explained)

**...troubleshoot problems?**
See [GETTING_STARTED.md](GETTING_STARTED.md#troubleshooting)

## 🎨 Examples Overview

Each example demonstrates different presentation types:

### conference-talk.yaml
- **Type**: Technical conference talk
- **Duration**: 20 minutes
- **Use Case**: Sharing knowledge at tech events
- **Highlights**: Code examples, architecture diagrams

### workshop.yaml
- **Type**: Hands-on workshop
- **Duration**: 2 hours
- **Use Case**: Teaching with exercises
- **Highlights**: Step-by-step exercises, breaks, deployment

### pitch.yaml
- **Type**: Investor pitch
- **Duration**: 10 minutes
- **Use Case**: Fundraising
- **Highlights**: Metrics, traction, market opportunity

## 📖 Related Resources

### External Documentation
- [Agent Skills Specification](https://agentskills.io/specification)
- [Typst Documentation](https://typst.app/docs/)
- [Polylux Package](https://github.com/andreasKroepelin/polylux)
- [Touying Framework](https://github.com/touying-typ/touying)

### Pi Documentation
- Pi skills: See Pi coding agent documentation for skills reference
- Pi README: See Pi coding agent README

## ✅ Verification

To verify your installation:

```bash
# Run the test suite
./test.sh

# Should output:
# ✓ SKILL.md has valid frontmatter
# ✓ designer.js is executable
# ✓ Dependencies installed
# ... etc ...
# All tests passed! ✨
```

## 🎯 Quick Commands Reference

```bash
# Interactive design
node designer.js

# Quick conference talk
node designer.js --type conference --duration 20

# Quick workshop
node designer.js --type workshop --duration 120

# Quick pitch
node designer.js --type pitch --duration 10

# Custom output
node designer.js --output my-design.yaml --format yaml

# View help
node designer.js --help

# View examples
node designer.js --examples

# Run helper menu
./quick-start.sh

# Run tests
./test.sh
```

## 📞 Support

If you need help:

1. Check [GETTING_STARTED.md](GETTING_STARTED.md#troubleshooting)
2. Check [SKILL.md](SKILL.md#troubleshooting)
3. Review [examples/](examples/) for working templates
4. Run `./test.sh` to verify installation

## 🎉 Ready to Begin?

1. If you're new: Start with [GETTING_STARTED.md](GETTING_STARTED.md)
2. If you want details: Read [SKILL.md](SKILL.md)
3. If you want to jump in: Run `./quick-start.sh`

Happy presenting! 🎤✨
