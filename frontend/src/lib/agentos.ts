const DEFAULT_AGENTOS_URL = "http://localhost:7777";
const DEFAULT_TEAM_ID = "productstudioteam";

const AGENTOS_URL = process.env.NEXT_PUBLIC_AGENTOS_URL || DEFAULT_AGENTOS_URL;
const TEAM_ID = process.env.NEXT_PUBLIC_AGENTOS_TEAM_ID || DEFAULT_TEAM_ID;

type SendMessageOptions = {
  message: string;
  files?: File[];
  sessionId?: string | null;
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
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (Array.isArray(record.content)) {
      return record.content.map(extractTextFromContent).filter(Boolean).join("\n");
    }
    return JSON.stringify(record);
  }
  return String(content);
};

export const sendMessageToAgentOS = async ({
  message,
  files,
  sessionId,
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
  let observedSessionId = sessionId || undefined;
  let runId: string | undefined;

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
          aggregatedText += extractTextFromContent(
            (data as Record<string, unknown>).content
          );
        }
      }

      if (type === "TeamRunCompleted") {
        if (data && typeof data === "object" && "content" in data) {
          const completedText = extractTextFromContent(
            (data as Record<string, unknown>).content
          );
          if (completedText.trim()) {
            aggregatedText = completedText;
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

  return {
    text: aggregatedText.trim(),
    sessionId: observedSessionId,
    runId,
  };
};
