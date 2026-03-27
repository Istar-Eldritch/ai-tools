You are classifying user intent in a discovery conversation.

The user has just responded to a discovery assumption. Determine whether they want to:
- CONTINUE: Keep exploring more assumptions and requirements
- TRANSITION: Move on to the next phase (drafting the spec)

## User Response

{user_input}

## Exchange Count

{exchange_count} exchanges so far (minimum: {min_exchanges})

## Classification Rules

- If the user explicitly says to move on, draft, proceed, or similar: TRANSITION
- If the user asks a follow-up question or provides detailed feedback: CONTINUE
- If the user gives a brief acknowledgment with no new questions: lean toward TRANSITION if exchange count >= minimum
- If exchange count < minimum: always CONTINUE regardless of user signal

Output ONLY one word: CONTINUE or TRANSITION
