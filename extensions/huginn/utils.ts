export function extractTextFromMessage(message: {
	content: string | unknown[];
}): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (Array.isArray(message.content)) {
		return message.content
			.filter(
				(block): block is { type: "text"; text: string } =>
					block !== null &&
					typeof block === "object" &&
					"type" in block &&
					block.type === "text" &&
					"text" in block &&
					typeof block.text === "string",
			)
			.map((block) => block.text)
			.join("\n");
	}
	return "";
}
