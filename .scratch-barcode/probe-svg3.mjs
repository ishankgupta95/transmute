import * as bwipNs from "bwip-js/generic";
const bwip = bwipNs.default ?? bwipNs;
const svg = bwip.toSVG({ bcid: "ean13", text: "590123412345", scale: 3, height: 14, includetext: true, paddingwidth: 10, paddingheight: 4, barcolor: "000000", textcolor: "FF0000", backgroundcolor: "FFFFFF" });
for (const m of svg.matchAll(/<path\b[^>]*>/g)) {
  const t = m[0];
  const d = t.match(/ d="([^"]*)"/)?.[1] ?? "";
  console.log(t.replace(/ d="[^"]*"/, ` d="[${d.length} chars, cmds ${[...new Set(d.replace(/[-\d.\s]/g,""))].join("")}]"`));
}
