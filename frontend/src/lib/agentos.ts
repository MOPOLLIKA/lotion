const DEFAULT_AGENTOS_URL = "http://localhost:7777";
const DEFAULT_TEAM_ID = "productstudioteam";

export const RESEARCH_AGENT_ID = "researchagent";
export const VISUAL_AGENT_ID = "visualagent";
export const PRODUCT_AGENT_ID = "productagent";

const AGENTOS_URL = process.env.NEXT_PUBLIC_AGENTOS_URL || DEFAULT_AGENTOS_URL;
const TEAM_ID = process.env.NEXT_PUBLIC_AGENTOS_TEAM_ID || DEFAULT_TEAM_ID;

type SendMessageOptions = {
  message: string;
  files?: File[];
  sessionId?: string | null;
  targetMemberId?: string | null;
};

export type AgentOSChatResult = {
  text: string;
  sessionId?: string;
  runId?: string;
};

type ParsedSSEEvent = {
  type: string;
  data: unknown;
};

const parseSSEEvent = (rawEvent: string): ParsedSSEEvent | null => {
  if (!rawEvent.trim()) {
    return null;
  }

  const lines = rawEvent.split("\n");
  let type = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const dataString = dataLines.join("\n");

  if (!dataString) {
    return { type, data: null };
  }

  try {
    return {
      type,
      data: JSON.parse(dataString),
    };
  } catch (error) {
    console.error("Failed to parse SSE data", error, dataString);
    return { type, data: dataString };
  }
};

const extractTextFromContent = (content: unknown): string => {
  if (content === null || content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(extractTextFromContent).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    const record = content as Record<string, unknown>;

    const candidates: Array<string | undefined> = [
      typeof record.text === "string" ? record.text : undefined,
      typeof record.content === "string" ? record.content : undefined,
      typeof record.response === "string" ? record.response : undefined,
      typeof record.output === "string" ? record.output : undefined,
    ];

    if (Array.isArray(record.content)) {
      candidates.push((record.content as unknown[]).map(extractTextFromContent).filter(Boolean).join("\n"));
    }
    if (Array.isArray(record.messages)) {
      candidates.push((record.messages as unknown[]).map(extractTextFromContent).filter(Boolean).join("\n"));
    }
    if (Array.isArray(record.parts)) {
      candidates.push((record.parts as unknown[]).map(extractTextFromContent).filter(Boolean).join("\n"));
    }

    const preferred = candidates.find((value): value is string => typeof value === "string" && value.trim() !== "");
    if (preferred) {
      return preferred;
    }

    if (record.content && typeof record.content === "object") {
      return extractTextFromContent(record.content);
    }

    return JSON.stringify(record);
  }
  return String(content);
};

const containsCoordinatorCommand = (text: string): boolean =>
  /\bcall\s+[a-z_]+\(/i.test(text) || /\bdelegate_task_to_member\b/i.test(text);

const sanitizeCoordinatorText = (text: string): string =>
  text
    .split("\n")
    .map(line => line.trim())
    .filter(line => {
      if (!line) {
        return false;
      }
      const lower = line.toLowerCase();
      if (containsCoordinatorCommand(line)) {
        return false;
      }
      if (/^calling\b/i.test(line)) {
        return false;
      }
      if (lower.startsWith("coordinator") || lower.startsWith("coordinatorpm")) {
        return false;
      }
      if (lower.startsWith("system:")) {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();

type MemberResponse = Record<string, unknown>;

const normalizeIdentifier = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const extractMemberIdentifier = (response: MemberResponse): string => {
  for (const key of ["member_id", "agent_id", "name", "id"]) {
    const value = response[key];
    if (typeof value === "string" && value.trim()) {
      return value.toLowerCase();
    }
  }
  return "";
};

const extractMemberText = (response: MemberResponse): string => {
  const chunks: string[] = [];

  if (response.response !== undefined) {
    chunks.push(extractTextFromContent(response.response));
  }
  if (response.output !== undefined) {
    chunks.push(extractTextFromContent(response.output));
  }
  if (response.content !== undefined) {
    chunks.push(extractTextFromContent(response.content));
  }
  if (Array.isArray(response.messages)) {
    chunks.push(
      (response.messages as unknown[])
        .map(item => extractTextFromContent(item))
        .filter(Boolean)
        .join("\n")
    );
  }

  if (!chunks.length) {
    chunks.push(extractTextFromContent(response));
  }

  return chunks.filter(Boolean).join("\n");
};

export const sendMessageToAgentOS = async ({
  message,
  files,
  sessionId,
  targetMemberId,
}: SendMessageOptions): Promise<AgentOSChatResult> => {
  if (!message.trim()) {
    throw new Error("Message cannot be empty.");
  }

  const formData = new FormData();
  formData.append("message", message);
  formData.append("stream", "true");
  formData.append("monitor", "true");

  if (sessionId) {
    formData.append("session_id", sessionId);
  }

  for (const file of files || []) {
    formData.append("files", file);
  }

  const response = await fetch(`${AGENTOS_URL}/teams/${TEAM_ID}/runs`, {
    method: "POST",
    body: formData,
    headers: {
      Accept: "text/event-stream",
    },
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `AgentOS request failed with status ${response.status}. ${errorText}`
    );
  }

  const reader = response.body.getReader();
  const textDecoder = new TextDecoder();
  let buffer = "";
  let aggregatedText = "";
  const memberOutputs = new Map<string, string[]>();
  const memberIdentifiers: string[] = [];
  let observedSessionId = sessionId || undefined;
  let runId: string | undefined;
  const targetId = normalizeIdentifier(targetMemberId ?? RESEARCH_AGENT_ID);

  const noteMemberResponses = (responses: unknown) => {
    const list = Array.isArray(responses) ? responses : [responses];
    list.forEach(item => {
      if (!item || typeof item !== "object") {
        return;
      }
      const entry = item as MemberResponse;
      const identifier = extractMemberIdentifier(entry) || "(unknown)";
      const normalizedId = identifier === "(unknown)" ? "(unknown)" : normalizeIdentifier(identifier);
      const cleaned = sanitizeCoordinatorText(extractMemberText(entry).trim());
      if (!cleaned) {
        return;
      }

      memberIdentifiers.push(identifier);

      const outputs = memberOutputs.get(normalizedId) ?? [];
      outputs.push(cleaned);
      memberOutputs.set(normalizedId, outputs);

      if ((entry as MemberResponse).member_responses !== undefined) {
        noteMemberResponses((entry as MemberResponse).member_responses);
      }
    });
  };

  const processBuffer = () => {
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      separatorIndex = buffer.indexOf("\n\n");

      const parsedEvent = parseSSEEvent(rawEvent);
      if (!parsedEvent) {
        continue;
      }

      const { type, data } = parsedEvent;

      if (data && typeof data === "object") {
        if (!observedSessionId && typeof (data as Record<string, unknown>).session_id === "string") {
          observedSessionId = (data as Record<string, unknown>).session_id as string;
        }
        if (!runId && typeof (data as Record<string, unknown>).run_id === "string") {
          runId = (data as Record<string, unknown>).run_id as string;
        }
      }

      if (type === "TeamRunError") {
        const errorMessage =
          data &&
          typeof data === "object" &&
          "content" in data &&
          typeof (data as Record<string, unknown>).content === "string"
            ? ((data as Record<string, unknown>).content as string)
            : "Team run failed.";
        throw new Error(errorMessage);
      }

      if (type === "TeamRunContent") {
        if (data && typeof data === "object" && "content" in data) {
          aggregatedText += `\n${extractTextFromContent((data as Record<string, unknown>).content)}`;
        }
        if (data && typeof data === "object" && "member_responses" in data) {
          noteMemberResponses((data as Record<string, unknown>).member_responses);
        }
      }

      if (type === "TeamRunCompleted") {
        if (data && typeof data === "object") {
          const record = data as Record<string, unknown>;
          if ("member_responses" in record) {
            noteMemberResponses(record.member_responses);
          }
          if ("content" in record) {
            const completedText = extractTextFromContent(record.content);
            if (completedText.trim()) {
              aggregatedText = completedText;
            }
          }
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done || !value) {
      buffer += textDecoder.decode();
      break;
    }

    buffer += textDecoder.decode(value, { stream: true });
    processBuffer();
  }

  processBuffer();

  const targetOutputs = memberOutputs.get(targetId) ?? [];
  const cleanedTargetOutputs = targetOutputs.filter(Boolean);

  const fallbackOutputs = Array.from(memberOutputs.entries())
    .filter(([identifier]) => identifier !== targetId)
    .flatMap(([, outputs]) => outputs)
    .filter(Boolean);

  const coordinatorFallback = sanitizeCoordinatorText(aggregatedText);

  const finalText = cleanedTargetOutputs.length
    ? cleanedTargetOutputs.join("\n\n")
    : fallbackOutputs.length
      ? fallbackOutputs.join("\n\n")
      : coordinatorFallback;

  const identifiersDisplay = Array.from(new Set(memberIdentifiers)).join(", ");

  return {
    text: `${finalText.trim()}\n\n---\nIdentifiers seen: ${identifiersDisplay}`,
    sessionId: observedSessionId,
    runId,
  };
};
