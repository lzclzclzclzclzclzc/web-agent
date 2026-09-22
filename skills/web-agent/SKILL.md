---
name: web-agent
description: >-
  Use when a text-only reply is not enough and the user would be better served by a
  browser interaction — presenting choices/mockups to pick from, confirming a diagram or
  design, collecting structured input (sliders/forms), or showing live metrics that update
  in real time (e.g. training loss/F1). Drives the `web-agent` MCP server (tools:
  open_panel, render, ask, stream) which serves a local page. Prefer this over ASCII art,
  long option lists, or asking the user to eyeball raw numbers.
---

# web-agent — rich browser interaction

A local web panel the agent drives through four MCP tools. The user interacts in the
browser and clicks one persistent **Submit** button (bottom-right); the agent resumes the
instant they submit — no "type continue" round-trip, because `ask` blocks the tool call.

## Tools

- **`open_panel`** → start the page, return its URL. Call once, tell the user to open it.
- **`render`** → push a screen; returns immediately (no waiting). For content, mockups, or
  to set up a live-metrics panel (declare `charts:[{channel,label}]`).
- **`ask`** → push a screen and **block until the user submits**; returns their answer
  `{ action, selected, selectedLabels, text, fields }`. This is how you get input.
- **`stream`** → append a datapoint to a chart channel declared via `render`. Non-blocking.

## Choosing how to build a screen (declarative first)

1. **Declarative (default, cheap, safe):** use `ask` with `options` (A/B/C choices),
   `controls` (slider / number / checkbox / text / select — collected into `answer.fields`),
   `actions` (buttons that submit immediately with `answer.action`), and/or
   `freeText`. No HTML authoring needed. Use this for the vast majority of cases.
2. **Freehand HTML (escape hatch):** only for genuinely bespoke visuals — custom mockups,
   design comparisons, diagrams, generative UI. **Delegate the authoring to the `ui-author`
   subagent**, which writes a contract-compliant HTML file and returns its path; then call
   `render({ htmlPath })`. This keeps the verbose markup OUT of your context. Do NOT hand-
   write large HTML inline yourself.

Rule of thumb: if the answer is a choice, a value, or a form → declarative. If the user
must *see* a custom-designed artifact → ui-author + `render({htmlPath})`.

## Live monitoring without spending turns

For training/long-task metrics, `render` a panel with `charts`, then have the **producing
process** POST `{channel,value}` to `<url>/ingest` (or call `stream`). The curves update
over SSE with no agent turn per tick. Only re-enter with `ask` when a decision is needed.

## Patterns

- **Pick a design:** ui-author writes 2–3 mockups → `render({htmlPath})` →
  `ask({ options:[…], submitLabel:'Use this one' })`.
- **Confirm a diagram/architecture:** ui-author writes the SVG/HTML →
  `ask({ actions:[{id:'approve',label:'Looks right',primary:true},{id:'revise',label:'Needs changes'}], freeText:{enabled:true} })`.
- **Tune parameters:** `ask({ controls:[{id:'conf',type:'slider',min:0,max:1,step:0.01,value:0.35}, …], actions:[{id:'run',label:'Run',primary:true}] })`.
- **Watch training:** `render({ charts:[{channel:'loss'},{channel:'f1'}] })`; script POSTs to `/ingest`.

## Operational notes

- Allowlist the web-agent tools so a blocking `ask` never stalls on a permission prompt.
- Raise the client tool-call timeout for long human think-time (the server sends progress
  keep-alives, but clients enforce a hard maximum).
- The panel is a projection; the server is the source of truth. It binds to localhost only.
