"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight } from "lucide-react";
import { RESEARCH_AGENT_ID, VISUAL_AGENT_ID, sendMessageToAgentOS } from "@/lib/agentos";

const splitDebugInfo = (raw: string | null) => {
  if (!raw) {
    return { body: "", identifiers: "" };
  }
  const marker = "\n\n---\nIdentifiers seen:";
  const idx = raw.indexOf(marker);
  if (idx === -1) {
    return { body: raw.trim(), identifiers: "" };
  }
  const body = raw.slice(0, idx).trim();
  const identifiers = raw.slice(idx + marker.length).trim();
  return { body, identifiers };
};

const formatMarkdownWithCitations = (raw: string): string => {
  if (!raw) {
    return "";
  }

  const citations = new Map<string, string>();
  const definitionRegex = /^\[(\d+)\]:\s*(\S+)(.*)$/gm;

  let cleaned = raw.replace(definitionRegex, (_, id: string, url: string) => {
    citations.set(id, url);
    return "";
  });

  cleaned = cleaned.replace(/\[(\d+)\](?!\()/g, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  cleaned = cleaned.replace(/ \./g, ".");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  if (citations.size) {
    const citationLines = Array.from(citations.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, url]) => `[${id}] - ${url}`);
    cleaned = `${cleaned}\n\n**Citations**\n${citationLines.join("\n")}`;
  }

  return cleaned;
};

const extractImageUrls = (markdown: string): string[] => {
  const urls = new Set<string>();
  const imageRegex = /!\[[^\]]*?\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(markdown)) !== null) {
    urls.add(match[1]);
  }
  if (!urls.size) {
    const directRegex = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif))/gi;
    while ((match = directRegex.exec(markdown)) !== null) {
      urls.add(match[1]);
    }
  }
  return Array.from(urls).slice(0, 3);
};

const markdownComponents = {
  a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
    >
      {children}
    </a>
  ),
};

export default function Home() {
  const [input, setInput] = useState("");
  const [idea, setIdea] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingVisuals, setIsGeneratingVisuals] = useState(false);
  const [researchBody, setResearchBody] = useState<string | null>(null);
  const [researchIdentifiers, setResearchIdentifiers] = useState("");
  const [visualBody, setVisualBody] = useState<string | null>(null);
  const [visualIdentifiers, setVisualIdentifiers] = useState("");
  const [visualImages, setVisualImages] = useState<string[]>([]);
  const [showApprovalPrompt, setShowApprovalPrompt] = useState(false);
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [revisionInput, setRevisionInput] = useState("");

  const hasResearch = Boolean(researchBody);
  const hasVisuals = Boolean(visualBody) || visualImages.length > 0;

  const processedResearch = useMemo(
    () => formatMarkdownWithCitations(researchBody ?? ""),
    [researchBody]
  );

  const processedVisual = useMemo(
    () => formatMarkdownWithCitations(visualBody ?? ""),
    [visualBody]
  );

  const resetVisualState = () => {
    setVisualBody(null);
    setVisualIdentifiers("");
    setVisualImages([]);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setShowApprovalPrompt(false);
    setShowRevisionInput(false);
    setResearchBody(null);
    setResearchIdentifiers("");
    resetVisualState();

    try {
      const prompt = `Please run stage-gated viability research as ResearchAgent for this product idea: "${message}". Respond with the updated ResearchAgent report in markdown.`;
      const result = await sendMessageToAgentOS({
        message: prompt,
        sessionId,
        targetMemberId: RESEARCH_AGENT_ID,
      });

      setSessionId(result.sessionId ?? sessionId);
      setIdea(message);
      setInput("");

      const parsed = splitDebugInfo(result.text || "");
      const body = parsed.body || "ResearchAgent did not return any content.";
      setResearchBody(body);
      setResearchIdentifiers(parsed.identifiers);
      setShowApprovalPrompt(true);
    } catch (error) {
      console.error("AgentOS chat error", error);
      const fallback =
        error instanceof Error ? error.message : "We ran into an unexpected issue.";
      setResearchBody(`Error: ${fallback}`);
      setResearchIdentifiers("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (isGeneratingVisuals) {
      return;
    }
    resetVisualState();
    setIsGeneratingVisuals(true);
    setShowApprovalPrompt(false);

    try {
      const prompt = `
Move the workflow forward to visuals and delegate to VisualAgent for the concept "${idea}".
Provide exactly three distinct image mockups in markdown, each using the ![caption](url) syntax with a real or representative image URL.
Keep captions short and descriptive. Also include any supporting notes from VisualAgent in markdown.
      `.trim();

      const result = await sendMessageToAgentOS({
        message: prompt,
        sessionId,
        targetMemberId: VISUAL_AGENT_ID,
      });

      setSessionId(result.sessionId ?? sessionId);

      const parsed = splitDebugInfo(result.text || "");
      setVisualBody(parsed.body);
      setVisualIdentifiers(parsed.identifiers);
      const urls = extractImageUrls(parsed.body);
      setVisualImages(urls);
    } catch (error) {
      console.error("Visual generation error", error);
      const fallback =
        error instanceof Error ? error.message : "We ran into an unexpected issue while generating visuals.";
      setVisualBody(`Error: ${fallback}`);
      setVisualIdentifiers("");
    } finally {
      setIsGeneratingVisuals(false);
    }
  };

  const handleReject = () => {
    setShowApprovalPrompt(false);
    setShowRevisionInput(true);
    resetVisualState();
  };

  const handleRevisionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const feedback = revisionInput.trim();
    if (!feedback || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setShowRevisionInput(false);
    setShowApprovalPrompt(false);
    setResearchBody(null);
    setResearchIdentifiers("");
    resetVisualState();

    try {
      const prompt = `
Re-run viability research as ResearchAgent.
Previous concept: "${idea}".
User feedback for changes: "${feedback}".
Update the concept accordingly and provide the refreshed ResearchAgent report in markdown.
      `.trim();

      const result = await sendMessageToAgentOS({
        message: prompt,
        sessionId,
        targetMemberId: RESEARCH_AGENT_ID,
      });

      setSessionId(result.sessionId ?? sessionId);
      setIdea(`${idea} (update: ${feedback})`);
      setRevisionInput("");

      const parsed = splitDebugInfo(result.text || "");
      const body = parsed.body || "ResearchAgent did not return any content.";
      setResearchBody(body);
      setResearchIdentifiers(parsed.identifiers);
      setShowApprovalPrompt(true);
    } catch (error) {
      console.error("AgentOS chat error", error);
      const fallback =
        error instanceof Error ? error.message : "We ran into an unexpected issue.";
      setResearchBody(`Error: ${fallback}`);
      setResearchIdentifiers("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(125%_125%_at_50%_101%,rgba(245,87,2,1)_10.5%,rgba(245,120,2,1)_16%,rgba(245,140,2,1)_17.5%,rgba(245,170,100,1)_25%,rgba(238,174,202,1)_40%,rgba(202,179,214,1)_65%,rgba(148,201,233,1)_100%)] flex flex-col items-center justify-start py-12">
      {isSubmitting && !hasResearch ? (
        <div className="mt-20 flex flex-col items-center justify-center gap-4">
          <div className="h-32 w-32 rounded-full border-4 border-white/40 border-t-white animate-spin-slow" />
          <p className="text-white text-xl tracking-wide uppercase">processing</p>
        </div>
      ) : null}

      {!hasResearch && !isSubmitting && (
        <form
          onSubmit={handleSubmit}
          className="relative w-full max-w-xl px-6"
        >
          <input
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="describe your product idea"
            className="w-full rounded-full border border-white/40 bg-white/10 px-6 py-4 pr-20 text-lg text-white placeholder:text-white/70 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-white/80"
            disabled={isSubmitting}
          />
          <button
            type="submit"
            className="absolute right-9 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-900 shadow-lg hover:bg-white/90 disabled:opacity-40 disabled:hover:bg-white"
            disabled={!input.trim()}
          >
            <ArrowRight className="h-5 w-5" />
          </button>
        </form>
      )}

      {hasResearch && (
        <div className="mt-10 w-full max-w-3xl px-6 space-y-6">
          <div className="max-h-[60vh] overflow-y-auto rounded-3xl border border-white/40 bg-white/50 p-6 text-black backdrop-blur-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {processedResearch}
            </ReactMarkdown>
          </div>
          {researchIdentifiers && (
            <p className="text-xs text-white/60">Debug identifiers: {researchIdentifiers}</p>
          )}

          {showApprovalPrompt && !isGeneratingVisuals && !showRevisionInput && (
            <div className="mt-4 flex flex-col items-start gap-4">
              <span className="text-lg font-medium text-white">Do you like this?</span>
              <div className="flex gap-4">
                <button
                  onClick={handleApprove}
                  className="rounded-full bg-white/90 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-gray-900 shadow hover:bg-white"
                >
                  Yes
                </button>
                <button
                  onClick={handleReject}
                  className="rounded-full bg-white/20 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-white shadow hover:bg-white/30"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {showRevisionInput && (
            <form onSubmit={handleRevisionSubmit} className="space-y-3">
              <textarea
                value={revisionInput}
                onChange={event => setRevisionInput(event.target.value)}
                placeholder="Tell us what you’d like to change..."
                className="min-h-[120px] w-full rounded-3xl border border-white/40 bg-white/80 px-5 py-4 text-base text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-white/60"
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="rounded-full bg-white/90 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-gray-900 shadow hover:bg-white"
                >
                  Update viability
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRevisionInput(false);
                    setShowApprovalPrompt(true);
                  }}
                  className="rounded-full bg-white/20 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-white shadow hover:bg-white/30"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {isGeneratingVisuals && (
            <div className="flex flex-col items-center justify-center gap-3 text-white">
              <div className="h-16 w-16 rounded-full border-4 border-white/40 border-t-white animate-spin-slow" />
              <p className="text-sm uppercase tracking-wide">visualising</p>
            </div>
          )}

          {hasVisuals && (
            <div className="space-y-5">
              {visualImages.length > 0 && (
                <div className="flex flex-col gap-4 md:flex-row">
                  {visualImages.map((url, index) => (
                    <div
                      key={`${url}-${index}`}
                      className="flex-1 overflow-hidden rounded-3xl border border-white/30 bg-white/20"
                    >
                      <img
                        src={url}
                        alt={`Visual concept ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
              {visualBody && (
                <div className="rounded-3xl border border-white/40 bg-white/50 p-6 text-black backdrop-blur-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {processedVisual}
                  </ReactMarkdown>
                </div>
              )}
              {visualIdentifiers && (
                <p className="text-xs text-white/60">Debug identifiers: {visualIdentifiers}</p>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
