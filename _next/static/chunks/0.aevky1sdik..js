(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,32447,e=>{"use strict";var t=e.i(43476),a=e.i(49838);e.s(["ErrorMessage",0,function({message:e,className:n}){return e?(0,t.jsx)("div",{role:"alert",className:(0,a.cn)("rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error",n),children:e}):null}])},39901,e=>{"use strict";var t=e.i(43476),a=e.i(49838);e.s(["ProgressBar",0,function({progress:e,label:n,className:r}){let i=null===e,l=i?0:Math.min(100,Math.max(0,e));return(0,t.jsx)("div",{className:(0,a.cn)("h-2 w-full rounded-full bg-bg-elevated overflow-hidden",r),role:"progressbar","aria-label":n??"Progress","aria-valuemin":0,"aria-valuemax":100,...i?{}:{"aria-valuenow":Math.round(l)},children:i?(0,t.jsx)("div",{className:"h-full w-full rounded-full bg-accent/60 shadow-sm shadow-accent/30 animate-pulse motion-reduce:animate-none motion-reduce:opacity-60"}):(0,t.jsx)("div",{className:"h-full rounded-full bg-accent shadow-sm shadow-accent/30 transition-all duration-300 motion-reduce:transition-none",style:{width:`${l}%`}})})}])},82906,e=>{"use strict";var t=e.i(43476),a=e.i(71645),n=e.i(39901),r=e.i(38241),i=e.i(56401),l=e.i(49838);e.s(["ToolControl",0,function({label:e,children:a}){return(0,t.jsxs)("div",{className:"flex flex-col gap-2",children:[e&&(0,t.jsx)("div",{className:(0,l.cn)(i.MONO_LABEL,"text-text-muted"),children:e}),a]})},"ToolControlGroup",0,function({children:e}){return(0,t.jsx)(r.ToolAsideSection,{className:"gap-[17px]",children:e})},"ToolProgress",0,function({phase:e,percent:r,label:i}){let l=(0,a.useRef)(null);return(0,a.useEffect)(()=>{let t=l.current;t&&(t.textContent=e)},[e]),(0,t.jsxs)("div",{className:"flex flex-col gap-2",children:[(0,t.jsxs)("div",{className:"flex items-center justify-between gap-3 font-mono text-[10.5px] leading-none text-text-muted",children:[(0,t.jsx)("span",{ref:l,"aria-live":"polite","aria-atomic":"true"}),(0,t.jsx)("span",{className:"text-accent-300",children:null===r?"WORKING":`${r}%`})]}),(0,t.jsx)(n.ProgressBar,{progress:r,label:i??e})]})}])},74238,e=>{"use strict";var t=e.i(43476),a=e.i(71645);let n=(0,e.i(75254).default)("upload",[["path",{d:"M12 3v12",key:"1x0j5s"}],["path",{d:"m17 8-5-5-5 5",key:"7q97r8"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}]]);var r=e.i(49838);function i(e){if(!e)return"";let t=e.split(",").map(e=>e.trim()).filter(Boolean);if(t.some(e=>"*/*"===e))return"";let a=[];for(let e of t)e.startsWith(".")?a.push(e.slice(1).toUpperCase()):e.endsWith("/*")?a.push(`${e.split("/")[0]}s`):e.includes("/")&&a.push(e.split("/")[1].toUpperCase());return[...new Set(a)].join(", ")}function l(e){return e<1024?`${e} MB`:`${(e/1024).toFixed(2).replace(/\.?0+$/,"")} GB`}let o=(0,r.cn)("bg-[image:repeating-linear-gradient(90deg,var(--color-neutral-600)_0_9px,transparent_9px_18px),repeating-linear-gradient(90deg,var(--color-neutral-600)_0_9px,transparent_9px_18px),repeating-linear-gradient(0deg,var(--color-neutral-600)_0_9px,transparent_9px_18px),repeating-linear-gradient(0deg,var(--color-neutral-600)_0_9px,transparent_9px_18px)]","bg-[length:200%_1px,200%_1px,1px_200%,1px_200%]","bg-[position:0_0,0_100%,0_0,100%_0] bg-no-repeat","animate-tm-march motion-reduce:animate-none"),s=[];e.s(["DropZone",0,function({accept:e,multiple:c=!1,onFiles:d,className:p,label:u="Drop a file to begin",sizeCapMB:m,sizeCapReason:f,practicalLimitNote:h,acceptLabel:g,disabled:x=!1}){let b,[k,w]=(0,a.useState)(!1),[v,y]=(0,a.useState)(null),j=(0,a.useRef)(null),$=(0,a.useId)(),P=`${$}meta`,T=`${$}note`,M=(0,a.useRef)(0),C=i(e),A=g??((b=i(e))?[...new Set(b.split(", ").map(e=>"JPEG"===e?"JPG":"HEIF"===e?"HEIC":e))].join(" "):""),N=(0,a.useCallback)(t=>{if(0===t.length)return;let a=t.filter(t=>(function(e,t){if(!t)return!0;let a=t.split(",").map(e=>e.trim().toLowerCase()).filter(Boolean);if(!a.length||a.includes("*/*"))return!0;let n=e.name.toLowerCase(),r=e.type.toLowerCase();for(let e of a)if(e.startsWith(".")&&n.endsWith(e)||e.endsWith("/*")&&r&&r.startsWith(e.slice(0,-1))||e.includes("/")&&!e.endsWith("/*")&&r===e)return!0;return!r})(t,e));if(0===a.length)return void y(C?`Unsupported file type. Accepts ${C}.`:"Unsupported file type.");let n=m?1024*m*1024:1/0,r=a.filter(e=>e.size<=n);if(0===r.length){let e,t=m?l(m):"",n=f?` ${f}`:"";y(1===a.length?`File is too large (${(e=a[0].size/1024/1024)<1024?`${e.toFixed(1)} MB`:`${(e/1024).toFixed(2)} GB`}). Maximum is ${t}.${n}`:`Every file is over the ${t} maximum.${n}`);return}y(r.length<t.length?"Some files were skipped (unsupported type or over the size cap).":null),d(c?r:[r[0]])},[e,C,c,d,m,f]),S=(0,a.useCallback)(e=>{e.preventDefault(),M.current=0,w(!1),x||N(Array.from(e.dataTransfer.files))},[N,x]),B=(0,a.useCallback)(e=>{N(Array.from(e.target.files??[])),e.target.value=""},[N]);return(0,a.useEffect)(()=>{let e=j.current;if(!e)return;s.push(e);let t=t=>{(t.metaKey||t.ctrlKey)&&!t.shiftKey&&!t.altKey&&"o"===t.key.toLowerCase()&&s[s.length-1]===e&&(t.preventDefault(),e.disabled||e.click())};return window.addEventListener("keydown",t),()=>{window.removeEventListener("keydown",t);let a=s.indexOf(e);-1!==a&&s.splice(a,1)}},[]),(0,t.jsxs)("label",{"aria-disabled":x||void 0,onDragEnter:e=>{e.preventDefault(),M.current++,x||w(!0)},onDragOver:e=>e.preventDefault(),onDragLeave:()=>{M.current=Math.max(0,M.current-1),0===M.current&&w(!1)},onDrop:S,className:(0,r.cn)("group relative mx-auto flex w-full max-w-[600px] min-h-[min(52vh,460px)] flex-col items-center justify-center gap-[22px] rounded-lg border px-10 py-14 cursor-pointer transition-all duration-300 motion-reduce:transition-none focus-within:border-accent focus-within:bg-none focus-within:bg-accent-muted",k?"border-accent bg-accent-muted":(0,r.cn)(o,"border-transparent hover:border-accent/40 hover:bg-none hover:bg-text-primary/3"),x&&"pointer-events-none opacity-50",p),children:[(0,t.jsx)("div",{className:(0,r.cn)("flex items-center justify-center rounded-[12px] border p-3.5 transition-all duration-300 motion-reduce:transition-none",k?"border-accent bg-accent-muted text-accent scale-110 motion-reduce:scale-100":"border-accent/40 bg-accent/10 text-accent group-hover:bg-accent-muted"),"aria-hidden":"true",children:(0,t.jsx)(n,{size:24})}),(0,t.jsxs)("div",{className:"flex flex-col gap-[7px] text-center",children:[(0,t.jsx)("span",{className:"block font-display text-[19px] leading-[1.25] font-medium text-text-primary",children:u}),(0,t.jsx)("span",{className:"mx-auto block max-w-[380px] font-body text-[12.5px] leading-[1.5] text-text-muted",children:"Nothing uploads. The engine runs in this tab, on this machine."})]}),(0,t.jsx)("span",{className:"inline-flex h-[34px] items-center rounded-md border border-accent px-[18px] font-display text-[13px] leading-none font-medium text-accent transition-colors duration-200 group-hover:bg-accent/12",children:"Choose file"}),(0,t.jsxs)("span",{id:P,className:"text-center font-mono text-[10px] leading-none tracking-[0.05em] text-text-muted",children:[A&&(0,t.jsxs)(t.Fragment,{children:["ACCEPTS ",A,(0,t.jsx)("span",{"aria-hidden":"true",className:"px-2 opacity-40",children:"·"})]}),c&&(0,t.jsxs)(t.Fragment,{children:["BATCH OK",(0,t.jsx)("span",{"aria-hidden":"true",className:"px-2 opacity-40",children:"·"})]}),m?`MAX ${l(m)}`:h?"MEMORY-BOUND":"NO SIZE CAP"]}),!m&&h&&(0,t.jsx)("span",{id:T,className:"mx-auto block max-w-[420px] text-center font-body text-[11.5px] leading-[1.5] text-text-muted",children:h}),v&&(0,t.jsx)("span",{role:"alert",className:"max-w-[420px] text-center text-xs leading-[1.5] text-error",children:v}),(0,t.jsx)("input",{ref:j,type:"file",accept:e,multiple:c,disabled:x,onChange:B,"aria-label":u,"aria-describedby":!m&&h?`${P} ${T}`:P,className:"sr-only"})]})}],74238)},98700,e=>{"use strict";var t=e.i(43476),a=e.i(71645);let n=(0,e.i(75254).default)("file-text",[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]);var r=e.i(74238),i=e.i(32447);function l({html:e,onDone:n}){let r=(0,a.useRef)(null);return(0,a.useEffect)(()=>{let t=r.current;if(!t)return;let a=!1,i=null;return(async()=>{let r=t.contentWindow,l=t.contentDocument;if(!r||!l)return n();l.open(),l.write(e),l.close();try{l.fonts&&"function"==typeof l.fonts.ready?.then&&await Promise.race([l.fonts.ready,new Promise(e=>setTimeout(e,3e3))])}catch{}if(a)return;let o=()=>{r.removeEventListener("afterprint",o),n()};r.addEventListener("afterprint",o),i=()=>r.removeEventListener("afterprint",o);let s=setTimeout(()=>{a||n()},6e4);i=()=>{clearTimeout(s),r.removeEventListener("afterprint",o)},r.focus(),r.print()})(),()=>{a=!0,i?.()}},[e,n]),(0,t.jsx)("iframe",{ref:r,title:"Markdown to PDF print preview","aria-hidden":"true",className:"absolute -left-[9999px] top-0 h-0 w-0 border-0"})}var o=e.i(20906),s=e.i(24154);let c=null;async function d(){return c||(c=(async()=>{try{let[{createHighlighterCore:t},{createJavaScriptRegexEngine:a}]=await Promise.all([e.A(82372),e.A(37425)]);return await t({themes:[e.A(73385),e.A(72527)],langs:[e.A(36335),e.A(31250),e.A(62408),e.A(14235),e.A(5665),e.A(68715),e.A(69140),e.A(54147),e.A(38315),e.A(83870),e.A(51672),e.A(3301),e.A(23595),e.A(39726),e.A(76241),e.A(81293),e.A(17030),e.A(12149),e.A(91731)],engine:a()})}catch{return null}})()),c}let p={javascript:"js",typescript:"ts",python:"python",py:"python",shell:"bash",sh:"bash",zsh:"bash",yml:"yaml",markdown:"markdown",md:"markdown"};function u(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function m(e,t={}){var a;let n="dark"===(t.theme??"light")?"github-dark":"github-light",r=new o.Marked({gfm:!0,breaks:!1,async:!0});return r.use({async:!0,async walkTokens(e){if("code"!==e.type)return;let t=(e.lang??"").trim().toLowerCase();if(!t)return;let a=await d();if(!a)return;let r=p[t]??t;if(a.getLoadedLanguages().includes(r))try{e.__highlighted=a.codeToHtml(e.text,{lang:r,theme:n})}catch{}},renderer:{code(e){let t=e.__highlighted;if(t)return t+"\n";let a=e.lang?` data-lang="${u(e.lang)}"`:"";return`<pre class="md-pdf-code-fallback"${a}><code>${u(e.text)}
</code></pre>
`},checkbox:({checked:e})=>e?"☑ ":"☐ "}}),a=await r.parse(e),s.default.sanitize(a,{ADD_ATTR:["style","class"],FORBID_TAGS:["script","style","iframe","object","embed","form"],FORBID_ATTR:["onerror","onload","onclick","onmouseover","onfocus"]})}var f=e.i(49838),h=e.i(38241),g=e.i(87804),x=e.i(82906),b=e.i(56401),k=e.i(25550);let w=`# Hello, Markdown

A short paragraph with **bold**, *italic*, and \`inline code\`.

## Code block

\`\`\`ts
type User = { id: string; name: string };

export function greet(user: User) {
  return \`Hello, \${user.name}!\`;
}
\`\`\`

## Tables

| Tool | Output | Bytes |
| --- | --- | ---: |
| Markdown to PDF | PDF | ~80 KB |
| Markdown to HTML | HTML | ~4 KB |

## Task list

- [x] Install Shiki
- [x] Wire print iframe
- [ ] Sip coffee

> "Typography is the craft of endowing human language with a durable visual form." — Robert Bringhurst
`,v="flex-1 rounded-[6px] px-3 py-[7px] text-[11.5px]";function y({mode:e,onChange:a}){return(0,t.jsxs)("div",{className:"flex gap-[5px]",role:"tablist","aria-label":"Input mode",children:[(0,t.jsxs)("button",{type:"button",role:"tab","aria-selected":"paste"===e,onClick:()=>a("paste"),className:(0,b.chipClass)("paste"===e,(0,f.cn)(v,"paste"!==e&&"text-text-muted")),children:[(0,t.jsx)(n,{size:13,"aria-hidden":"true",className:"mr-1.5 inline align-[-2px]"}),"Paste markdown"]}),(0,t.jsx)("button",{type:"button",role:"tab","aria-selected":"upload"===e,onClick:()=>a("upload"),className:(0,b.chipClass)("upload"===e,(0,f.cn)(v,"upload"!==e&&"text-text-muted")),children:"Upload .md"})]})}e.s(["MarkdownToPdfUI",0,function(){let[e,n]=(0,a.useState)("paste"),[o,s]=(0,a.useState)(""),[c,d]=(0,a.useState)("light"),[p,u]=(0,a.useState)("serif"),[v,j]=(0,a.useState)(""),[$,P]=(0,a.useState)(null),[T,M]=(0,a.useState)(null),[C,A]=(0,a.useState)(null),N=(0,a.useRef)(null);(0,a.useEffect)(()=>{N.current&&clearTimeout(N.current);let e=!1;return N.current=setTimeout(async()=>{if(!o.trim()){e||j("");return}try{let t=await m(o,{theme:c,font:p});e||j(t)}catch(t){e||P(t instanceof Error?t.message:"Failed to render preview")}},200),()=>{e=!0,N.current&&clearTimeout(N.current)}},[o,c,p]);let S=(0,a.useCallback)(async e=>{P(null);let t=e[0];if(!t)return;if(t.size>0xa00000)return void P(`File is too large (${(t.size/1024/1024).toFixed(1)} MB). Limit is 10 MB.`);let a=t.name.toLowerCase();if(!(a.endsWith(".md")||a.endsWith(".markdown")||a.endsWith(".txt")||"text/markdown"===t.type||"text/plain"===t.type||""===t.type))return void P("Unsupported file type. Upload a .md, .markdown, or .txt file.");try{let e=await t.text();s(e)}catch(e){P(e instanceof Error?e.message:"Failed to read file")}},[]),B=(0,a.useCallback)(async()=>{if(P(null),o.trim()){A("Preparing PDF…");try{let e,t=await m(o,{theme:c,font:p}),a=function({bodyHtml:e,title:t,theme:a,font:n,pageSize:r="A4"}){let i=function({theme:e,font:t,pageSize:a="A4"}){let n="dark"===e?{bg:"#1a1814",text:"#f0eee8",textMuted:"#b8b6ae",rule:"#3a3733",codeBg:"#22201c",inlineCodeBg:"#2a2723",blockquoteBar:"#c9b88a",link:"#e0c374",tableHeaderBg:"#22201c"}:{bg:"#fdfdfb",text:"#1f1d1a",textMuted:"#5a5852",rule:"#e8e6e0",codeBg:"#f7f5ef",inlineCodeBg:"#f3efe7",blockquoteBar:"#c9b88a",link:"#9a7b1f",tableHeaderBg:"#f7f5ef"},r='"Syne", "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',i='"JetBrains Mono", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',l=window.location.origin;return`

@font-face {
  font-family: "Newsreader";
  src: url("${l}/fonts/print/newsreader-latin-wght-normal.woff2") format("woff2-variations");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Newsreader";
  src: url("${l}/fonts/print/newsreader-latin-wght-italic.woff2") format("woff2-variations");
  font-weight: 400 700;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: "Outfit";
  src: url("${l}/fonts/print/outfit-latin-wght-normal.woff2") format("woff2-variations");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Syne";
  src: url("${l}/fonts/print/syne-latin-wght-normal.woff2") format("woff2-variations");
  font-weight: 600 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("${l}/fonts/print/jetbrains-mono-latin-wght-normal.woff2") format("woff2-variations");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}

@page {
  size: ${a};
  margin: 18mm 16mm;
}
@page :first {
  margin-top: 28mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: ${n.bg};
  color: ${n.text};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body {
  font-family: ${"serif"===t?'"Newsreader", "Charter", "Iowan Old Style", Georgia, "Times New Roman", serif':'"Outfit", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'};
  font-size: 11pt;
  line-height: 1.65;
  letter-spacing: 0.005em;
}

.md-pdf-doc {
  max-width: 100%;
  margin: 0 auto;
}

h1, h2, h3, h4, h5, h6 {
  font-family: ${r};
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: ${n.text};
  break-after: avoid;
  page-break-after: avoid;
}
h1 {
  font-size: 22pt;
  margin: 24pt 0 12pt;
  font-weight: 700;
}
h2 {
  font-size: 17pt;
  margin: 20pt 0 10pt;
  padding-bottom: 4pt;
  border-bottom: 1px solid ${n.rule};
}
h3 { font-size: 14pt; margin: 16pt 0 8pt; }
h4 { font-size: 12pt; margin: 14pt 0 6pt; }
h5, h6 { font-size: 11pt; margin: 12pt 0 4pt; color: ${n.textMuted}; }

p {
  margin: 0 0 10pt;
  orphans: 3;
  widows: 3;
}

a {
  color: ${n.link};
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media print {
  /* Reveal the underlying URL for offline readers, but skip in-document anchors. */
  a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 0.85em;
    color: ${n.textMuted};
    word-break: break-all;
  }
}

strong { font-weight: 600; }
em { font-style: italic; }
del { text-decoration: line-through; color: ${n.textMuted}; }

ul, ol {
  margin: 0 0 10pt;
  padding-left: 1.4em;
}
li { margin: 4pt 0; }
li > ul, li > ol { margin: 4pt 0; }

blockquote {
  margin: 12pt 0;
  padding: 0 0 0 16px;
  border-left: 4px solid ${n.blockquoteBar};
  color: ${n.textMuted};
  font-size: 0.96em;
  font-style: italic;
  break-inside: avoid;
  page-break-inside: avoid;
}
blockquote p { margin: 0 0 6pt; }
blockquote p:last-child { margin: 0; }

code {
  font-family: ${i};
  font-size: 0.92em;
  background: ${n.inlineCodeBg};
  color: ${n.text};
  padding: 2px 6px;
  border-radius: 4px;
}

pre {
  margin: 12pt 0;
  padding: 16px 18px;
  background: ${n.codeBg};
  border-radius: 12px;
  font-family: ${i};
  font-size: 0.92em;
  line-height: 1.5;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
  white-space: pre-wrap;
  word-wrap: break-word;
}
pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 1em;
}

/* Shiki emits a <pre class="shiki ..."> with inline color styles per span.
   Make sure our wrapper styling doesn't fight Shiki's background tokens. */
pre.shiki {
  background: ${n.codeBg} !important;
}
pre.shiki code { color: inherit; }

/* Plain fallback when no Shiki theme is loaded for the lang. */
pre.md-pdf-code-fallback {
  background: ${n.codeBg};
  color: ${n.text};
}

table {
  width: 100%;
  margin: 12pt 0;
  border-collapse: collapse;
  break-inside: avoid;
  page-break-inside: avoid;
  font-size: 0.96em;
}
th, td {
  padding: 8px 12px;
  border: 1px solid ${n.rule};
  text-align: left;
  vertical-align: top;
}
th {
  background: ${n.tableHeaderBg};
  font-weight: 600;
  font-family: ${r};
}

hr {
  margin: 24pt 0;
  border: 0;
  border-top: 1px solid ${n.rule};
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 12pt auto;
  break-inside: avoid;
  page-break-inside: avoid;
}
img[alt]::after {
  display: block;
  content: attr(alt);
  font-size: 9pt;
  color: ${n.textMuted};
  font-style: italic;
  text-align: center;
  margin-top: 4pt;
}

/* Task-list rendering — checkbox token is replaced with ☐/☑ glyph in renderer. */
ul li:has(> input[type="checkbox"]),
ul li:where(:first-letter) {
  list-style: none;
}
`}({theme:a,font:n,pageSize:r}),l=t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${l}</title>
<style>${i}</style>
</head>
<body>
<article class="md-pdf-doc">
${e}
</article>
</body>
</html>`}({bodyHtml:t,title:(e=o.match(/^#\s+(.+?)\s*$/m),e?.[1]?e[1].trim().slice(0,100):"Markdown Document"),theme:c,font:p});M(a)}catch(e){A(null),P(e instanceof Error?e.message:"Failed to render PDF")}}},[o,c,p]),_=(0,a.useCallback)(()=>{M(null),A(null)},[]),z="dark"===c?"bg-[#1a1814]":"bg-[#fdfdfb]",E="dark"===c?"text-[#f0eee8]":"text-[#1f1d1a]",F=(0,a.useMemo)(()=>!o.trim(),[o]);return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("div",{className:b.CANVAS_COLUMN,children:["upload"===e&&(0,t.jsx)(r.DropZone,{accept:".md,.markdown,.txt,text/markdown",onFiles:S,label:"Upload a Markdown or text file"}),(0,t.jsxs)(g.TextPanes,{children:[(0,t.jsx)(g.TextPane,{label:"Markdown source",lines:(0,g.lineCount)(o),size:(0,k.formatFileSize)(new Blob([o]).size),children:(0,t.jsx)("textarea",{value:o,onChange:e=>s(e.target.value),placeholder:"paste"===e?w:void 0,className:g.TEXT_PANE_BODY,"aria-label":"upload"===e?"Uploaded Markdown content (editable)":"Markdown source"})}),(0,t.jsx)(g.TextPane,{tone:"out",label:"Preview",lines:(0,g.lineCount)(o),size:(0,k.formatFileSize)(new Blob([o]).size),children:(0,t.jsx)("div",{className:(0,f.cn)("prose prose-sm min-h-[12rem] max-w-none flex-1 overflow-auto p-6",z,E,"dark"===c?"prose-invert":""),"data-testid":"markdown-pdf-preview",dangerouslySetInnerHTML:{__html:v||'<p class="text-text-muted italic">Your rendered Markdown will appear here. Type or paste on the left to start.</p>'}})})]}),(0,t.jsx)(g.StatStrip,{stats:[{label:"WORDS",value:String(o.trim()?o.trim().split(/\s+/).length:0),tone:"neutral"},{label:"LINES",value:String(o?o.split("\n").length:0),tone:"neutral"},{label:"THEME",value:c.toUpperCase()},{label:"FONT",value:p.toUpperCase(),tone:"ok"}]}),(0,t.jsx)(i.ErrorMessage,{message:$}),T&&(0,t.jsx)(l,{html:T,onDone:_})]}),(0,t.jsxs)(h.ToolAside,{footer:(0,t.jsxs)(t.Fragment,{children:[C&&(0,t.jsx)(x.ToolProgress,{phase:"PREPARING PDF",percent:null,label:C}),(0,t.jsx)(h.ToolActions,{primaryLabel:"Export to PDF",onPrimary:B,primaryDisabled:F||null!==T})]}),children:[(0,t.jsxs)(x.ToolControlGroup,{children:[(0,t.jsx)(x.ToolControl,{label:"SOURCE",children:(0,t.jsx)(y,{mode:e,onChange:n})}),(0,t.jsx)(x.ToolControl,{label:"THEME",children:(0,t.jsx)(h.ToolChoice,{label:"Theme",fill:!0,value:c,onChange:e=>d(e),options:[{value:"light",label:"Light"},{value:"dark",label:"Dark"}]})}),(0,t.jsx)(x.ToolControl,{label:"FONT",children:(0,t.jsx)(h.ToolChoice,{label:"Font",fill:!0,value:p,onChange:e=>u(e),options:[{value:"serif",label:"Serif"},{value:"sans",label:"Sans"}]})})]}),(0,t.jsx)(h.ToolAsideSection,{label:"EXPORT",children:(0,t.jsx)("span",{className:"font-body text-[10.5px] leading-[1.5] text-text-muted",children:"Your browser’s print dialog opens — pick “Save as PDF” as the destination. Firefox users: turn on “Print backgrounds” in the dialog so the code-block tints render."})})]})]})}],98700)},87843,e=>{e.n(e.i(98700))},82372,e=>{e.v(t=>Promise.all(["static/chunks/02sqjbepwp7uy.js","static/chunks/0fldp2s9ep50o.js","static/chunks/076k0m2wnrlno.js"].map(t=>e.l(t))).then(()=>t(65487)))},37425,e=>{e.v(t=>Promise.all(["static/chunks/0ua5i7ngotv5h.js","static/chunks/076k0m2wnrlno.js"].map(t=>e.l(t))).then(()=>t(33050)))},73385,e=>{e.v(t=>Promise.all(["static/chunks/0pueyklmfswrq.js"].map(t=>e.l(t))).then(()=>t(82866)))},72527,e=>{e.v(t=>Promise.all(["static/chunks/05eaj1v2okiy7.js"].map(t=>e.l(t))).then(()=>t(8771)))},36335,e=>{e.v(t=>Promise.all(["static/chunks/08pwdqvrigien.js","static/chunks/040kogxykuzu5.js"].map(t=>e.l(t))).then(()=>t(31431)))},31250,e=>{e.v(t=>Promise.all(["static/chunks/0od_ps~_73ggu.js"].map(t=>e.l(t))).then(()=>t(1124)))},62408,e=>{e.v(t=>Promise.all(["static/chunks/0-df.c4unezfp.js"].map(t=>e.l(t))).then(()=>t(2058)))},14235,e=>{e.v(t=>Promise.all(["static/chunks/00p4wpry0ugq2.js"].map(t=>e.l(t))).then(()=>t(51327)))},5665,e=>{e.v(t=>Promise.all(["static/chunks/152z0an-e6eti.js"].map(t=>e.l(t))).then(()=>t(53113)))},68715,e=>{e.v(t=>Promise.all(["static/chunks/0yio-8jmi1ebf.js"].map(t=>e.l(t))).then(()=>t(12920)))},69140,e=>{e.v(t=>Promise.all(["static/chunks/02z6ifn9dofzz.js"].map(t=>e.l(t))).then(()=>t(62459)))},54147,e=>{e.v(t=>Promise.all(["static/chunks/15s4iiiaum35b.js"].map(t=>e.l(t))).then(()=>t(79010)))},38315,e=>{e.v(t=>Promise.all(["static/chunks/0el8jf871qg.r.js","static/chunks/0l5jesev.udam.js"].map(t=>e.l(t))).then(()=>t(18387)))},83870,e=>{e.v(t=>Promise.all(["static/chunks/0tr2zm5l24lcf.js","static/chunks/0u8tgk.k67a-5.js","static/chunks/0l5jesev.udam.js"].map(t=>e.l(t))).then(()=>t(66730)))},51672,e=>{e.v(t=>Promise.all(["static/chunks/13~jv.30wo.cj.js"].map(t=>e.l(t))).then(()=>t(43902)))},3301,e=>{e.v(t=>Promise.all(["static/chunks/0av92bfa-flci.js"].map(t=>e.l(t))).then(()=>t(36037)))},23595,e=>{e.v(t=>Promise.all(["static/chunks/11u1.sxtb~hvj.js"].map(t=>e.l(t))).then(()=>t(67892)))},39726,e=>{e.v(t=>Promise.all(["static/chunks/0h28.5y5jw7.8.js"].map(t=>e.l(t))).then(()=>t(50317)))},76241,e=>{e.v(t=>Promise.all(["static/chunks/09n1sbwo4g8bc.js"].map(t=>e.l(t))).then(()=>t(69792)))},81293,e=>{e.v(t=>Promise.all(["static/chunks/11shmju~-b3wo.js","static/chunks/040kogxykuzu5.js","static/chunks/0kuo0ka_r1c~_.js"].map(t=>e.l(t))).then(()=>t(41887)))},17030,e=>{e.v(t=>Promise.all(["static/chunks/0pms8lft8259e.js"].map(t=>e.l(t))).then(()=>t(67008)))},12149,e=>{e.v(t=>Promise.all(["static/chunks/185logj_.l3of.js"].map(t=>e.l(t))).then(()=>t(36562)))},91731,e=>{e.v(t=>Promise.all(["static/chunks/0n4qqf.j~ifxr.js"].map(t=>e.l(t))).then(()=>t(71935)))}]);