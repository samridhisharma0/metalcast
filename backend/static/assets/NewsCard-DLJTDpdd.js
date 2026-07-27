import{j as e,m as x}from"./motion-BXvsjsIm.js";import{B as m}from"./Empty-BMpUjmBB.js";import{c as r,S as n,r as d,a as l,H as h}from"./index-DEzD4lPd.js";/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=r("ExternalLink",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=r("Minus",[["path",{d:"M5 12h14",key:"1ays0h"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=r("TrendingDown",[["polyline",{points:"22 17 13.5 8.5 8.5 13.5 2 7",key:"1r2t7k"}],["polyline",{points:"16 17 22 17 22 11",key:"11uiuu"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=r("TrendingUp",[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17",key:"126l90"}],["polyline",{points:"16 7 22 7 22 13",key:"kwv8wd"}]]),o={bullish:{tone:"up",icon:f,label:"bullish"},bearish:{tone:"down",icon:b,label:"bearish"},neutral:{tone:"neutral",icon:y,label:"neutral"}};function k({article:s,index:p=0,compact:t=!1}){const i=o[s.sentiment_label]||o.neutral,c=i.icon;return e.jsx(x.a,{href:s.url,target:"_blank",rel:"noopener noreferrer",initial:{opacity:0,y:10},animate:{opacity:1,y:0},transition:{duration:.35,delay:Math.min(p*.04,.4),ease:[.22,1,.36,1]},className:l("group block border-b border-line px-4 py-3.5 transition-colors duration-200 last:border-b-0 hover:bg-raised sm:px-5",t&&"py-3"),children:e.jsxs("div",{className:"flex items-start justify-between gap-3",children:[e.jsxs("div",{className:"min-w-0 flex-1",children:[e.jsxs("div",{className:"flex flex-wrap items-center gap-x-2 gap-y-1",children:[e.jsx("span",{className:"font-mono text-[10px] uppercase tracking-[0.1em] text-patina",children:s.source}),e.jsx("span",{className:"text-faint",children:"·"}),e.jsx("span",{className:"font-mono text-[10px] text-faint",children:d(s.published_at)}),e.jsx(m,{tone:i.tone,icon:c,className:"ml-0.5",children:i.label})]}),e.jsx("h3",{className:l("mt-1.5 font-display font-medium leading-snug tracking-tight text-ink transition-colors group-hover:text-patina",t?"text-[13.5px]":"text-sm"),children:s.title}),!t&&s.summary&&e.jsx("p",{className:"mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted",children:s.summary}),e.jsxs("div",{className:"mt-2 flex flex-wrap items-center gap-1.5",children:[(s.metals||[]).map(a=>e.jsx("span",{className:"rounded border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.08em]",style:{color:a==="copper"?"var(--c-copper)":"var(--c-aluminium)",borderColor:"var(--c-line)"},children:a},a)),(s.tags||[]).slice(0,t?2:4).map(a=>e.jsx("span",{className:"rounded border border-line px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint",children:h(a)},a))]})]}),e.jsx(u,{size:13,className:"mt-1 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"})]})})}function w(){return e.jsxs("div",{className:"space-y-2 border-b border-line px-5 py-4 last:border-b-0",children:[e.jsx(n,{className:"h-2.5 w-32"}),e.jsx(n,{className:"h-3.5 w-full"}),e.jsx(n,{className:"h-3.5 w-4/5"}),e.jsxs("div",{className:"flex gap-1.5 pt-1",children:[e.jsx(n,{className:"h-3 w-14"}),e.jsx(n,{className:"h-3 w-16"})]})]})}export{y as M,w as N,f as T,b as a,k as b};
