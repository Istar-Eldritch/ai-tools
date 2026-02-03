#!/bin/bash

# Test suite for Presentation Designer

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

test_passed() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASS++))
}

test_failed() {
    echo -e "${RED}✗${NC} $1"
    ((FAIL++))
}

echo "Running Presentation Designer Tests..."
echo ""

# Test 1: Check SKILL.md exists and has valid frontmatter
if [ -f "SKILL.md" ]; then
    if grep -q "^name: presentation-designer$" SKILL.md && \
       grep -q "^description:" SKILL.md; then
        test_passed "SKILL.md has valid frontmatter"
    else
        test_failed "SKILL.md frontmatter is invalid"
    fi
else
    test_failed "SKILL.md not found"
fi

# Test 2: Check designer.js is executable
if [ -x "designer.js" ]; then
    test_passed "designer.js is executable"
else
    test_failed "designer.js is not executable"
fi

# Test 2b: Check designer-v2.js is executable
if [ -x "designer-v2.js" ]; then
    test_passed "designer-v2.js is executable"
else
    test_failed "designer-v2.js is not executable"
fi

# Test 3: Check dependencies are installed
if [ -d "node_modules" ]; then
    test_passed "Dependencies installed"
else
    test_failed "Dependencies not installed"
fi

# Test 4: Check help command works (V1)
if node designer.js --help > /dev/null 2>&1; then
    test_passed "V1 help command works"
else
    test_failed "V1 help command failed"
fi

# Test 4b: Check help command works (V2)
if node designer-v2.js --help > /dev/null 2>&1; then
    test_passed "V2 help command works"
else
    test_failed "V2 help command failed"
fi

# Test 5: Check examples command works
if node designer.js --examples > /dev/null 2>&1; then
    test_passed "Examples command works"
else
    test_failed "Examples command failed"
fi

# Test 6: Check all example files exist and are valid YAML
for file in examples/*.yaml; do
    if [ -f "$file" ]; then
        if node -e "const yaml = require('yaml'); const fs = require('fs'); yaml.parse(fs.readFileSync('$file', 'utf8'));" 2>/dev/null; then
            test_passed "$(basename $file) is valid YAML"
        else
            test_failed "$(basename $file) is invalid YAML"
        fi
    fi
done

# Test 7: Check all documentation files exist
for doc in README.md USAGE_GUIDE.md SUMMARY.md CHANGELOG.md V2_FEATURES.md; do
    if [ -f "$doc" ]; then
        test_passed "$doc exists"
    else
        test_failed "$doc not found"
    fi
done

# Test 8: Check quick-start.sh is executable
if [ -x "quick-start.sh" ]; then
    test_passed "quick-start.sh is executable"
else
    test_failed "quick-start.sh is not executable"
fi

# Test 9: Verify skill name matches directory
dir_name=$(basename "$PWD")
if [ "$dir_name" = "presentation-designer" ]; then
    test_passed "Directory name matches skill name"
else
    test_failed "Directory name ($dir_name) doesn't match skill name"
fi

# Summary
echo ""
echo "================================"
echo -e "Tests passed: ${GREEN}$PASS${NC}"
echo -e "Tests failed: ${RED}$FAIL${NC}"
echo "================================"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✨${NC}"
    exit 0
else
    echo -e "${YELLOW}Some tests failed${NC}"
    exit 1
fi
