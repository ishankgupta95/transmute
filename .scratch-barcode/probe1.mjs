import * as bwipNs from "bwip-js/generic";
const bwip = bwipNs.default ?? bwipNs;

function ok(bcid, text, extra = {}) {
  try {
    bwip.toSVG({ bcid, text, scale: 3, ...extra });
    return null;
  } catch (e) {
    return e.message;
  }
}

function ceiling(bcid, ch, lo, hi, extra = {}) {
  // find max n such that ok
  let good = lo, bad = hi;
  if (ok(bcid, ch.repeat(lo), extra)) return { max: null, err: ok(bcid, ch.repeat(lo), extra) };
  while (bad - good > 1) {
    const mid = (good + bad) >> 1;
    if (ok(bcid, ch.repeat(mid), extra)) bad = mid; else good = mid;
  }
  return { max: good, errAt: ok(bcid, ch.repeat(good + 1), extra) };
}

console.log("code128 digits", JSON.stringify(ceiling("code128", "1", 1, 4000, { height: 12 })));
console.log("code128 ascii ", JSON.stringify(ceiling("code128", "A", 1, 4000, { height: 12 })));
console.log("code39  ascii ", JSON.stringify(ceiling("code39", "A", 1, 4000, { height: 12 })));
console.log("qrcode  digits", JSON.stringify(ceiling("qrcode", "1", 1, 12000)));
console.log("qrcode  alnum ", JSON.stringify(ceiling("qrcode", "A", 1, 12000)));
console.log("qrcode  byte  ", JSON.stringify(ceiling("qrcode", "a", 1, 12000)));
console.log("datamatrix dig", JSON.stringify(ceiling("datamatrix", "1", 1, 12000)));
console.log("pdf417 dig    ", JSON.stringify(ceiling("pdf417", "1", 1, 12000)));
console.log("aztec dig     ", JSON.stringify(ceiling("azteccode", "1", 1, 12000)));
