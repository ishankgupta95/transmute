import { init, decode } from "./raster.mjs";
await init();
const base = { bcid: "upca", text: "01234500005", height: 14, includetext: true, paddingwidth: 10, paddingheight: 4 };
console.log("default formats :", JSON.stringify(await decode(base)));
console.log("formats UPCA    :", JSON.stringify(await decode(base, { tryHarder: true, formats: ["UPC-A"] })));
console.log("formats EAN13   :", JSON.stringify(await decode(base, { tryHarder: true, formats: ["EAN-13"] })));
