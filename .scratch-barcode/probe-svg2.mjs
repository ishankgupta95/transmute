import * as bwipNs from "bwip-js/generic";
const bwip = bwipNs.default ?? bwipNs;
const qr = bwip.toSVG({ bcid: "qrcode", text: "HI", scale: 3, paddingwidth: 8, paddingheight: 8, barcolor: "112233", backgroundcolor: "FFEEDD" });
// print all tag openings with attributes
for (const m of qr.matchAll(/<[a-z]+[^>]*?(?=d="|\/>|>)/g)) console.log(JSON.stringify(m[0].slice(0,200)));
console.log("=== tail ===");
console.log(qr.slice(-200));
