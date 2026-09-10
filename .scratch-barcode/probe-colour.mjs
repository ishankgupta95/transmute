import { init } from "./raster.mjs";
import { rasterSvg, padded } from "./svgraster.mjs";
import { readBarcodes } from "zxing-wasm/reader";
import * as bwipNs from "bwip-js/generic";
const bwip = bwipNs.default ?? bwipNs;
await init();

async function read(svg, bgFill) {
  const img = padded(rasterSvg(svg), 4, 40, bgFill);
  const r = await readBarcodes(img, { tryHarder: true, tryRotate: true, tryInvert: true });
  return r.map((x) => [x.format, x.text]);
}
const rgb = (h) => [1,3,5].map(i=>parseInt(h.slice(i,i+2),16));

const cases = [
  ["000000","FFFFFF"], ["FFFFFF","FFFFFF"], ["EEEEEE","FFFFFF"], ["FFFFFF","000000"],
  ["FFFF00","FFFFFF"], ["FF0000","FFFFFF"], ["888888","FFFFFF"], ["000080","FFFFFF"],
  ["333333","CCCCCC"], ["555555","999999"],
];
for (const [fg,bg] of cases) {
  const svg = bwip.toSVG({ bcid:"ean13", text:"590123412345", scale:3, height:14, includetext:true, paddingwidth:10, paddingheight:4, barcolor:fg, textcolor:fg, backgroundcolor:bg });
  const qrsvg = bwip.toSVG({ bcid:"qrcode", text:"HELLO", scale:3, paddingwidth:8, paddingheight:8, barcolor:fg, backgroundcolor:bg });
  console.log(`fg #${fg} bg #${bg}  ean13=${JSON.stringify(await read(svg, rgb("#"+bg)))}  qr=${JSON.stringify(await read(qrsvg, rgb("#"+bg)))}`);
}
