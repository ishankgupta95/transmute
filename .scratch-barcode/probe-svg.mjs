import * as bwipNs from "bwip-js/generic";
const bwip = bwipNs.default ?? bwipNs;
const svg = bwip.toSVG({ bcid: "ean13", text: "590123412345", scale: 3, height: 14, includetext: true, paddingwidth: 10, paddingheight: 4, barcolor: "000000", textcolor: "000000", backgroundcolor: "FFFFFF" });
console.log(svg.slice(0, 900));
console.log("...len", svg.length);
console.log("---- qr ----");
const qr = bwip.toSVG({ bcid: "qrcode", text: "HI", scale: 3, paddingwidth: 8, paddingheight: 8, barcolor: "112233", backgroundcolor: "FFEEDD" });
console.log(qr.slice(0, 700));
