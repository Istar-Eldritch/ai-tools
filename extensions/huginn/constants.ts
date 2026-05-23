export const MEMORY_TOOL_DESCRIPTION = `Save durable information to persistent memory that survives across sessions. Memory is stored in Postgres with vector search (vectorchord).

WHEN TO SAVE (do this proactively, don't wait to be asked):
- User corrects you or says 'remember this' / 'don't do that again'
- User shares a preference, habit, or personal detail (name, role, timezone, coding style)
- You discover something about the environment (OS, installed tools, project structure)
- You learn a convention, API quirk, or workflow specific to this user's setup
- You identify a stable fact that will be useful again in future sessions

PRIORITY: User preferences and corrections > environment facts > procedural knowledge.

THREE TARGETS:
- 'user': who the user is -- name, role, preferences, communication style, pet peeves
- 'memory': your global notes -- environment facts, tool quirks, lessons learned (shared across all projects)
- 'project': project-specific notes -- architecture decisions, API quirks, team norms, codebase conventions (scoped to current project)

ACTIONS: add (new entry), replace (update existing -- old_text identifies it), remove (delete -- old_text identifies it).`;

export const CORRECTION_STRONG_PATTERNS = [
	/\b(don'?t|do not|never|stop|please don'?t|please do not)\b.{0,60}\b(do|say|use|add|write|include|put|make|call|refer|assume)\b/i,
	/\b(wrong|incorrect|that'?s wrong|that is wrong|not right|no,? that'?s)\b/i,
	/\b(i told you|i said|i already said|as i (mentioned|said|told))\b/i,
	/\b(remember|don'?t forget)\b.{0,60}\b(always|never|every time)\b/i,
];

export const CORRECTION_WEAK_PATTERNS = [
	/\bactually\b/i,
	/\bno,?\s+(that'?s|it'?s|you)\b/i,
	/\b(wait|hold on),?\s+(no|that|you)\b/i,
];
