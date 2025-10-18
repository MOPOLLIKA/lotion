"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight } from "lucide-react";
import {
  PRODUCT_AGENT_ID,
  RESEARCH_AGENT_ID,
  VISUAL_AGENT_ID,
  sendMessageToAgentOS,
} from "@/lib/agentos";

type VisualOption = {
  id: string;
  url: string;
  title: string;
};

const PLACEHOLDER_IMAGE = "/assets/soap.jpg";
const PLACEHOLDER_VISUAL_MESSAGE =
  "VisualAgent placeholder output. Real visuals will appear here once the agent is wired up.";

const USE_VISUAL_AGENT = false;

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

const createPlaceholderVisuals = (): VisualOption[] =>
  Array.from({ length: 3 }, (_, index) => ({
    id: `placeholder-${Date.now()}-${index}`,
    url: PLACEHOLDER_IMAGE,
    title: `Concept ${index + 1}`,
  }));

export default function Home() {
  const [input, setInput] = useState("");
  const [idea, setIdea] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingVisuals, setIsGeneratingVisuals] = useState(false);
  const [isGeneratingProduct, setIsGeneratingProduct] = useState(false);

  const [researchBody, setResearchBody] = useState<string | null>(null);
  const [researchIdentifiers, setResearchIdentifiers] = useState("");

  const [visualBody, setVisualBody] = useState<string | null>(null);
  const [visualIdentifiers, setVisualIdentifiers] = useState("");
  const [visualOptions, setVisualOptions] = useState<VisualOption[]>([]);
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);
  const [showVisualChoicePrompt, setShowVisualChoicePrompt] = useState(false);
  const [showVisualSatisfactionPrompt, setShowVisualSatisfactionPrompt] = useState(false);
  const [showVisualRevisionInput, setShowVisualRevisionInput] = useState(false);
  const [visualRevisionInput, setVisualRevisionInput] = useState("");

  const [productBody, setProductBody] = useState<string | null>(null);
  const [productIdentifiers, setProductIdentifiers] = useState("");

  const [showResearchApprovalPrompt, setShowResearchApprovalPrompt] = useState(false);
  const [showResearchRevisionInput, setShowResearchRevisionInput] = useState(false);
  const [researchRevisionInput, setResearchRevisionInput] = useState("");

  const hasResearch = Boolean(researchBody);
  const hasVisuals = visualOptions.length > 0 || Boolean(visualBody);
  const hasProduct = Boolean(productBody);
  const shouldCenterPrompt = !hasResearch && !isSubmitting;
  const selectedVisual = useMemo(
    () => visualOptions.find(option => option.id === selectedVisualId) ?? null,
    [visualOptions, selectedVisualId]
  );

  const processedResearch = useMemo(
    () => formatMarkdownWithCitations(researchBody ?? ""),
    [researchBody]
  );
  const processedVisual = useMemo(
    () => formatMarkdownWithCitations(visualBody ?? ""),
    [visualBody]
  );
  const processedProduct = useMemo(
    () => formatMarkdownWithCitations(productBody ?? ""),
    [productBody]
  );

  const resetVisualState = () => {
    setVisualBody(null);
    setVisualIdentifiers("");
    setVisualOptions([]);
    setSelectedVisualId(null);
    setShowVisualChoicePrompt(false);
    setShowVisualSatisfactionPrompt(false);
    setShowVisualRevisionInput(false);
    setVisualRevisionInput("");
  };

  const resetProductState = () => {
    setProductBody(null);
    setProductIdentifiers("");
    setIsGeneratingProduct(false);
  };

  const runVisualAgent = async ({
    priorVisualId,
    feedback,
  }: {
    priorVisualId?: string | null;
    feedback?: string;
  }) => {
    const placeholder = createPlaceholderVisuals();

    if (!USE_VISUAL_AGENT) {
      setVisualBody(PLACEHOLDER_VISUAL_MESSAGE);
      setVisualIdentifiers(`${VISUAL_AGENT_ID} (placeholder)`);
      setVisualOptions(placeholder);
      setShowVisualChoicePrompt(true);
      setShowVisualSatisfactionPrompt(false);
      setShowVisualRevisionInput(false);
      setSelectedVisualId(null);
      return;
    }

    const basePrompt = `
Move the workflow forward to visuals and delegate to VisualAgent for the concept "${idea}".
Provide exactly three distinct image mockups in markdown, each using the ![caption](url) syntax with a real or representative image URL.
Keep captions short and descriptive. Also include any supporting notes from VisualAgent in markdown.
    `.trim();

    const revisionPrompt = priorVisualId
      ? `
We previously selected visual option "${priorVisualId}" for the concept "${idea}".
Please revise the visuals based on this user feedback: "${feedback}".
Return exactly three updated mockups in markdown, preserving the ![caption](url) format with real or representative image URLs.
      `.trim()
      : basePrompt;

    let parsed = { body: "", identifiers: "" };
    try {
      const result = await sendMessageToAgentOS({
        message: revisionPrompt,
        sessionId,
        targetMemberId: VISUAL_AGENT_ID,
      });
      setSessionId(result.sessionId ?? sessionId);
      parsed = splitDebugInfo(result.text || "");
    } catch (error) {
      console.error("Visual generation error", error);
      parsed = {
        body: `Error calling VisualAgent: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        identifiers: "",
      };
    }

    const urls = extractImageUrls(parsed.body);
    const options =
      urls.length >= 3
        ? urls.map((url, index) => ({
            id: `visual-${Date.now()}-${index}`,
            url,
            title: `Concept ${index + 1}`,
          }))
        : placeholder;

    setVisualBody(parsed.body || PLACEHOLDER_VISUAL_MESSAGE);
    setVisualIdentifiers(parsed.identifiers || `${VISUAL_AGENT_ID} (placeholder)`);
    setVisualOptions(options);
    setShowVisualChoicePrompt(true);
    setShowVisualSatisfactionPrompt(false);
    setShowVisualRevisionInput(false);
    setSelectedVisualId(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setShowResearchApprovalPrompt(false);
    setShowResearchRevisionInput(false);
    setResearchBody(null);
    setResearchIdentifiers("");
    resetVisualState();
    resetProductState();

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
      setShowResearchApprovalPrompt(true);
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

  const handleResearchApprove = async () => {
    if (isGeneratingVisuals) {
      return;
    }
    setShowResearchApprovalPrompt(false);
    setShowResearchRevisionInput(false);
    resetVisualState();
    resetProductState();
    setIsGeneratingVisuals(true);

    try {
      await runVisualAgent({});
    } finally {
      setIsGeneratingVisuals(false);
    }
  };

  const handleResearchReject = () => {
    setShowResearchApprovalPrompt(false);
    setShowResearchRevisionInput(true);
    resetVisualState();
    resetProductState();
  };

  const handleResearchRevisionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const feedback = researchRevisionInput.trim();
    if (!feedback || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setShowResearchRevisionInput(false);
    setShowResearchApprovalPrompt(false);
    setResearchBody(null);
    setResearchIdentifiers("");
    resetVisualState();
    resetProductState();

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
      setResearchRevisionInput("");

      const parsed = splitDebugInfo(result.text || "");
      const body = parsed.body || "ResearchAgent did not return any content.";
      setResearchBody(body);
      setResearchIdentifiers(parsed.identifiers);
      setShowResearchApprovalPrompt(true);
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

  const handleSelectVisual = (optionId: string) => {
    setSelectedVisualId(optionId);
    setShowVisualSatisfactionPrompt(true);
    setShowVisualRevisionInput(false);
  };

  const handleVisualReject = () => {
    setShowVisualSatisfactionPrompt(false);
    setShowVisualRevisionInput(true);
    setVisualRevisionInput("");
    resetProductState();
  };

  const handleVisualRevisionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedVisualId) {
      return;
    }
    const feedback = visualRevisionInput.trim();
    if (!feedback) {
      return;
    }

    setIsGeneratingVisuals(true);
    setShowVisualRevisionInput(false);
    setShowVisualSatisfactionPrompt(false);
    resetVisualState();
    resetProductState();

    try {
      await runVisualAgent({ priorVisualId: selectedVisualId, feedback });
    } finally {
      setIsGeneratingVisuals(false);
    }
  };

  const handleVisualApprove = async () => {
    if (!selectedVisualId || isGeneratingProduct) {
      return;
    }

    setIsGeneratingProduct(true);
    setShowVisualSatisfactionPrompt(false);
    setShowVisualRevisionInput(false);

    const visualSummary = selectedVisual
      ? [
          `Selected visual nickname: ${selectedVisual.title}`,
          `Selected visual image URL: ${selectedVisual.url}`,
        ].join("\n")
      : "Selected visual details could not be determined from the UI state.";

    const researchSummary = researchBody?.trim() || "ResearchAgent did not provide a summary.";
    const visualNotes = visualBody?.trim() || "VisualAgent did not provide supporting notes.";

    try {
      const prompt = `
Move the workflow forward to spec and delegate to ProductAgent.
Concept: "${idea}".
${visualSummary}

Here is the approved viability research report:
${researchSummary}

Here are the VisualAgent notes for the chosen direction:
${visualNotes}

Provide a detailed product spec in markdown that includes:
- value proposition, target user, and success criteria.
- bill of materials table with estimated cost targets.
- compliance or testing watch-outs.
- a numbered "Build Instructions" section with step-by-step guidance to create the product end-to-end.
- key risks plus next actions that remain on the team.
      `.trim();

      const result = await sendMessageToAgentOS({
        message: prompt,
        sessionId,
        targetMemberId: PRODUCT_AGENT_ID,
      });

      setSessionId(result.sessionId ?? sessionId);

      const parsed = splitDebugInfo(result.text || "");
      const body = parsed.body || "ProductAgent did not return any content.";
      setProductBody(body);
      setProductIdentifiers(parsed.identifiers);
    } catch (error) {
      console.error("ProductAgent error", error);
      const fallback =
        error instanceof Error ? error.message : "We ran into an unexpected issue while drafting the spec.";
      setProductBody(`Error: ${fallback}`);
      setProductIdentifiers("");
    } finally {
      setIsGeneratingProduct(false);
    }
  };

  return (
    <main
      className={`min-h-screen bg-[radial-gradient(125%_125%_at_50%_101%,rgba(245,87,2,1)_10.5%,rgba(245,120,2,1)_16%,rgba(245,140,2,1)_17.5%,rgba(245,170,100,1)_25%,rgba(238,174,202,1)_40%,rgba(202,179,214,1)_65%,rgba(148,201,233,1)_100%)] flex flex-col items-center ${
        shouldCenterPrompt ? "justify-center" : "justify-start py-12"
      }`}
    >
      {!hasResearch && !isSubmitting && (
        <form
          onSubmit={handleSubmit}
          className="relative w-full max-w-xl px-6"
        >
          <input
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="describe your product idea"
            className="w-full rounded-full border border-white/40 bg-white/10 px-6 py-4 pr-20 text-lg text-black placeholder:text-black/70 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-white/80"
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

      {isSubmitting && !hasResearch && (
        <div className="mt-20 flex flex-col items-center justify-center gap-4">
          <div className="h-32 w-32 rounded-full border-4 border-white/40 border-t-white animate-spin-slow" />
          <p className="text-black text-xl tracking-wide uppercase">processing</p>
        </div>
      )}

          {hasResearch && (
            <div className="mt-10 w-full max-w-3xl px-6 space-y-6">
              <div className="space-y-1">
                <p className="text-lg font-semibold text-black">Viability research summary</p>
                <p className="text-sm text-black/70">
                  ResearchAgent’s grounded findings and approval prompts.
                </p>
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-3xl border border-white/40 bg-white/50 p-6 text-black backdrop-blur-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {processedResearch}
                </ReactMarkdown>
              </div>
          {researchIdentifiers && (
            <p className="text-xs text-black/60">Debug identifiers: {researchIdentifiers}</p>
          )}

          {showResearchApprovalPrompt && (
            <div className="mt-4 flex flex-col items-start gap-4">
              <span className="text-lg font-medium text-black">Do you like this?</span>
              <div className="flex gap-4">
                <button
                  onClick={handleResearchApprove}
                  className="rounded-full bg-white/90 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-gray-900 shadow hover:bg-white"
                >
                  Yes
                </button>
                <button
                  onClick={handleResearchReject}
                  className="rounded-full bg-white/20 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-black shadow hover:bg-white/30"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {showResearchRevisionInput && (
            <form onSubmit={handleResearchRevisionSubmit} className="space-y-3">
              <textarea
                value={researchRevisionInput}
                onChange={event => setResearchRevisionInput(event.target.value)}
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
                    setShowResearchRevisionInput(false);
                    setShowResearchApprovalPrompt(true);
                  }}
                  className="rounded-full bg-white/20 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-black shadow hover:bg-white/30"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {isGeneratingVisuals && (
            <div className="flex flex-col items-center justify-center gap-3 text-black">
              <div className="h-16 w-16 rounded-full border-4 border-white/40 border-t-white animate-spin-slow" />
              <p className="text-sm uppercase tracking-wide">visualising</p>
            </div>
          )}

          {hasVisuals && (
            <div className="space-y-6">
              {showVisualChoicePrompt && (
                <p className="text-lg font-medium text-black">Which one do you like the most?</p>
              )}

              <div className="flex flex-col items-center gap-4 md:flex-row md:justify-center">
                {visualOptions.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleSelectVisual(option.id)}
                    className={`overflow-hidden rounded-3xl border-4 transition-all ${
                      selectedVisualId === option.id ? "border-white shadow-lg" : "border-transparent"
                    }`}
                  >
                    <img
                      src={option.url}
                      alt={option.title}
                      className="h-48 w-48 object-cover"
                    />
                  </button>
                ))}
              </div>

              {visualBody && (
                <div className="rounded-3xl border border-white/40 bg-white/50 p-6 text-black backdrop-blur-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {processedVisual}
                  </ReactMarkdown>
                </div>
              )}
              {visualIdentifiers && (
                <p className="text-xs text-black/60">Debug identifiers: {visualIdentifiers}</p>
              )}

              {showVisualSatisfactionPrompt && selectedVisualId && (
                <div className="flex flex-col gap-4">
                  <span className="text-lg font-medium text-black">Are you satisfied with the result?</span>
                  <div className="flex gap-4">
                    <button
                      onClick={handleVisualApprove}
                      className="rounded-full bg-white/90 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-gray-900 shadow hover:bg-white"
                    >
                      Yes
                    </button>
                    <button
                      onClick={handleVisualReject}
                      className="rounded-full bg-white/20 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-black shadow hover:bg-white/30"
                    >
                      No
                    </button>
                  </div>
                </div>
              )}

              {showVisualRevisionInput && selectedVisualId && (
                <form onSubmit={handleVisualRevisionSubmit} className="space-y-3">
                  <textarea
                    value={visualRevisionInput}
                    onChange={event => setVisualRevisionInput(event.target.value)}
                    placeholder="Tell us how to tweak the visuals..."
                    className="min-h-[120px] w-full rounded-3xl border border-white/40 bg-white/80 px-5 py-4 text-base text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-white/60"
                  />
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="rounded-full bg-white/90 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-gray-900 shadow hover:bg-white"
                    >
                      Regenerate visuals
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowVisualRevisionInput(false);
                        setShowVisualSatisfactionPrompt(true);
                      }}
                      className="rounded-full bg-white/20 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-black shadow hover:bg-white/30"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {isGeneratingProduct && (
            <div className="flex flex-col items-center justify-center gap-3 text-black">
              <div className="h-16 w-16 rounded-full border-4 border-white/40 border-t-white animate-spin-slow" />
              <p className="text-sm uppercase tracking-wide">drafting spec</p>
            </div>
          )}
          {hasProduct && (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-lg font-semibold text-black">Product spec & build plan</p>
                <p className="text-sm text-black/70">
                  Detailed specs with step-by-step build instructions.
                </p>
              </div>
              <div className="rounded-3xl border border-white/40 bg-white/50 p-6 text-black backdrop-blur-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {processedProduct}
                </ReactMarkdown>
              </div>
              {productIdentifiers && (
                <p className="text-xs text-black/60">Debug identifiers: {productIdentifiers}</p>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
