"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";

/**
 * Tiptap editor that posts its document JSON through a hidden input, so plain
 * server-action <form>s can carry rich text. Untouched = empty string = field
 * skipped by the action parser.
 */
export function RichTextEditor({ name, initial }: { name: string; initial?: unknown }) {
  const [json, setJson] = useState<string>(initial ? JSON.stringify(initial) : "");
  const editor = useEditor({
    extensions: [StarterKit],
    content: (initial as object | undefined) ?? "",
    immediatelyRender: false,
    onUpdate({ editor }) {
      setJson(JSON.stringify(editor.getJSON()));
    },
  });
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm [&_.tiptap]:min-h-16">
      <input type="hidden" name={name} value={json} />
      <EditorContent editor={editor} />
    </div>
  );
}
