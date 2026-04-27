/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { DISCLAIMER, HTTP_DISCLAIMER_HEADER } from '../lib/safety';
import { VERSION } from '../lib/version';
import { buildServer } from './server';
import {
  TOOL_NAMES,
  dispatchTool,
  isToolName,
} from './tools/registry';

const HEALTH_SOURCES = ['openFDA', 'RxNorm', 'RxNav'] as const;

// Marker on every /api/tool/:name response so anyone discovering the route
// (curl, Postman, copy-pasted demo URL) knows it isn't part of the MCP spec
// and shouldn't be relied on by MCP clients. The MCP-compliant entry point
// is POST /mcp; this route exists to back the in-browser interactive demo.
export const API_NOTE_HEADER = 'X-API-Note';
export const API_NOTE_VALUE = 'demo-backend; not-part-of-mcp-spec';

// Interactive demo page served from GET /. Single self-contained HTML
// document with inline CSS and inline vanilla JS — no frameworks, no
// external resources, no analytics. Visitors pick a tool, enter a drug
// name, click Run, and see live results from the same handler registry
// the MCP transport uses, dispatched through POST /api/tool/:name.
//
// Constraints (see RELEASES v0.2.0):
//  - Vanilla HTML/CSS/JS, served as a single string (worker bundle ceiling).
//  - ASCII-only source so the constant is safe to embed and so the disclaimer
//    text propagates cleanly to the X-Clinical-Reference-Disclaimer header.
//  - Mobile-responsive; works without JS for the install + tools reference
//    sections (demo region shows a noscript notice).
//  - Total payload under ~25 KB so cold loads stay snappy.
//
// Inline `<script>` is a JS template literal nested inside this outer
// template literal — every `${` and backtick inside the script is escaped
// with a leading backslash. The only intentional outer interpolations are
// `${VERSION}` and `${DISCLAIMER}`.
const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>clinical-reference-mcp v${VERSION}</title>
<meta name="description" content="MCP server exposing drug, prescription, and pharmacology reference tools sourced from openFDA, RxNorm, and RxNav. Developer reference, not for clinical use.">
<style>
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --border: #e5e7eb;
  --accent: #0969da; --accent-fg: #ffffff; --code-bg: #f3f4f6;
  --warn-bg: #fefce8; --warn-border: #eab308;
  --error-bg: #fef2f2; --error-border: #ef4444;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d;
    --accent: #58a6ff; --accent-fg: #0d1117; --code-bg: #161b22;
    --warn-bg: #2a2410; --warn-border: #d29922;
    --error-bg: #2b1416; --error-border: #f85149;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--fg); background: var(--bg);
}
main { max-width: 760px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
h1 { margin: 0; font-size: 1.75rem; font-weight: 600; letter-spacing: -0.01em; }
h2 { margin: 2.5rem 0 1rem; font-size: 1.125rem; font-weight: 600; }
h3 { margin: 1.25rem 0 0.5rem; font-size: 0.85rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
p { margin: 0.5rem 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre {
  font: 13px/1.5 "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
code { background: var(--code-bg); padding: 0.1rem 0.35rem; border-radius: 4px; }
pre { background: var(--code-bg); padding: 0.85rem 1rem; border-radius: 6px; overflow-x: auto; margin: 0; }
pre code { background: none; padding: 0; }
header { margin-bottom: 1.5rem; }
.tagline { color: var(--muted); margin-top: 0.25rem; }
.version { color: var(--muted); font-size: 0.85rem; font-family: "SF Mono", Menlo, monospace; margin-top: 0.5rem; }
.disclaimer {
  background: var(--warn-bg); border-left: 4px solid var(--warn-border);
  padding: 0.85rem 1rem; border-radius: 4px; margin: 1.5rem 0;
}
.disclaimer strong { font-weight: 600; }
.disclaimer .sub { color: var(--muted); font-size: 0.875rem; margin-top: 0.35rem; }
.demo > div { margin: 1rem 0; }
.tool-description { color: var(--muted); font-size: 0.875rem; margin: 0.5rem 0 0; min-height: 1.4em; }
label { display: block; font-weight: 500; margin-bottom: 0.35rem; font-size: 0.875rem; }
input[type="text"], select {
  width: 100%; padding: 0.55rem 0.75rem; font: inherit; font-size: 0.95rem;
  background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  border-radius: 6px;
}
input[type="text"]:focus, select:focus {
  outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent);
}
.field { margin-top: 0.75rem; }
.note { color: var(--muted); font-size: 0.85rem; margin: 0.5rem 0 0; }
button {
  font: inherit; font-size: 0.95rem; padding: 0.55rem 1.25rem;
  background: var(--accent); color: var(--accent-fg); border: 0; border-radius: 6px;
  cursor: pointer; font-weight: 500;
}
button:hover { filter: brightness(1.08); }
button:disabled { opacity: 0.55; cursor: wait; }
.run-button { margin-top: 1rem; }
.snippet { position: relative; margin: 0.5rem 0 1.25rem; }
.snippet button {
  position: absolute; top: 0.5rem; right: 0.5rem;
  font-size: 0.75rem; padding: 0.3rem 0.7rem;
  background: var(--bg); color: var(--fg); border: 1px solid var(--border);
}
#result-area {
  margin-top: 1.5rem; padding: 1rem 1.25rem; background: var(--code-bg);
  border-radius: 6px; border: 1px solid var(--border);
}
.result-meta { display: flex; flex-wrap: wrap; gap: 0.35rem 1rem; margin-bottom: 0.75rem; font-size: 0.875rem; color: var(--muted); }
.result-error { background: var(--error-bg); border-left: 4px solid var(--error-border); padding: 0.85rem 1rem; border-radius: 4px; }
.result-error .code { font-family: "SF Mono", Menlo, monospace; font-weight: 600; font-size: 0.85rem; }
.result-status { font-size: 0.875rem; color: var(--muted); }
.field-row { margin: 0.5rem 0; }
.field-row > .key { font-weight: 600; font-size: 0.85rem; color: var(--muted); margin-right: 0.5rem; }
.field-row > .value { white-space: pre-wrap; word-break: break-word; }
.muted { color: var(--muted); }
.nested { margin: 0.4rem 0 0.4rem 1rem; padding-left: 0.75rem; border-left: 2px solid var(--border); }
details { margin-top: 1rem; }
summary { cursor: pointer; font-size: 0.85rem; color: var(--muted); user-select: none; }
summary:hover { color: var(--fg); }
details[open] summary { margin-bottom: 0.5rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.55rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.875rem; }
.warning { background: var(--warn-bg); border-left: 4px solid var(--warn-border); padding: 0.85rem 1rem; border-radius: 4px; }
@media (max-width: 480px) {
  main { padding: 1.5rem 1rem 3rem; }
  h1 { font-size: 1.5rem; }
}
</style>
</head>
<body>
<main>
  <header>
    <h1>clinical-reference-mcp</h1>
    <p class="tagline">MCP server exposing drug, prescription, and pharmacology reference tools sourced from openFDA, RxNorm, and RxNav.</p>
    <p class="version">v${VERSION}</p>
  </header>

  <div class="disclaimer">
    <strong>Disclaimer.</strong> ${DISCLAIMER}
    <p class="sub">This demo runs against live FDA and NIH data.</p>
  </div>

  <section class="demo" aria-label="Interactive tool demo">
    <h2>Try a tool</h2>
    <noscript><p class="warning">JavaScript is required to run the demo. The install instructions and tools reference below remain functional without it.</p></noscript>
    <div>
      <label for="tool-select">Tool</label>
      <select id="tool-select"></select>
      <p id="tool-description" class="tool-description"></p>
    </div>
    <div id="input-container"></div>
    <button id="run-button" class="run-button" type="button">Run</button>
    <div id="result-area" hidden></div>
  </section>

  <section class="install">
    <h2>Install</h2>
    <h3>One-shot via npx</h3>
    <div class="snippet">
      <pre><code id="snippet-npm">npx -y @shaddyt/clinical-reference-mcp</code></pre>
      <button type="button" data-copy="snippet-npm">Copy</button>
    </div>
    <h3>Claude Desktop / Claude Code MCP config</h3>
    <div class="snippet">
      <pre><code id="snippet-config">{
  "mcpServers": {
    "clinical-reference": {
      "command": "npx",
      "args": ["-y", "@shaddyt/clinical-reference-mcp"]
    }
  }
}</code></pre>
      <button type="button" data-copy="snippet-config">Copy</button>
    </div>
  </section>

  <section class="tools-ref">
    <h2>Tools</h2>
    <table>
      <thead><tr><th>Tool</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td><code>lookup_drug</code></td><td>Resolve a free-text drug name to canonical RxNorm data (RxCUI, generic, brands, classes).</td></tr>
        <tr><td><code>get_drug_label</code></td><td>Fetch FDA-approved label sections (warnings, indications, dosage, etc). Demo returns all sections; configurable via the API.</td></tr>
        <tr><td><code>check_interactions</code></td><td>Return label-level interaction text for two or more drugs (verbatim, no synthesis).</td></tr>
        <tr><td><code>find_alternatives</code></td><td>Suggest alternative drugs in the same therapeutic class.</td></tr>
        <tr><td><code>lookup_adverse_events</code></td><td>Top reported adverse events from FDA FAERS for a drug. Demo returns top 10; configurable via the API (limit, max 100).</td></tr>
        <tr><td><code>get_dosing_reference</code></td><td>Adult dosing entries from the FDA label.</td></tr>
      </tbody>
    </table>
  </section>

  <footer>
    <p>
      <a href="https://github.com/shaddyt/clinical-reference-mcp">GitHub</a>
      &middot;
      <a href="https://www.npmjs.com/package/@shaddyt/clinical-reference-mcp">npm</a>
      &middot;
      <a href="https://shaddyt.space">shaddyt.space</a>
      &middot;
      v${VERSION}
    </p>
  </footer>
</main>
<script>
(function () {
  var TOOLS = [
    {
      name: 'lookup_drug',
      description: 'Resolve a drug name to canonical RxNorm data (RxCUI, generic, brands, classes).',
      inputs: [{ key: 'name', label: 'Drug name', placeholder: 'aspirin' }],
      build: function (raw) { return { name: (raw.name || '').trim() }; },
      note: ''
    },
    {
      name: 'get_drug_label',
      description: 'Fetch FDA-approved label sections (warnings, indications, dosage, etc).',
      inputs: [{ key: 'name', label: 'Drug name', placeholder: 'aspirin' }],
      build: function (raw) { return { name: (raw.name || '').trim() }; },
      note: 'Demo returns all available sections; pass sections: [...] via the API to filter.'
    },
    {
      name: 'check_interactions',
      description: 'Return label-level interaction text for two or more drugs (verbatim, no synthesis).',
      inputs: [{ key: 'drugs', label: 'Drugs (comma-separated)', placeholder: 'warfarin, aspirin' }],
      build: function (raw) {
        return {
          drugs: (raw.drugs || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        };
      },
      note: 'Enter at least 2 drugs separated by commas (max 10).'
    },
    {
      name: 'find_alternatives',
      description: 'Suggest alternative drugs in the same therapeutic class.',
      inputs: [{ key: 'name', label: 'Drug name', placeholder: 'aspirin' }],
      build: function (raw) { return { name: (raw.name || '').trim() }; },
      note: ''
    },
    {
      name: 'lookup_adverse_events',
      description: 'Top reported adverse events from FDA FAERS for a drug.',
      inputs: [{ key: 'name', label: 'Drug name', placeholder: 'aspirin' }],
      build: function (raw) { return { name: (raw.name || '').trim() }; },
      note: 'Demo returns top 10; configurable via the API (limit, max 100).'
    },
    {
      name: 'get_dosing_reference',
      description: 'Adult dosing entries from the FDA label.',
      inputs: [{ key: 'name', label: 'Drug name', placeholder: 'aspirin' }],
      build: function (raw) { return { name: (raw.name || '').trim() }; },
      note: ''
    }
  ];

  var els = {};
  var inFlight = null;

  function init() {
    els.toolSelect = document.getElementById('tool-select');
    els.toolDescription = document.getElementById('tool-description');
    els.inputContainer = document.getElementById('input-container');
    els.runButton = document.getElementById('run-button');
    els.resultArea = document.getElementById('result-area');

    TOOLS.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name;
      els.toolSelect.appendChild(opt);
    });
    els.toolSelect.addEventListener('change', renderInputs);
    els.runButton.addEventListener('click', runTool);

    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', onCopy);
    });

    renderInputs();
    // Pre-populated example so the first click works without typing.
    var first = els.inputContainer.querySelector('input');
    if (first) first.value = 'aspirin';
  }

  function getCurrentTool() {
    var name = els.toolSelect.value;
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].name === name) return TOOLS[i];
    }
    return TOOLS[0];
  }

  function renderInputs() {
    var tool = getCurrentTool();
    els.toolDescription.textContent = tool.description;
    els.inputContainer.textContent = '';
    tool.inputs.forEach(function (input) {
      var wrapper = document.createElement('div');
      wrapper.className = 'field';
      var label = document.createElement('label');
      label.textContent = input.label;
      label.htmlFor = 'input-' + input.key;
      var el = document.createElement('input');
      el.type = 'text';
      el.id = 'input-' + input.key;
      el.dataset.key = input.key;
      el.placeholder = input.placeholder;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); runTool(); }
      });
      wrapper.appendChild(label);
      wrapper.appendChild(el);
      els.inputContainer.appendChild(wrapper);
    });
    if (tool.note) {
      var noteEl = document.createElement('p');
      noteEl.className = 'note';
      noteEl.textContent = tool.note;
      els.inputContainer.appendChild(noteEl);
    }
  }

  function runTool() {
    var tool = getCurrentTool();
    var raw = {};
    els.inputContainer.querySelectorAll('input').forEach(function (el) {
      raw[el.dataset.key] = el.value;
    });
    var body;
    try { body = tool.build(raw); }
    catch (e) {
      showError({ code: 'INVALID_INPUT', message: e.message || 'Invalid input' });
      return;
    }

    if (inFlight) inFlight.abort();
    inFlight = new AbortController();
    var ctl = inFlight;
    els.runButton.disabled = true;
    els.runButton.textContent = 'Running...';
    showLoading();

    fetch('/api/tool/' + tool.name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    }).then(function (response) {
      return response.json();
    }).then(function (json) {
      showResult(json);
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      showNetworkError(err);
    }).then(function () {
      if (inFlight === ctl) {
        inFlight = null;
        els.runButton.disabled = false;
        els.runButton.textContent = 'Run';
      }
    });
  }

  function showLoading() {
    els.resultArea.hidden = false;
    els.resultArea.textContent = '';
    var p = document.createElement('p');
    p.className = 'result-status';
    p.textContent = 'Loading...';
    els.resultArea.appendChild(p);
  }

  function showNetworkError(err) {
    showError({
      code: 'NETWORK_ERROR',
      message: 'Request failed: ' + ((err && err.message) || 'unknown error')
    });
  }

  function showError(error) {
    els.resultArea.hidden = false;
    els.resultArea.textContent = '';
    var box = document.createElement('div');
    box.className = 'result-error';
    var line1 = document.createElement('p');
    var code = document.createElement('span');
    code.className = 'code';
    code.textContent = error.code || 'ERROR';
    line1.appendChild(code);
    line1.appendChild(document.createTextNode(' ' + (error.message || '')));
    box.appendChild(line1);
    if (error.details && error.details.validTools) {
      var hint = document.createElement('p');
      hint.className = 'muted';
      hint.style.fontSize = '0.85rem';
      hint.textContent = 'Valid tools: ' + error.details.validTools.join(', ');
      box.appendChild(hint);
    }
    els.resultArea.appendChild(box);
  }

  function showResult(envelope) {
    els.resultArea.hidden = false;
    els.resultArea.textContent = '';
    if (!envelope || envelope.ok !== true) {
      showError((envelope && envelope.error) || { code: 'UNKNOWN_ERROR', message: 'Unexpected response' });
      appendRawJson(envelope);
      return;
    }
    var data = envelope.data || {};
    if (data.citation) {
      var meta = document.createElement('div');
      meta.className = 'result-meta';
      meta.appendChild(buildCitationLink(data.citation));
      els.resultArea.appendChild(meta);
    }
    // Render any interpretation-guidance fields (FAERS limitations,
    // check_interactions scopeNote, etc.) in a yellow callout above the
    // body. Putting it above the data is a safety requirement: a viewer
    // sees "FAERS does not establish causation" before reading "DEATH:
    // 1339 reports", not after.
    appendCallout(data.limitations);
    appendCallout(data.scopeNote);
    // Disclaimer + citation + interpretation fields already surfaced;
    // skip them in the generic body walker so they don't repeat.
    renderObject(data, els.resultArea, {
      disclaimer: true,
      citation: true,
      limitations: true,
      scopeNote: true,
    });
    appendRawJson(envelope);
  }

  function appendCallout(text) {
    if (!text || typeof text !== 'string') return;
    var box = document.createElement('div');
    box.className = 'disclaimer';
    box.textContent = text;
    els.resultArea.appendChild(box);
  }

  function buildCitationLink(citation) {
    var span = document.createElement('span');
    span.appendChild(document.createTextNode('Source: '));
    if (citation.url) {
      var a = document.createElement('a');
      a.href = citation.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = citation.source || 'link';
      span.appendChild(a);
    } else {
      span.appendChild(document.createTextNode(citation.source || ''));
    }
    if (citation.retrievedAt) {
      span.appendChild(document.createTextNode(' (retrieved ' + String(citation.retrievedAt).split('T')[0] + ')'));
    }
    return span;
  }

  function renderObject(obj, parent, skipKeys) {
    Object.keys(obj).forEach(function (k) {
      if (skipKeys && skipKeys[k]) return;
      var v = obj[k];
      var row = document.createElement('div');
      row.className = 'field-row';
      var keyEl = document.createElement('span');
      keyEl.className = 'key';
      keyEl.textContent = humanize(k) + ':';
      row.appendChild(keyEl);
      renderValue(v, row);
      parent.appendChild(row);
    });
  }

  function renderValue(value, parent) {
    if (value === null || value === undefined || value === '') {
      var blank = document.createElement('span');
      blank.className = 'value muted';
      blank.textContent = '(none)';
      parent.appendChild(blank);
      return;
    }
    var t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      var s = document.createElement('span');
      s.className = 'value';
      s.textContent = String(value);
      parent.appendChild(s);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        var empty = document.createElement('span');
        empty.className = 'value muted';
        empty.textContent = '(empty)';
        parent.appendChild(empty);
        return;
      }
      if (value.every(function (x) { return typeof x === 'string' || typeof x === 'number'; })) {
        var s2 = document.createElement('span');
        s2.className = 'value';
        s2.textContent = value.join(', ');
        parent.appendChild(s2);
        return;
      }
      var wrap = document.createElement('div');
      wrap.className = 'nested';
      value.forEach(function (item) {
        if (item !== null && typeof item === 'object') {
          var sub = document.createElement('div');
          sub.style.marginBottom = '0.5rem';
          renderObject(item, sub, { disclaimer: true });
          wrap.appendChild(sub);
        } else {
          renderValue(item, wrap);
        }
      });
      parent.appendChild(wrap);
      return;
    }
    if (t === 'object') {
      var box = document.createElement('div');
      box.className = 'nested';
      renderObject(value, box, { disclaimer: true });
      parent.appendChild(box);
    }
  }

  function humanize(key) {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function appendRawJson(envelope) {
    var details = document.createElement('details');
    var summary = document.createElement('summary');
    summary.textContent = 'Show raw JSON';
    details.appendChild(summary);
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    var serialized = JSON.stringify(envelope, null, 2);
    code.textContent = serialized;
    pre.appendChild(code);
    details.appendChild(pre);
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy JSON';
    copy.style.marginTop = '0.5rem';
    copy.style.fontSize = '0.75rem';
    copy.style.padding = '0.3rem 0.7rem';
    copy.style.background = 'var(--bg)';
    copy.style.color = 'var(--fg)';
    copy.style.border = '1px solid var(--border)';
    copy.addEventListener('click', function () { writeClipboard(serialized, copy); });
    details.appendChild(copy);
    els.resultArea.appendChild(details);
  }

  function onCopy(evt) {
    var btn = evt.currentTarget;
    var target = document.getElementById(btn.dataset.copy);
    if (!target) return;
    writeClipboard(target.textContent, btn);
  }

  function writeClipboard(text, btn) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      var orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = orig; }, 1500);
    }).catch(function () {
      // Clipboard write may fail in non-secure contexts; the snippet is
      // still selectable in the page so we don't surface an error here.
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
</body>
</html>`;

export function buildHttpApp(): Hono {
  const app = new Hono();

  // CORS — the entire surface is regulator-published public data behind
  // documented disclaimers, so we permit any origin. The headers list
  // matches what MCP's Streamable HTTP transport sends; exposing the
  // disclaimer header keeps it visible to browser clients reading via
  // fetch().
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version'],
      exposeHeaders: [
        'mcp-session-id', // MCP protocol session continuity
        'mcp-protocol-version', // MCP protocol version negotiation
        HTTP_DISCLAIMER_HEADER, // Disclaimer text on every response
        API_NOTE_HEADER, // Demo-backend signaling on /api/tool routes
      ],
    }),
  );

  // The disclaimer header is added on every response — including responses
  // from the MCP transport. Setting it via c.header() before next() makes
  // Hono merge it into whichever Response the downstream handler returns,
  // even when that handler returns a Response object directly.
  app.use('*', async (c, next) => {
    c.header(HTTP_DISCLAIMER_HEADER, DISCLAIMER);
    await next();
  });

  app.get('/', (c) => c.html(LANDING_HTML));

  app.get('/health', (c) =>
    c.json({
      ok: true,
      version: VERSION,
      sources: HEALTH_SOURCES,
    }),
  );

  // Stamp every /api/* response with the demo-backend marker. Set as a
  // route-prefix middleware (not on the global '*' chain) so MCP clients
  // hitting /mcp don't see a header that doesn't apply to them.
  app.use('/api/*', async (c, next) => {
    c.header(API_NOTE_HEADER, API_NOTE_VALUE);
    await next();
  });

  // POST /api/tool/:name — thin HTTP wrapper around dispatchTool() so the
  // in-browser demo at GET / can invoke tools without speaking JSON-RPC.
  // Not part of the MCP spec; the X-API-Note header announces that on every
  // response. Reuses the same handler registry as /mcp, so behavior never
  // diverges between the two surfaces.
  //
  // HTTP status codes here are deliberately layered:
  //   200 -- successful dispatch OR tool-level domain error (matches /mcp's
  //          envelope semantics; the response body's `ok` field discriminates)
  //   400 -- request body could not be parsed as JSON
  //   404 -- tool name not in the registry
  // Domain errors keep envelope semantics; routing/parsing errors get HTTP
  // semantics. The two layers serve different consumers: the envelope's `ok`
  // field is for the application logic that needs to handle DATA_NOT_FOUND
  // vs. UPSTREAM_ERROR vs. AMBIGUOUS_QUERY; the HTTP status is for routing
  // middleware, monitoring, and CDN-level retry behavior.
  app.post('/api/tool/:name', async (c) => {
    const name = c.req.param('name');

    if (!isToolName(name)) {
      // Unknown tool names are routing-level INVALID_INPUT — the URL param
      // is technically input, and 404 carries the routing semantic. The
      // structured `details.validTools` list lets a client UI render
      // "did you mean...?" without re-parsing the message string.
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_INPUT' as const,
            message: `Unknown tool name: '${name}'. Valid tools: ${TOOL_NAMES.join(', ')}.`,
            details: { validTools: [...TOOL_NAMES] },
          },
          disclaimer: DISCLAIMER,
        },
        404,
      );
    }

    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_INPUT' as const,
            message:
              'Request body must be a JSON object matching the tool input schema.',
          },
          disclaimer: DISCLAIMER,
        },
        400,
      );
    }

    // Dispatch returns the raw envelope. Tool-level errors (validation
    // failures, DATA_NOT_FOUND, AMBIGUOUS_QUERY, UPSTREAM_ERROR) come back
    // as ok:false with a 200 — the HTTP request itself succeeded; the
    // domain returned a structured error. Mirrors how /mcp wraps tool
    // errors as `isError: true` content rather than HTTP failures.
    const result = await dispatchTool(name, input);
    return c.json(result);
  });

  // Stateless mode — each request gets a fresh transport + server. This is
  // the pattern the SDK's own Hono example documents and lets us redeploy
  // anywhere with no shared in-memory state. The trade-off is that
  // long-running MCP sessions across multiple HTTP calls are not supported
  // here; clients that need them should use the stdio transport.
  app.all('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = buildServer();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
