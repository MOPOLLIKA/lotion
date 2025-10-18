"use client";

import { FormEvent, useState } from "react";
import { ArrowRight } from "lucide-react";
import { sendMessageToAgentOS } from "@/lib/agentos";

export default function Home() {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const prompt = `Run viability research as ResearchAgent for this idea: ${message}`;
      const result = await sendMessageToAgentOS({ message: prompt });
      console.info("ResearchAgent response:", result);
      setInput("");
    } catch (error) {
      console.error("AgentOS chat error", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(125%_125%_at_50%_101%,rgba(245,87,2,1)_10.5%,rgba(245,120,2,1)_16%,rgba(245,140,2,1)_17.5%,rgba(245,170,100,1)_25%,rgba(238,174,202,1)_40%,rgba(202,179,214,1)_65%,rgba(148,201,233,1)_100%)] flex items-center justify-center">
      {isSubmitting ? (
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="h-32 w-32 rounded-full border-4 border-white/40 border-t-white animate-spin-slow" />
          <p className="text-white text-xl tracking-wide uppercase">roasting</p>
        </div>
      ) : (
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
    </main>
  );
}
