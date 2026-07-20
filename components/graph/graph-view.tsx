"use client";

import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CardType } from "@prisma/client";
import { CARD_TYPES } from "@/components/cards/type-colors";

// fcose registers a layout on the shared cytoscape singleton — do it once.
let fcoseRegistered = false;
function ensureFcose(): void {
  if (!fcoseRegistered) {
    cytoscape.use(fcose);
    fcoseRegistered = true;
  }
}

export type GraphNode = { id: string; title: string; type: CardType };
export type GraphEdge = {
  id: string;
  fromCardId: string;
  toCardId: string;
  type: string;
  weight: number;
  directed: boolean;
};

/** Reads the theme's card-type color from CSS vars so nodes track dark/light. */
function typeColor(type: string): string {
  if (typeof window === "undefined") return "#888";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${type.toLowerCase()}`)
    .trim();
  return v || "#888";
}
function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function GraphView({
  nodes,
  edges,
  truncated,
  seriesId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  seriesId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hidden, setHidden] = useState<Set<CardType>>(new Set());

  // Degree drives node size; neighbours drive the detail panel.
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.fromCardId, (d.get(e.fromCardId) ?? 0) + 1);
      d.set(e.toCardId, (d.get(e.toCardId) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  const neighbours = useMemo(() => {
    if (!selected) return [];
    const titleOf = new Map(nodes.map((n) => [n.id, n.title]));
    return edges
      .filter((e) => e.fromCardId === selected.id || e.toCardId === selected.id)
      .map((e) => {
        const otherId = e.fromCardId === selected.id ? e.toCardId : e.fromCardId;
        return { id: otherId, title: titleOf.get(otherId) ?? "?", type: e.type, weight: e.weight };
      });
  }, [selected, edges, nodes]);

  useEffect(() => {
    if (!containerRef.current) return;
    ensureFcose();

    const shownNodes = nodes.filter((n) => !hidden.has(n.type));
    const shownIds = new Set(shownNodes.map((n) => n.id));
    const shownEdges = edges.filter((e) => shownIds.has(e.fromCardId) && shownIds.has(e.toCardId));

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...shownNodes.map((n) => ({
          data: { id: n.id, title: n.title, type: n.type, deg: degree.get(n.id) ?? 0 },
        })),
        ...shownEdges.map((e) => ({
          data: {
            id: e.id,
            source: e.fromCardId,
            target: e.toCardId,
            weight: e.weight,
            directed: e.directed ? 1 : 0,
          },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele: cytoscape.NodeSingular) => typeColor(ele.data("type")),
            // a canvas-colored ring gives touching nodes a visible moat
            "border-width": 2,
            "border-color": cssVar("--canvas"),
            // isolated nodes recede so the connected structure reads clearly
            opacity: (ele: cytoscape.NodeSingular) => (ele.data("deg") === 0 ? 0.45 : 1),
            label: "data(title)",
            color: cssVar("--color-ink"),
            "font-size": 11,
            "font-weight": 600,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 5,
            "text-wrap": "ellipsis",
            "text-max-width": "116px",
            // chip behind the label keeps it readable over edges and neighbours
            "text-background-color": cssVar("--canvas"),
            "text-background-opacity": 0.8,
            "text-background-shape": "roundrectangle",
            "text-background-padding": "3px",
            "min-zoomed-font-size": 9, // hide labels when zoomed far out (declutter)
            // degree-based sizing; isolated nodes stay small
            width: (ele: cytoscape.NodeSingular) =>
              ele.data("deg") === 0 ? 16 : 26 + Math.min(ele.data("deg") * 7, 52),
            height: (ele: cytoscape.NodeSingular) =>
              ele.data("deg") === 0 ? 16 : 26 + Math.min(ele.data("deg") * 7, 52),
          },
        },
        {
          selector: "edge",
          style: {
            // weight (0..1) → thickness
            width: (ele: cytoscape.EdgeSingular) => 1.2 + ele.data("weight") * 7,
            "line-color": cssVar("--color-soft"),
            "curve-style": "bezier",
            "target-arrow-shape": (ele: cytoscape.EdgeSingular) =>
              ele.data("directed") ? "triangle" : "none",
            "target-arrow-color": cssVar("--color-soft"),
            "arrow-scale": 0.9,
            opacity: 0.5,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": cssVar("--color-accent"),
            opacity: 1,
          },
        },
        // hover focus: everything not in the hovered node's neighbourhood fades
        {
          selector: ".dim",
          style: { opacity: 0.12, "text-opacity": 0.08 },
        },
        {
          selector: ".focus",
          style: { opacity: 1, "text-opacity": 1 },
        },
      ],
      layout: {
        name: "fcose",
        quality: "proof",
        randomize: true,
        animate: false,
        padding: 36,
        nodeSeparation: 160,
        idealEdgeLength: 100,
        nodeRepulsion: 9000,
        gravity: 0.22,
        gravityRange: 3.8,
        packComponents: true,
      } as cytoscape.LayoutOptions,
      minZoom: 0.2,
      maxZoom: 3,
    });
    cy.on("tap", "node", (evt) => {
      const d = evt.target.data();
      setSelected({ id: d.id, title: d.title, type: d.type });
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelected(null);
    });
    // hover a node → focus its closed neighbourhood, fade the rest
    cy.on("mouseover", "node", (evt) => {
      const focus = evt.target.closedNeighborhood();
      cy.elements().addClass("dim");
      focus.removeClass("dim").addClass("focus");
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("dim").removeClass("focus");
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, degree, hidden]);

  const toggle = (t: CardType) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {CARD_TYPES.map((t) => {
          const on = !hidden.has(t);
          return (
            <button
              key={t}
              onClick={() => toggle(t)}
              className={`rounded-full border px-2 py-0.5 text-[11px] capitalize transition ${
                on ? "" : "opacity-35"
              }`}
              style={{ borderColor: typeColor(t), color: typeColor(t) }}
            >
              {t.toLowerCase()}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[560px] w-full rounded-md border border-line bg-surface"
        />
        {selected && (
          <aside className="absolute right-3 top-3 w-64 rounded-md border border-line bg-raised/95 p-3 text-sm shadow-lg backdrop-blur">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase text-soft">{selected.type.toLowerCase()}</span>
              <button className="text-soft hover:text-ink" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <p className="mb-1 font-medium">{selected.title}</p>
            <Link
              href={`/series/${seriesId}/cards/${selected.id}`}
              className="text-xs text-accent underline"
            >
              Open full card →
            </Link>
            {neighbours.length > 0 && (
              <>
                <p className="mt-2 text-[11px] uppercase text-soft">
                  {neighbours.length} connection{neighbours.length === 1 ? "" : "s"}
                </p>
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {neighbours.map((n, i) => (
                    <li key={`${n.id}-${i}`} className="flex items-baseline gap-1.5">
                      <span className="italic text-soft">{n.type}</span>
                      <Link
                        href={`/series/${seriesId}/cards/${n.id}`}
                        className="truncate text-accent underline"
                      >
                        {n.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>

      <p className="mt-2 text-[11px] text-soft">
        {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge
        {edges.length === 1 ? "" : "s"} · node size = connections, edge thickness = weight. Hover a
        node to focus its neighbourhood; faded nodes have no relations yet. Gated cards are omitted
        entirely — no phantom nodes.
        {truncated && " Showing the node cap; some cards are not drawn."}
      </p>
    </div>
  );
}
