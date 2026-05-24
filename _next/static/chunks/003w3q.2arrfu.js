(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,98700,e=>{"use strict";var t,n=e.i(43476),r=e.i(71645),a=e.i(78583);let o=(0,e.i(75254).default)("printer",[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]]);var i=e.i(74238),l=e.i(32447),s=e.i(14729);function c({html:e,onDone:t}){let a=(0,r.useRef)(null);return(0,r.useEffect)(()=>{let n=a.current;if(!n)return;let r=!1,o=null;return(async()=>{let a=n.contentWindow,i=n.contentDocument;if(!a||!i)return t();i.open(),i.write(e),i.close();try{i.fonts&&"function"==typeof i.fonts.ready?.then&&await Promise.race([i.fonts.ready,new Promise(e=>setTimeout(e,3e3))])}catch{}if(r)return;let l=()=>{a.removeEventListener("afterprint",l),t()};a.addEventListener("afterprint",l),o=()=>a.removeEventListener("afterprint",l);let s=setTimeout(()=>{r||t()},6e4);o=()=>{clearTimeout(s),a.removeEventListener("afterprint",l)},a.focus(),a.print()})(),()=>{r=!0,o?.()}},[e,t]),(0,n.jsx)("iframe",{ref:a,title:"Markdown to PDF print preview","aria-hidden":"true",className:"absolute -left-[9999px] top-0 h-0 w-0 border-0"})}var d=e.i(20906);let{entries:u,setPrototypeOf:p,isFrozen:m,getPrototypeOf:f,getOwnPropertyDescriptor:g}=Object,{freeze:h,seal:b,create:y}=Object,{apply:x,construct:T}="u">typeof Reflect&&Reflect;h||(h=function(e){return e}),b||(b=function(e){return e}),x||(x=function(e,t){for(var n=arguments.length,r=Array(n>2?n-2:0),a=2;a<n;a++)r[a-2]=arguments[a];return e.apply(t,r)}),T||(T=function(e){for(var t=arguments.length,n=Array(t>1?t-1:0),r=1;r<t;r++)n[r-1]=arguments[r];return new e(...n)});let A=j(Array.prototype.forEach),k=j(Array.prototype.lastIndexOf),w=j(Array.prototype.pop),_=j(Array.prototype.push),S=j(Array.prototype.splice),v=Array.isArray,E=j(String.prototype.toLowerCase),N=j(String.prototype.toString),R=j(String.prototype.match),D=j(String.prototype.replace),O=j(String.prototype.indexOf),C=j(String.prototype.trim),I=j(Number.prototype.toString),L=j(Boolean.prototype.toString),M="u"<typeof BigInt?null:j(BigInt.prototype.toString),F="u"<typeof Symbol?null:j(Symbol.prototype.toString),P=j(Object.prototype.hasOwnProperty),z=j(Object.prototype.toString),U=j(RegExp.prototype.test),B=(t=TypeError,function(){for(var e=arguments.length,n=Array(e),r=0;r<e;r++)n[r]=arguments[r];return T(t,n)});function j(e){return function(t){t instanceof RegExp&&(t.lastIndex=0);for(var n=arguments.length,r=Array(n>1?n-1:0),a=1;a<n;a++)r[a-1]=arguments[a];return x(e,t,r)}}function H(e,t){let n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:E;if(p&&p(e,null),!v(t))return e;let r=t.length;for(;r--;){let a=t[r];if("string"==typeof a){let e=n(a);e!==a&&(m(t)||(t[r]=e),a=e)}e[a]=!0}return e}function $(e){let t=y(null);for(let[n,r]of u(e))P(e,n)&&(v(r)?t[n]=function(e){for(let t=0;t<e.length;t++)P(e,t)||(e[t]=null);return e}(r):r&&"object"==typeof r&&r.constructor===Object?t[n]=$(r):t[n]=r);return t}function W(e,t){for(;null!==e;){let n=g(e,t);if(n){if(n.get)return j(n.get);if("function"==typeof n.value)return j(n.value)}e=f(e)}return function(){return null}}let G=h(["a","abbr","acronym","address","area","article","aside","audio","b","bdi","bdo","big","blink","blockquote","body","br","button","canvas","caption","center","cite","code","col","colgroup","content","data","datalist","dd","decorator","del","details","dfn","dialog","dir","div","dl","dt","element","em","fieldset","figcaption","figure","font","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","img","input","ins","kbd","label","legend","li","main","map","mark","marquee","menu","menuitem","meter","nav","nobr","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","search","section","select","shadow","slot","small","source","spacer","span","strike","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","tr","track","tt","u","ul","var","video","wbr"]),Y=h(["svg","a","altglyph","altglyphdef","altglyphitem","animatecolor","animatemotion","animatetransform","circle","clippath","defs","desc","ellipse","enterkeyhint","exportparts","filter","font","g","glyph","glyphref","hkern","image","inputmode","line","lineargradient","marker","mask","metadata","mpath","part","path","pattern","polygon","polyline","radialgradient","rect","stop","style","switch","symbol","text","textpath","title","tref","tspan","view","vkern"]),q=h(["feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feDistantLight","feDropShadow","feFlood","feFuncA","feFuncB","feFuncG","feFuncR","feGaussianBlur","feImage","feMerge","feMergeNode","feMorphology","feOffset","fePointLight","feSpecularLighting","feSpotLight","feTile","feTurbulence"]),X=h(["animate","color-profile","cursor","discard","font-face","font-face-format","font-face-name","font-face-src","font-face-uri","foreignobject","hatch","hatchpath","mesh","meshgradient","meshpatch","meshrow","missing-glyph","script","set","solidcolor","unknown","use"]),K=h(["math","menclose","merror","mfenced","mfrac","mglyph","mi","mlabeledtr","mmultiscripts","mn","mo","mover","mpadded","mphantom","mroot","mrow","ms","mspace","msqrt","mstyle","msub","msup","msubsup","mtable","mtd","mtext","mtr","munder","munderover","mprescripts"]),V=h(["maction","maligngroup","malignmark","mlongdiv","mscarries","mscarry","msgroup","mstack","msline","msrow","semantics","annotation","annotation-xml","mprescripts","none"]),Z=h(["#text"]),J=h(["accept","action","align","alt","autocapitalize","autocomplete","autopictureinpicture","autoplay","background","bgcolor","border","capture","cellpadding","cellspacing","checked","cite","class","clear","color","cols","colspan","controls","controlslist","coords","crossorigin","datetime","decoding","default","dir","disabled","disablepictureinpicture","disableremoteplayback","download","draggable","enctype","enterkeyhint","exportparts","face","for","headers","height","hidden","high","href","hreflang","id","inert","inputmode","integrity","ismap","kind","label","lang","list","loading","loop","low","max","maxlength","media","method","min","minlength","multiple","muted","name","nonce","noshade","novalidate","nowrap","open","optimum","part","pattern","placeholder","playsinline","popover","popovertarget","popovertargetaction","poster","preload","pubdate","radiogroup","readonly","rel","required","rev","reversed","role","rows","rowspan","spellcheck","scope","selected","shape","size","sizes","slot","span","srclang","start","src","srcset","step","style","summary","tabindex","title","translate","type","usemap","valign","value","width","wrap","xmlns"]),Q=h(["accent-height","accumulate","additive","alignment-baseline","amplitude","ascent","attributename","attributetype","azimuth","basefrequency","baseline-shift","begin","bias","by","class","clip","clippathunits","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","cx","cy","d","dx","dy","diffuseconstant","direction","display","divisor","dur","edgemode","elevation","end","exponent","fill","fill-opacity","fill-rule","filter","filterunits","flood-color","flood-opacity","font-family","font-size","font-size-adjust","font-stretch","font-style","font-variant","font-weight","fx","fy","g1","g2","glyph-name","glyphref","gradientunits","gradienttransform","height","href","id","image-rendering","in","in2","intercept","k","k1","k2","k3","k4","kerning","keypoints","keysplines","keytimes","lang","lengthadjust","letter-spacing","kernelmatrix","kernelunitlength","lighting-color","local","marker-end","marker-mid","marker-start","markerheight","markerunits","markerwidth","maskcontentunits","maskunits","max","mask","mask-type","media","method","mode","min","name","numoctaves","offset","operator","opacity","order","orient","orientation","origin","overflow","paint-order","path","pathlength","patterncontentunits","patterntransform","patternunits","points","preservealpha","preserveaspectratio","primitiveunits","r","rx","ry","radius","refx","refy","repeatcount","repeatdur","restart","result","rotate","scale","seed","shape-rendering","slope","specularconstant","specularexponent","spreadmethod","startoffset","stddeviation","stitchtiles","stop-color","stop-opacity","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke","stroke-width","style","surfacescale","systemlanguage","tabindex","tablevalues","targetx","targety","transform","transform-origin","text-anchor","text-decoration","text-rendering","textlength","type","u1","u2","unicode","values","viewbox","visibility","version","vert-adv-y","vert-origin-x","vert-origin-y","width","word-spacing","wrap","writing-mode","xchannelselector","ychannelselector","x","x1","x2","xmlns","y","y1","y2","z","zoomandpan"]),ee=h(["accent","accentunder","align","bevelled","close","columnalign","columnlines","columnspacing","columnspan","denomalign","depth","dir","display","displaystyle","encoding","fence","frame","height","href","id","largeop","length","linethickness","lquote","lspace","mathbackground","mathcolor","mathsize","mathvariant","maxsize","minsize","movablelimits","notation","numalign","open","rowalign","rowlines","rowspacing","rowspan","rspace","rquote","scriptlevel","scriptminsize","scriptsizemultiplier","selection","separator","separators","stretchy","subscriptshift","supscriptshift","symmetric","voffset","width","xmlns"]),et=h(["xlink:href","xml:id","xlink:title","xml:space","xmlns:xlink"]),en=b(/\{\{[\w\W]*|[\w\W]*\}\}/gm),er=b(/<%[\w\W]*|[\w\W]*%>/gm),ea=b(/\$\{[\w\W]*/gm),eo=b(/^data-[\-\w.\u00B7-\uFFFF]+$/),ei=b(/^aria-[\-\w]+$/),el=b(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i),es=b(/^(?:\w+script|data):/i),ec=b(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g),ed=b(/^html$/i);var eu=Object.freeze({__proto__:null,ARIA_ATTR:ei,ATTR_WHITESPACE:ec,CUSTOM_ELEMENT:b(/^[a-z][.\w]*(-[.\w]+)+$/i),DATA_ATTR:eo,DOCTYPE_NAME:ed,ERB_EXPR:er,IS_ALLOWED_URI:el,IS_SCRIPT_OR_DATA:es,MUSTACHE_EXPR:en,TMPLIT_EXPR:ea});let ep=function(e,t){if("object"!=typeof e||"function"!=typeof e.createPolicy)return null;let n=null,r="data-tt-policy-suffix";t&&t.hasAttribute(r)&&(n=t.getAttribute(r));let a="dompurify"+(n?"#"+n:"");try{return e.createPolicy(a,{createHTML:e=>e,createScriptURL:e=>e})}catch(e){return console.warn("TrustedTypes policy "+a+" could not be created."),null}},em=function(){return{afterSanitizeAttributes:[],afterSanitizeElements:[],afterSanitizeShadowDOM:[],beforeSanitizeAttributes:[],beforeSanitizeElements:[],beforeSanitizeShadowDOM:[],uponSanitizeAttribute:[],uponSanitizeElement:[],uponSanitizeShadowNode:[]}};var ef=function e(){let t,n=arguments.length>0&&void 0!==arguments[0]?arguments[0]:"u"<typeof window?null:window,r=t=>e(t);if(r.version="3.4.2",r.removed=[],!n||!n.document||9!==n.document.nodeType||!n.Element)return r.isSupported=!1,r;let{document:a}=n,o=a,i=o.currentScript,{DocumentFragment:l,HTMLTemplateElement:s,Node:c,Element:d,NodeFilter:p,NamedNodeMap:m=n.NamedNodeMap||n.MozNamedAttrMap,HTMLFormElement:f,DOMParser:g,trustedTypes:b}=n,x=d.prototype,T=W(x,"cloneNode"),j=W(x,"remove"),en=W(x,"nextSibling"),er=W(x,"childNodes"),ea=W(x,"parentNode");if("function"==typeof s){let e=a.createElement("template");e.content&&e.content.ownerDocument&&(a=e.content.ownerDocument)}let eo="",{implementation:ei,createNodeIterator:es,createDocumentFragment:ec,getElementsByTagName:ef}=a,{importNode:eg}=o,eh=em();r.isSupported="function"==typeof u&&"function"==typeof ea&&ei&&void 0!==ei.createHTMLDocument;let{MUSTACHE_EXPR:eb,ERB_EXPR:ey,TMPLIT_EXPR:ex,DATA_ATTR:eT,ARIA_ATTR:eA,IS_SCRIPT_OR_DATA:ek,ATTR_WHITESPACE:ew,CUSTOM_ELEMENT:e_}=eu,{IS_ALLOWED_URI:eS}=eu,ev=null,eE=H({},[...G,...Y,...q,...K,...Z]),eN=null,eR=H({},[...J,...Q,...ee,...et]),eD=Object.seal(y(null,{tagNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},allowCustomizedBuiltInElements:{writable:!0,configurable:!1,enumerable:!0,value:!1}})),eO=null,eC=null,eI=Object.seal(y(null,{tagCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeCheck:{writable:!0,configurable:!1,enumerable:!0,value:null}})),eL=!0,eM=!0,eF=!1,eP=!0,ez=!1,eU=!0,eB=!1,ej=!1,eH=!1,e$=!1,eW=!1,eG=!1,eY=!0,eq=!1,eX="user-content-",eK=!0,eV=!1,eZ={},eJ=null,eQ=H({},["annotation-xml","audio","colgroup","desc","foreignobject","head","iframe","math","mi","mn","mo","ms","mtext","noembed","noframes","noscript","plaintext","script","style","svg","template","thead","title","video","xmp"]),e0=null,e1=H({},["audio","video","img","source","image","track"]),e2=null,e3=H({},["alt","class","for","id","label","name","pattern","placeholder","role","summary","title","value","style","xmlns"]),e4="http://www.w3.org/1998/Math/MathML",e5="http://www.w3.org/2000/svg",e8="http://www.w3.org/1999/xhtml",e6=e8,e7=!1,e9=null,te=H({},[e4,e5,e8],N),tt=H({},["mi","mo","mn","ms","mtext"]),tn=H({},["annotation-xml"]),tr=H({},["title","style","font","a","script"]),ta=null,to=["application/xhtml+xml","text/html"],ti=null,tl=null,ts=a.createElement("form"),tc=function(e){return e instanceof RegExp||e instanceof Function},td=function(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};if(tl&&tl===e)return;e&&"object"==typeof e||(e={}),e=$(e),ti="application/xhtml+xml"===(ta=-1===to.indexOf(e.PARSER_MEDIA_TYPE)?"text/html":e.PARSER_MEDIA_TYPE)?N:E,ev=P(e,"ALLOWED_TAGS")&&v(e.ALLOWED_TAGS)?H({},e.ALLOWED_TAGS,ti):eE,eN=P(e,"ALLOWED_ATTR")&&v(e.ALLOWED_ATTR)?H({},e.ALLOWED_ATTR,ti):eR,e9=P(e,"ALLOWED_NAMESPACES")&&v(e.ALLOWED_NAMESPACES)?H({},e.ALLOWED_NAMESPACES,N):te,e2=P(e,"ADD_URI_SAFE_ATTR")&&v(e.ADD_URI_SAFE_ATTR)?H($(e3),e.ADD_URI_SAFE_ATTR,ti):e3,e0=P(e,"ADD_DATA_URI_TAGS")&&v(e.ADD_DATA_URI_TAGS)?H($(e1),e.ADD_DATA_URI_TAGS,ti):e1,eJ=P(e,"FORBID_CONTENTS")&&v(e.FORBID_CONTENTS)?H({},e.FORBID_CONTENTS,ti):eQ,eO=P(e,"FORBID_TAGS")&&v(e.FORBID_TAGS)?H({},e.FORBID_TAGS,ti):$({}),eC=P(e,"FORBID_ATTR")&&v(e.FORBID_ATTR)?H({},e.FORBID_ATTR,ti):$({}),eZ=!!P(e,"USE_PROFILES")&&(e.USE_PROFILES&&"object"==typeof e.USE_PROFILES?$(e.USE_PROFILES):e.USE_PROFILES),eL=!1!==e.ALLOW_ARIA_ATTR,eM=!1!==e.ALLOW_DATA_ATTR,eF=e.ALLOW_UNKNOWN_PROTOCOLS||!1,eP=!1!==e.ALLOW_SELF_CLOSE_IN_ATTR,ez=e.SAFE_FOR_TEMPLATES||!1,eU=!1!==e.SAFE_FOR_XML,eB=e.WHOLE_DOCUMENT||!1,e$=e.RETURN_DOM||!1,eW=e.RETURN_DOM_FRAGMENT||!1,eG=e.RETURN_TRUSTED_TYPE||!1,eH=e.FORCE_BODY||!1,eY=!1!==e.SANITIZE_DOM,eq=e.SANITIZE_NAMED_PROPS||!1,eK=!1!==e.KEEP_CONTENT,eV=e.IN_PLACE||!1,eS=!function(e){try{return U(e,""),!0}catch(e){return!1}}(e.ALLOWED_URI_REGEXP)?el:e.ALLOWED_URI_REGEXP,e6="string"==typeof e.NAMESPACE?e.NAMESPACE:e8,tt=P(e,"MATHML_TEXT_INTEGRATION_POINTS")&&e.MATHML_TEXT_INTEGRATION_POINTS&&"object"==typeof e.MATHML_TEXT_INTEGRATION_POINTS?$(e.MATHML_TEXT_INTEGRATION_POINTS):H({},["mi","mo","mn","ms","mtext"]),tn=P(e,"HTML_INTEGRATION_POINTS")&&e.HTML_INTEGRATION_POINTS&&"object"==typeof e.HTML_INTEGRATION_POINTS?$(e.HTML_INTEGRATION_POINTS):H({},["annotation-xml"]);let n=P(e,"CUSTOM_ELEMENT_HANDLING")&&e.CUSTOM_ELEMENT_HANDLING&&"object"==typeof e.CUSTOM_ELEMENT_HANDLING?$(e.CUSTOM_ELEMENT_HANDLING):y(null);if(eD=y(null),P(n,"tagNameCheck")&&tc(n.tagNameCheck)&&(eD.tagNameCheck=n.tagNameCheck),P(n,"attributeNameCheck")&&tc(n.attributeNameCheck)&&(eD.attributeNameCheck=n.attributeNameCheck),P(n,"allowCustomizedBuiltInElements")&&"boolean"==typeof n.allowCustomizedBuiltInElements&&(eD.allowCustomizedBuiltInElements=n.allowCustomizedBuiltInElements),ez&&(eM=!1),eW&&(e$=!0),eZ&&(ev=H({},Z),eN=y(null),!0===eZ.html&&(H(ev,G),H(eN,J)),!0===eZ.svg&&(H(ev,Y),H(eN,Q),H(eN,et)),!0===eZ.svgFilters&&(H(ev,q),H(eN,Q),H(eN,et)),!0===eZ.mathMl&&(H(ev,K),H(eN,ee),H(eN,et))),eI.tagCheck=null,eI.attributeCheck=null,P(e,"ADD_TAGS")&&("function"==typeof e.ADD_TAGS?eI.tagCheck=e.ADD_TAGS:v(e.ADD_TAGS)&&(ev===eE&&(ev=$(ev)),H(ev,e.ADD_TAGS,ti))),P(e,"ADD_ATTR")&&("function"==typeof e.ADD_ATTR?eI.attributeCheck=e.ADD_ATTR:v(e.ADD_ATTR)&&(eN===eR&&(eN=$(eN)),H(eN,e.ADD_ATTR,ti))),P(e,"ADD_URI_SAFE_ATTR")&&v(e.ADD_URI_SAFE_ATTR)&&H(e2,e.ADD_URI_SAFE_ATTR,ti),P(e,"FORBID_CONTENTS")&&v(e.FORBID_CONTENTS)&&(eJ===eQ&&(eJ=$(eJ)),H(eJ,e.FORBID_CONTENTS,ti)),P(e,"ADD_FORBID_CONTENTS")&&v(e.ADD_FORBID_CONTENTS)&&(eJ===eQ&&(eJ=$(eJ)),H(eJ,e.ADD_FORBID_CONTENTS,ti)),eK&&(ev["#text"]=!0),eB&&H(ev,["html","head","body"]),ev.table&&(H(ev,["tbody"]),delete eO.tbody),e.TRUSTED_TYPES_POLICY){if("function"!=typeof e.TRUSTED_TYPES_POLICY.createHTML)throw B('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');if("function"!=typeof e.TRUSTED_TYPES_POLICY.createScriptURL)throw B('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');eo=(t=e.TRUSTED_TYPES_POLICY).createHTML("")}else void 0===t&&(t=ep(b,i)),null!==t&&"string"==typeof eo&&(eo=t.createHTML(""));h&&h(e),tl=e},tu=H({},[...Y,...q,...X]),tp=H({},[...K,...V]),tm=function(e){let t=ea(e);t&&t.tagName||(t={namespaceURI:e6,tagName:"template"});let n=E(e.tagName),r=E(t.tagName);return!!e9[e.namespaceURI]&&(e.namespaceURI===e5?t.namespaceURI===e8?"svg"===n:t.namespaceURI===e4?"svg"===n&&("annotation-xml"===r||tt[r]):!!tu[n]:e.namespaceURI===e4?t.namespaceURI===e8?"math"===n:t.namespaceURI===e5?"math"===n&&tn[r]:!!tp[n]:e.namespaceURI===e8?(t.namespaceURI!==e5||!!tn[r])&&(t.namespaceURI!==e4||!!tt[r])&&!tp[n]&&(tr[n]||!tu[n]):"application/xhtml+xml"===ta&&!!e9[e.namespaceURI])},tf=function(e){_(r.removed,{element:e});try{ea(e).removeChild(e)}catch(t){j(e)}},tg=function(e,t){try{_(r.removed,{attribute:t.getAttributeNode(e),from:t})}catch(e){_(r.removed,{attribute:null,from:t})}if(t.removeAttribute(e),"is"===e)if(e$||eW)try{tf(t)}catch(e){}else try{t.setAttribute(e,"")}catch(e){}},th=function(e){let n=null,r=null;if(eH)e="<remove></remove>"+e;else{let t=R(e,/^[\r\n\t ]+/);r=t&&t[0]}"application/xhtml+xml"===ta&&e6===e8&&(e='<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>'+e+"</body></html>");let o=t?t.createHTML(e):e;if(e6===e8)try{n=new g().parseFromString(o,ta)}catch(e){}if(!n||!n.documentElement){n=ei.createDocument(e6,"template",null);try{n.documentElement.innerHTML=e7?eo:o}catch(e){}}let i=n.body||n.documentElement;return(e&&r&&i.insertBefore(a.createTextNode(r),i.childNodes[0]||null),e6===e8)?ef.call(n,eB?"html":"body")[0]:eB?n.documentElement:i},tb=function(e){return es.call(e.ownerDocument||e,e,p.SHOW_ELEMENT|p.SHOW_COMMENT|p.SHOW_TEXT|p.SHOW_PROCESSING_INSTRUCTION|p.SHOW_CDATA_SECTION,null)},ty=function(e){return e instanceof f&&("string"!=typeof e.nodeName||"string"!=typeof e.textContent||"function"!=typeof e.removeChild||!(e.attributes instanceof m)||"function"!=typeof e.removeAttribute||"function"!=typeof e.setAttribute||"string"!=typeof e.namespaceURI||"function"!=typeof e.insertBefore||"function"!=typeof e.hasChildNodes)},tx=function(e){return"function"==typeof c&&e instanceof c};function tT(e,t,n){A(e,e=>{e.call(r,t,n,tl)})}let tA=function(e){let t=null;if(tT(eh.beforeSanitizeElements,e,null),ty(e))return tf(e),!0;let n=ti(e.nodeName);if(tT(eh.uponSanitizeElement,e,{tagName:n,allowedTags:ev}),eU&&e.hasChildNodes()&&!tx(e.firstElementChild)&&U(/<[/\w!]/g,e.innerHTML)&&U(/<[/\w!]/g,e.textContent)||eU&&e.namespaceURI===e8&&"style"===n&&tx(e.firstElementChild)||7===e.nodeType||eU&&8===e.nodeType&&U(/<[/\w]/g,e.data))return tf(e),!0;if(eO[n]||!(eI.tagCheck instanceof Function&&eI.tagCheck(n))&&!ev[n]){if(!eO[n]&&t_(n)&&(eD.tagNameCheck instanceof RegExp&&U(eD.tagNameCheck,n)||eD.tagNameCheck instanceof Function&&eD.tagNameCheck(n)))return!1;if(eK&&!eJ[n]){let t=ea(e)||e.parentNode,n=er(e)||e.childNodes;if(n&&t){let r=n.length;for(let a=r-1;a>=0;--a){let r=T(n[a],!0);t.insertBefore(r,en(e))}}}return tf(e),!0}return e instanceof d&&!tm(e)||("noscript"===n||"noembed"===n||"noframes"===n)&&U(/<\/no(script|embed|frames)/i,e.innerHTML)?(tf(e),!0):(ez&&3===e.nodeType&&(t=e.textContent,A([eb,ey,ex],e=>{t=D(t,e," ")}),e.textContent!==t&&(_(r.removed,{element:e.cloneNode()}),e.textContent=t)),tT(eh.afterSanitizeElements,e,null),!1)},tk=function(e,t,n){if(eC[t]||eY&&("id"===t||"name"===t)&&(n in a||n in ts))return!1;let r=eN[t]||eI.attributeCheck instanceof Function&&eI.attributeCheck(t,e);if(eM&&!eC[t]&&U(eT,t));else if(eL&&U(eA,t));else if(!r||eC[t]){if(!(t_(e)&&(eD.tagNameCheck instanceof RegExp&&U(eD.tagNameCheck,e)||eD.tagNameCheck instanceof Function&&eD.tagNameCheck(e))&&(eD.attributeNameCheck instanceof RegExp&&U(eD.attributeNameCheck,t)||eD.attributeNameCheck instanceof Function&&eD.attributeNameCheck(t,e))||"is"===t&&eD.allowCustomizedBuiltInElements&&(eD.tagNameCheck instanceof RegExp&&U(eD.tagNameCheck,n)||eD.tagNameCheck instanceof Function&&eD.tagNameCheck(n))))return!1}else if(e2[t]);else if(U(eS,D(n,ew,"")));else if(("src"===t||"xlink:href"===t||"href"===t)&&"script"!==e&&0===O(n,"data:")&&e0[e]);else if(eF&&!U(ek,D(n,ew,"")));else if(n)return!1;return!0},tw=H({},["annotation-xml","color-profile","font-face","font-face-format","font-face-name","font-face-src","font-face-uri","missing-glyph"]),t_=function(e){return!tw[E(e)]&&U(e_,e)},tS=function(e){tT(eh.beforeSanitizeAttributes,e,null);let{attributes:n}=e;if(!n||ty(e))return;let a={attrName:"",attrValue:"",keepAttr:!0,allowedAttributes:eN,forceKeepAttr:void 0},o=n.length;for(;o--;){let{name:i,namespaceURI:l,value:s}=n[o],c=ti(i),d="value"===i?s:C(s);if(a.attrName=c,a.attrValue=d,a.keepAttr=!0,a.forceKeepAttr=void 0,tT(eh.uponSanitizeAttribute,e,a),d=a.attrValue,eq&&("id"===c||"name"===c)&&0!==O(d,eX)&&(tg(i,e),d=eX+d),eU&&U(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i,d)||"attributename"===c&&R(d,"href")){tg(i,e);continue}if(a.forceKeepAttr)continue;if(!a.keepAttr||!eP&&U(/\/>/i,d)){tg(i,e);continue}ez&&A([eb,ey,ex],e=>{d=D(d,e," ")});let u=ti(e.nodeName);if(!tk(u,c,d)){tg(i,e);continue}if(t&&"object"==typeof b&&"function"==typeof b.getAttributeType)if(l);else switch(b.getAttributeType(u,c)){case"TrustedHTML":d=t.createHTML(d);break;case"TrustedScriptURL":d=t.createScriptURL(d)}if(d!==s)try{l?e.setAttributeNS(l,i,d):e.setAttribute(i,d),ty(e)?tf(e):w(r.removed)}catch(t){tg(i,e)}}tT(eh.afterSanitizeAttributes,e,null)},tv=function(e){let t=null,n=tb(e);for(tT(eh.beforeSanitizeShadowDOM,e,null);t=n.nextNode();)tT(eh.uponSanitizeShadowNode,t,null),tA(t),tS(t),t.content instanceof l&&tv(t.content);tT(eh.afterSanitizeShadowDOM,e,null)};return r.sanitize=function(e){let n=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{},a=null,i=null,s=null,d=null;if((e7=!e)&&(e="<!-->"),"string"!=typeof e&&!tx(e)&&"string"!=typeof(e=function(e){switch(typeof e){case"string":return e;case"number":return I(e);case"boolean":return L(e);case"bigint":return M?M(e):"0";case"symbol":return F?F(e):"Symbol()";case"undefined":default:return z(e);case"function":case"object":{if(null===e)return z(e);let t=W(e,"toString");if("function"==typeof t){let n=t(e);return"string"==typeof n?n:z(n)}return z(e)}}}(e)))throw B("dirty is not a string, aborting");if(!r.isSupported)return e;if(ej||td(n),r.removed=[],"string"==typeof e&&(eV=!1),eV){let t=e.nodeName;if("string"==typeof t){let e=ti(t);if(!ev[e]||eO[e])throw B("root node is forbidden and cannot be sanitized in-place")}}else if(e instanceof c)1===(i=(a=th("<!---->")).ownerDocument.importNode(e,!0)).nodeType&&"BODY"===i.nodeName||"HTML"===i.nodeName?a=i:a.appendChild(i);else{if(!e$&&!ez&&!eB&&-1===e.indexOf("<"))return t&&eG?t.createHTML(e):e;if(!(a=th(e)))return e$?null:eG?eo:""}a&&eH&&tf(a.firstChild);let u=tb(eV?e:a);for(;s=u.nextNode();)tA(s),tS(s),s.content instanceof l&&tv(s.content);if(eV)return e;if(e$){if(ez){a.normalize();let e=a.innerHTML;A([eb,ey,ex],t=>{e=D(e,t," ")}),a.innerHTML=e}if(eW)for(d=ec.call(a.ownerDocument);a.firstChild;)d.appendChild(a.firstChild);else d=a;return(eN.shadowroot||eN.shadowrootmode)&&(d=eg.call(o,d,!0)),d}let p=eB?a.outerHTML:a.innerHTML;return eB&&ev["!doctype"]&&a.ownerDocument&&a.ownerDocument.doctype&&a.ownerDocument.doctype.name&&U(ed,a.ownerDocument.doctype.name)&&(p="<!DOCTYPE "+a.ownerDocument.doctype.name+">\n"+p),ez&&A([eb,ey,ex],e=>{p=D(p,e," ")}),t&&eG?t.createHTML(p):p},r.setConfig=function(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};td(e),ej=!0},r.clearConfig=function(){tl=null,ej=!1},r.isValidAttribute=function(e,t,n){return tl||td({}),tk(ti(e),ti(t),n)},r.addHook=function(e,t){"function"==typeof t&&_(eh[e],t)},r.removeHook=function(e,t){if(void 0!==t){let n=k(eh[e],t);return -1===n?void 0:S(eh[e],n,1)[0]}return w(eh[e])},r.removeHooks=function(e){eh[e]=[]},r.removeAllHooks=function(){eh=em()},r}();let eg=null;async function eh(){return eg||(eg=(async()=>{try{let[{createHighlighterCore:t},{createJavaScriptRegexEngine:n}]=await Promise.all([e.A(82372),e.A(37425)]);return await t({themes:[e.A(73385),e.A(72527)],langs:[e.A(36335),e.A(31250),e.A(62408),e.A(14235),e.A(5665),e.A(68715),e.A(69140),e.A(54147),e.A(38315),e.A(83870),e.A(51672),e.A(3301),e.A(23595),e.A(39726),e.A(76241),e.A(81293),e.A(17030),e.A(12149),e.A(91731)],engine:n()})}catch{return null}})()),eg}let eb={javascript:"js",typescript:"ts",python:"python",py:"python",shell:"bash",sh:"bash",zsh:"bash",yml:"yaml",markdown:"markdown",md:"markdown"};function ey(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function ex(e,t={}){var n;let r="dark"===(t.theme??"light")?"github-dark":"github-light",a=new d.Marked({gfm:!0,breaks:!1,async:!0});return a.use({async:!0,async walkTokens(e){if("code"!==e.type)return;let t=(e.lang??"").trim().toLowerCase();if(!t)return;let n=await eh();if(!n)return;let a=eb[t]??t;if(n.getLoadedLanguages().includes(a))try{e.__highlighted=n.codeToHtml(e.text,{lang:a,theme:r})}catch{}},renderer:{code(e){let t=e.__highlighted;if(t)return t+"\n";let n=e.lang?` data-lang="${ey(e.lang)}"`:"";return`<pre class="md-pdf-code-fallback"${n}><code>${ey(e.text)}
</code></pre>
`},checkbox:({checked:e})=>e?"☑ ":"☐ "}}),n=await a.parse(e),ef.sanitize(n,{ADD_ATTR:["style","class"],FORBID_TAGS:["script","style","iframe","object","embed","form"],FORBID_ATTR:["onerror","onload","onclick","onmouseover","onfocus"]})}var eT=e.i(49838);let eA=`# Hello, Markdown

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
`;function ek({mode:e,onChange:t}){return(0,n.jsxs)("div",{className:"inline-flex items-center rounded-md border border-border bg-bg-elevated p-0.5",role:"tablist","aria-label":"Input mode",children:[(0,n.jsxs)("button",{type:"button",role:"tab","aria-selected":"paste"===e,onClick:()=>t("paste"),className:(0,eT.cn)("inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors min-h-9","paste"===e?"bg-accent-muted text-accent":"text-text-muted hover:text-text-secondary"),children:[(0,n.jsx)(a.FileText,{size:13,"aria-hidden":"true"})," Paste markdown"]}),(0,n.jsx)("button",{type:"button",role:"tab","aria-selected":"upload"===e,onClick:()=>t("upload"),className:(0,eT.cn)("inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors min-h-9","upload"===e?"bg-accent-muted text-accent":"text-text-muted hover:text-text-secondary"),children:"Upload .md"})]})}function ew({label:e,value:t,onChange:r,options:a}){return(0,n.jsxs)("div",{className:"inline-flex items-center gap-2",children:[(0,n.jsx)("span",{className:"text-xs text-text-muted",children:e}),(0,n.jsx)("div",{className:"inline-flex rounded-md border border-border bg-bg-elevated p-0.5",role:"group","aria-label":e,children:a.map(e=>(0,n.jsx)("button",{type:"button",onClick:()=>r(e.value),"aria-pressed":t===e.value,className:(0,eT.cn)("rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",t===e.value?"bg-accent-muted text-accent":"text-text-muted hover:text-text-secondary"),children:e.label},e.value))})]})}e.s(["MarkdownToPdfUI",0,function(){let[e,t]=(0,r.useState)("paste"),[a,d]=(0,r.useState)(""),[u,p]=(0,r.useState)("light"),[m,f]=(0,r.useState)("serif"),[g,h]=(0,r.useState)(""),[b,y]=(0,r.useState)(null),[x,T]=(0,r.useState)(null),[A,k]=(0,r.useState)(null),w=(0,r.useRef)(null);(0,r.useEffect)(()=>{w.current&&clearTimeout(w.current);let e=!1;return w.current=setTimeout(async()=>{if(!a.trim()){e||h("");return}try{let t=await ex(a,{theme:u,font:m});e||h(t)}catch(t){e||y(t instanceof Error?t.message:"Failed to render preview")}},200),()=>{e=!0,w.current&&clearTimeout(w.current)}},[a,u,m]);let _=(0,r.useCallback)(async e=>{y(null);let t=e[0];if(!t)return;if(t.size>0xa00000)return void y(`File is too large (${(t.size/1024/1024).toFixed(1)} MB). Limit is 10 MB.`);let n=t.name.toLowerCase();if(!(n.endsWith(".md")||n.endsWith(".markdown")||n.endsWith(".txt")||"text/markdown"===t.type||"text/plain"===t.type||""===t.type))return void y("Unsupported file type. Upload a .md, .markdown, or .txt file.");try{let e=await t.text();d(e)}catch(e){y(e instanceof Error?e.message:"Failed to read file")}},[]),S=(0,r.useCallback)(async()=>{if(y(null),a.trim()){k("Preparing PDF…");try{let e,t=await ex(a,{theme:u,font:m}),n=function({bodyHtml:e,title:t,theme:n,font:r,pageSize:a="A4"}){let o=function({theme:e,font:t,pageSize:n="A4"}){let r="dark"===e?{bg:"#1a1814",text:"#f0eee8",textMuted:"#b8b6ae",rule:"#3a3733",codeBg:"#22201c",inlineCodeBg:"#2a2723",blockquoteBar:"#c9b88a",link:"#e0c374",tableHeaderBg:"#22201c"}:{bg:"#fdfdfb",text:"#1f1d1a",textMuted:"#5a5852",rule:"#e8e6e0",codeBg:"#f7f5ef",inlineCodeBg:"#f3efe7",blockquoteBar:"#c9b88a",link:"#9a7b1f",tableHeaderBg:"#f7f5ef"},a='"Syne", "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',o='"JetBrains Mono", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace';return`
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@400;500;600;700&family=Syne:wght@600;700&family=JetBrains+Mono:wght@400;700&display=swap');

@page {
  size: ${n};
  margin: 18mm 16mm;
}
@page :first {
  margin-top: 28mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: ${r.bg};
  color: ${r.text};
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
  font-family: ${a};
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: ${r.text};
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
  border-bottom: 1px solid ${r.rule};
}
h3 { font-size: 14pt; margin: 16pt 0 8pt; }
h4 { font-size: 12pt; margin: 14pt 0 6pt; }
h5, h6 { font-size: 11pt; margin: 12pt 0 4pt; color: ${r.textMuted}; }

p {
  margin: 0 0 10pt;
  orphans: 3;
  widows: 3;
}

a {
  color: ${r.link};
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media print {
  /* Reveal the underlying URL for offline readers, but skip in-document anchors. */
  a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 0.85em;
    color: ${r.textMuted};
    word-break: break-all;
  }
}

strong { font-weight: 600; }
em { font-style: italic; }
del { text-decoration: line-through; color: ${r.textMuted}; }

ul, ol {
  margin: 0 0 10pt;
  padding-left: 1.4em;
}
li { margin: 4pt 0; }
li > ul, li > ol { margin: 4pt 0; }

blockquote {
  margin: 12pt 0;
  padding: 0 0 0 16px;
  border-left: 4px solid ${r.blockquoteBar};
  color: ${r.textMuted};
  font-size: 0.96em;
  font-style: italic;
  break-inside: avoid;
  page-break-inside: avoid;
}
blockquote p { margin: 0 0 6pt; }
blockquote p:last-child { margin: 0; }

code {
  font-family: ${o};
  font-size: 0.92em;
  background: ${r.inlineCodeBg};
  color: ${r.text};
  padding: 2px 6px;
  border-radius: 4px;
}

pre {
  margin: 12pt 0;
  padding: 16px 18px;
  background: ${r.codeBg};
  border-radius: 12px;
  font-family: ${o};
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
  background: ${r.codeBg} !important;
}
pre.shiki code { color: inherit; }

/* Plain fallback when no Shiki theme is loaded for the lang. */
pre.md-pdf-code-fallback {
  background: ${r.codeBg};
  color: ${r.text};
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
  border: 1px solid ${r.rule};
  text-align: left;
  vertical-align: top;
}
th {
  background: ${r.tableHeaderBg};
  font-weight: 600;
  font-family: ${a};
}

hr {
  margin: 24pt 0;
  border: 0;
  border-top: 1px solid ${r.rule};
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
  color: ${r.textMuted};
  font-style: italic;
  text-align: center;
  margin-top: 4pt;
}

/* Task-list rendering — checkbox token is replaced with ☐/☑ glyph in renderer. */
ul li:has(> input[type="checkbox"]),
ul li:where(:first-letter) {
  list-style: none;
}
`}({theme:n,font:r,pageSize:a}),i=t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${i}</title>
<style>${o}</style>
</head>
<body>
<article class="md-pdf-doc">
${e}
</article>
</body>
</html>`}({bodyHtml:t,title:(e=a.match(/^#\s+(.+?)\s*$/m),e?.[1]?e[1].trim().slice(0,100):"Markdown Document"),theme:u,font:m});T(n)}catch(e){k(null),y(e instanceof Error?e.message:"Failed to render PDF")}}},[a,u,m]),v=(0,r.useCallback)(()=>{T(null),k(null)},[]),E="dark"===u?"bg-[#1a1814]":"bg-[#fdfdfb]",N="dark"===u?"text-[#f0eee8]":"text-[#1f1d1a]",R=(0,r.useMemo)(()=>!a.trim(),[a]);return(0,n.jsxs)("div",{className:"space-y-4",children:[(0,n.jsxs)("div",{className:"flex flex-wrap items-center gap-3 text-sm",children:[(0,n.jsx)(ek,{mode:e,onChange:t}),(0,n.jsx)("span",{"aria-hidden":"true",className:"hidden sm:inline text-text-muted",children:"·"}),(0,n.jsx)(ew,{label:"Theme",value:u,onChange:e=>p(e),options:[{value:"light",label:"Light"},{value:"dark",label:"Dark"}]}),(0,n.jsx)(ew,{label:"Font",value:m,onChange:e=>f(e),options:[{value:"serif",label:"Serif"},{value:"sans",label:"Sans"}]})]}),(0,n.jsxs)("div",{className:"grid grid-cols-1 lg:grid-cols-2 gap-4",children:[(0,n.jsx)("div",{className:"flex flex-col gap-3",children:"upload"===e?(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(i.DropZone,{accept:".md,.markdown,.txt,text/markdown",onFiles:_,label:"Upload a Markdown or text file"}),a&&(0,n.jsx)("textarea",{value:a,onChange:e=>d(e.target.value),rows:14,className:"w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y","aria-label":"Uploaded Markdown content (editable)"})]}):(0,n.jsx)("textarea",{value:a,onChange:e=>d(e.target.value),placeholder:eA,rows:20,className:"w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted min-h-[28rem]","aria-label":"Markdown source"})}),(0,n.jsxs)("div",{className:"flex flex-col gap-2",children:[(0,n.jsx)("span",{className:"text-sm text-text-secondary",children:"Preview"}),(0,n.jsx)("div",{className:(0,eT.cn)("w-full rounded-lg border border-border p-6 prose prose-sm max-w-none min-h-[28rem] overflow-y-auto",E,N,"dark"===u?"prose-invert":""),"data-testid":"markdown-pdf-preview",dangerouslySetInnerHTML:{__html:g||'<p class="text-text-muted italic">Your rendered Markdown will appear here. Type or paste on the left to start.</p>'}})]})]}),(0,n.jsx)(l.ErrorMessage,{message:b}),(0,n.jsxs)("div",{className:"flex flex-col gap-2 items-center pt-1",children:[(0,n.jsxs)("button",{type:"button",onClick:S,disabled:R||null!==x,className:"inline-flex items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed min-h-11",children:[(0,n.jsx)(o,{size:16,"aria-hidden":"true"}),"Export to PDF"]}),A&&(0,n.jsx)(s.StatusMessage,{children:A}),(0,n.jsx)("p",{className:"text-xs text-text-muted text-center max-w-md leading-relaxed",children:"Your browser’s print dialog opens — pick “Save as PDF” as the destination. Firefox users: turn on “Print backgrounds” in the dialog so the code-block tints render."})]}),x&&(0,n.jsx)(c,{html:x,onDone:v})]})}],98700)},87843,e=>{e.n(e.i(98700))}]);