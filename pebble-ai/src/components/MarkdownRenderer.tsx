import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const blocks = splitCodeBlocks(content);

  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200 break-words">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return <CodeBlock key={index} language={block.language} code={block.content} />;
        }
        return <ProseBlock key={index} text={block.content} />;
      })}
    </div>
  );
};

interface Block {
  type: 'text' | 'code';
  language?: string;
  content: string;
}

function splitCodeBlocks(raw: string): Block[] {
  const regex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  const result: Block[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', content: raw.slice(lastIndex, match.index) });
    }
    result.push({
      type: 'code',
      language: match[1] || 'text',
      content: match[2].replace(/\n$/, ''),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    result.push({ type: 'text', content: raw.slice(lastIndex) });
  }
  return result;
}

const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/10 bg-neutral-900/90 text-xs text-neutral-400">
        <span className="font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code block"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-neutral-300 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[13px] leading-6 font-mono text-neutral-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const ProseBlock: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={i} className="font-display font-semibold text-base text-neutral-950 dark:text-white pt-1">
              {renderInline(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={i} className="font-display font-semibold text-lg text-neutral-950 dark:text-white pt-1.5">
              {renderInline(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={i} className="font-display font-semibold text-xl text-neutral-950 dark:text-white pt-2">
              {renderInline(trimmed.slice(2))}
            </h2>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="text-emerald-600 dark:text-emerald-400 mt-1 select-none">•</span>
              <span className="flex-1">{renderInline(trimmed.slice(2))}</span>
            </div>
          );
        }
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
                {numMatch[1]}.
              </span>
              <span className="flex-1">{renderInline(numMatch[2])}</span>
            </div>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
};

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-neutral-200/80 dark:bg-white/10 font-mono text-[13px] text-emerald-800 dark:text-emerald-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-neutral-950 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={idx} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}
