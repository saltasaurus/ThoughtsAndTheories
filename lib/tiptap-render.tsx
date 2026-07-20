import type { ReactNode } from "react";

/** Minimal Tiptap-JSON renderer — never dangerouslySetInnerHTML on user content. */

type TiptapNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type: string }>;
  attrs?: { level?: number };
  content?: TiptapNode[];
};

function renderText(node: TiptapNode, key: number): ReactNode {
  let el: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") el = <strong key={key}>{el}</strong>;
    else if (mark.type === "italic") el = <em key={key}>{el}</em>;
    else if (mark.type === "strike") el = <s key={key}>{el}</s>;
    else if (mark.type === "code") el = <code key={key}>{el}</code>;
  }
  return <span key={key}>{el}</span>;
}

function renderNode(node: TiptapNode, key: number): ReactNode {
  const children = (node.content ?? []).map((c, i) => renderNode(c, i));
  switch (node.type) {
    case "text":
      return renderText(node, key);
    case "paragraph":
      return <p key={key} className="mb-2 last:mb-0">{children}</p>;
    case "heading":
      return <h4 key={key} className="mb-1 mt-2 font-medium">{children}</h4>;
    case "bulletList":
      return <ul key={key} className="mb-2 list-disc pl-5">{children}</ul>;
    case "orderedList":
      return <ol key={key} className="mb-2 list-decimal pl-5">{children}</ol>;
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return <blockquote key={key} className="mb-2 border-l-2 border-line pl-3 text-soft">{children}</blockquote>;
    case "codeBlock":
      return <pre key={key} className="mb-2 rounded bg-raised p-2 text-xs">{children}</pre>;
    case "hardBreak":
      return <br key={key} />;
    default:
      return <span key={key}>{children}</span>;
  }
}

export function TiptapContent({ doc }: { doc: unknown }) {
  if (typeof doc !== "object" || doc === null || (doc as TiptapNode).type !== "doc") {
    return null;
  }
  return <div className="text-sm">{((doc as TiptapNode).content ?? []).map((n, i) => renderNode(n, i))}</div>;
}
