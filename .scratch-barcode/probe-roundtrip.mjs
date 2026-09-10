import { init } from "./raster.mjs";
import { rasterSvg, padded } from "./svgraster.mjs";
import { readBarcodes } from "zxing-wasm/reader";
import * as bwipNs from "bwip-js/generic";
const bwip = bwipNs.default ?? bwipNs;
await init();

async function read(svg, bg = [255,255,255]) {
  const img = padded(rasterSvg(svg), 4, 40, bg);
  const r = await readBarcodes(img, { tryHarder: true });
  return r.map((x) => [x.format, x.text]);
}

const opts = (o) => ({ scale: 3, paddingwidth: 10, paddingheight: 4, height: 14, barcolor: "000000", textcolor: "000000", backgroundcolor: "FFFFFF", ...o });

for (const [bcid, text] of [["code128","ABC-123"],["code39","CODE39TEST"],["ean13","590123412345"],["ean8","9520000"],["upca","01234500005"],["upce","0123456"],["itf14","0952123454321"]]) {
  const svg = bwip.toSVG(opts({ bcid, text, includetext: true }));
  console.log(bcid.padEnd(11), JSON.stringify(await read(svg)));
}
for (const [bcid, text] of [["qrcode","HELLO ROUND TRIP"],["datamatrix","DM-TEST-42"],["pdf417","PDF417 TEST"],["azteccode","AZ-TEST"]]) {
  const svg = bwip.toSVG({ bcid, text, scale: 3, paddingwidth: 8, paddingheight: 8, barcolor: "000000", backgroundcolor: "FFFFFF" });
  console.log(bcid.padEnd(11), JSON.stringify(await read(svg)));
}
