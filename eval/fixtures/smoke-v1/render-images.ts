// Regenerates the original fixture illustrations. Run with Bun from any directory.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outputDir = new URL('./images/', import.meta.url);
const center = 180;
const seam = (d: string) => `<path d="${d}" fill="none" stroke="#49302d" stroke-opacity=".83" stroke-width="1.7"/>`;
const panel = (d: string, fill = 'url(#fabric)') => `<path d="${d}" fill="${fill}"/>`;
const mirror = (drawing: string) => drawing + `<g transform="translate(${center * 2} 0) scale(-1 1)">${drawing}</g>`;
const buttons = (x: number, ys: number[]) =>
  ys.map((y) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#f1d9ae" stroke-width="1"/>`).join('');

const miniDarts = seam('M142 148l25 13 -22 -4 M218 148l-25 13 22 -4 M155 191l7 -25 3 25 M205 191l-7 -25 -3 25');
const shortPuff = mirror(
  panel('M136 100C115 74 95 89 87 112Q76 126 82 144L119 150Q117 135 133 127Z')
  + panel('M82 138Q99 145 120 144L119 151Q99 154 80 146Z', 'var(--binding)')
  + seam('M99 103q5 -8 11 -10 M106 109q4 -9 10 -12'),
);
const vBodice = panel('M120 94L146 81 180 127 214 81 240 94Q241 125 223 141L215 181Q180 188 145 181L137 141Q119 125 120 94Z');
const wrapBodice = panel('M117 95L150 81 181 127 210 81 243 95Q241 114 227 132L217 185 229 223Q182 232 131 225L144 185 133 132Q120 115 117 95Z')
  + seam('M149 82Q168 134 221 181L229 218 M210 82Q199 127 174 144L137 181 M144 179Q184 176 217 181')
  + panel('M214 179q15 -8 24 1l17 24 -9 5 -18 -15 -2 32 -8 -1 2 -37Z', 'var(--binding)');

const drawings = [
  {
    id: '01-floral-cowl',
    fabric: '#883f45',
    drawing: panel('M137 102l4 -27 6 -1 -3 31 M223 102l-4 -27 -6 -1 3 31')
      + panel('M138 100C151 109 164 121 181 121C198 121 215 109 222 100Q220 122 235 143Q211 174 211 196C210 238 240 279 248 349Q240 356 232 353L221 304 219 358Q175 371 109 354C112 296 150 238 149 194Q143 168 125 144Q138 126 138 100Z', 'url(#blossoms)')
      + seam('M141 107q40 53 80 0 M136 126q42 52 87 -1 M128 351q44 9 89 3 M228 301l9 43'),
  },
  {
    id: '02-plaid-sweetheart',
    fabric: '#bd9774',
    drawing: panel('M119 107Q137 75 157 88Q172 92 180 111Q188 92 203 88Q227 76 241 107L222 169C218 186 234 218 232 248L224 324Q180 329 136 324L128 248C126 218 142 186 138 169Z', 'url(#plaid)')
      + mirror(seam('M139 89Q158 122 156 163Q156 182 147 225L151 324 M151 95Q170 136 166 171Q166 186 160 220L164 326'))
      + seam('M139 176Q180 184 221 176 M137 314Q178 320 224 314'),
  },
  {
    id: '03-square-neck-crop',
    fabric: '#d4a752',
    transform: 'translate(-36 -56) scale(1.2)',
    drawing: panel('M125 93L150 82 152 124H208L210 82 235 93Q241 116 226 136L220 196Q179 203 140 197L134 136Q119 116 125 93Z')
      + shortPuff + miniDarts
      + panel('M217 189q21 -4 28 11q-13 9 -28 -4q12 17 12 26l-7 1 -7 -20Z', 'var(--binding)')
      + seam('M140 191q40 5 80 -1'),
  },
  {
    id: '04-gathered-cap',
    fabric: '#b06e87',
    drawing: panel('M145 179Q180 186 215 179Q233 248 266 296Q185 327 91 294Q124 247 145 179Z')
      + vBodice + shortPuff
      + seam('M145 179Q180 186 215 179 M154 187q-1 47 -26 101 M169 187q2 42 -8 58 M201 187q1 42 20 96 M100 288q84 25 156 3'),
  },
  {
    id: '05-raglan-bishop',
    fabric: '#b987a3',
    transform: 'translate(-20 -40) scale(1.11)',
    drawing: panel('M131 102L154 78Q179 70 206 78L229 102Q256 103 269 143C287 176 310 228 279 245L270 260 247 257 246 242Q219 227 221 174L231 271Q178 292 129 271L139 174Q138 225 114 242L113 257 90 260 81 245C50 228 73 176 91 143Q104 103 131 102Z')
      + mirror(seam('M153 79q-21 47 -28 75l14 20 M82 245q18 -7 32 -3 M91 253l21 -3 M84 229l13 12 M101 223l5 18'))
      + panel('M154 78q26 12 52 0l-3 8q-9 3 -19 4q8 29 -4 32q-12 -3 -4 -32q-10 -1 -19 -4Z', '#eee7db')
      + seam('M134 266q46 14 92 0'),
  },
  {
    id: '06-knit-wrap',
    fabric: '#6e8e84',
    transform: 'translate(-18 -38) scale(1.1)',
    drawing: mirror(panel('M129 96Q111 87 100 113L67 241 90 248 136 140Z') + seam('M68 235l24 7'))
      + wrapBodice,
  },
  {
    id: '07-banded-lantern',
    fabric: '#bc7d59',
    transform: 'translate(-20 -36) scale(1.11)',
    drawing: mirror(
      panel('M134 94Q101 75 76 104C52 124 55 156 83 178L115 181Q144 164 138 133Z')
      + panel('M82 175Q101 176 117 171L114 195 84 199Z', 'var(--binding)')
      + seam('M82 167l8 9 M97 168l3 8 M109 162l-1 13 M87 181l1 13 M109 180l-1 11'),
    ) + wrapBodice,
  },
  {
    id: '08-shirttail-belt',
    fabric: '#819e8d',
    drawing: mirror(
      panel('M129 101Q110 91 99 114L73 172 94 180 136 132Z')
      + panel('M73 170l23 8 -7 16 -23 -9Z', 'var(--binding)') + buttons(82, [182]),
    )
      + panel('M125 102L152 83H208L235 102L222 163 216 179Q237 232 254 319Q227 358 183 352Q136 358 107 319Q122 232 143 179L138 163Z')
      + panel('M176 103l10 -1v249h-10Z', 'var(--binding)')
      + panel('M152 79q28 14 56 0l10 15 -17 22 -21 -13 -21 13 -17 -22Z', 'var(--binding)')
      + panel('M201 123h23l-2 27 -8 4 -13 -4Z')
      + panel('M142 169Q177 174 219 168L221 180Q183 188 139 181Z', 'var(--binding)')
      + panel('M210 170l16 -4 13 13 -16 3 17 27 -9 4 -16 -28 -4 22 -8 -1Z', 'var(--binding)')
      + buttons(181, [119, 136, 151, 199, 222, 245, 268, 292, 315, 335])
      + seam('M114 317q25 28 61 28 M187 345q38 2 60 -26'),
  },
  {
    id: '09-three-gathered-tiers',
    fabric: '#c99182',
    drawing: mirror(
      panel('M139 103Q117 92 97 108Q77 136 69 155Q75 174 106 175Q118 162 130 150L146 130Z')
      + seam('M125 103l-7 38 M71 155q18 12 38 12 M78 154l6 11 M94 157l3 13'),
    )
      + panel('M123 101Q143 86 149 90Q180 124 211 90Q217 86 237 101L225 149Q181 155 135 149Z')
      + panel('M135 149Q181 155 225 149L240 206Q179 215 119 206Z')
      + panel('M119 206Q179 215 240 206L256 270Q180 283 102 270Z')
      + panel('M102 270Q180 283 256 270L287 351Q181 373 74 351Z')
      + seam('M145 153l-4 24 M159 155v17 M203 155l7 22 M217 154l4 17 M129 209l-7 19 M150 211l-6 24 M178 213l1 15 M216 212l10 27 M236 210l6 16 M113 274l-10 31 M132 277l-6 17 M172 280l-3 29 M208 280l5 23 M242 277l12 30 M83 346q96 19 195 0'),
  },
  {
    id: '10-box-pleated-midi',
    fabric: '#667a9d',
    drawing: panel('M143 167Q180 175 217 167L263 342Q182 365 97 342Z')
      + panel('M109 118l22 -26 15 -5q35 11 68 0l15 5 22 26 -23 12 -12 37q-39 9 -72 0l-12 -37Z')
      + mirror(seam('M146 89l6 26 -2 51 M131 94l1 36 M151 171l-22 174 24 -20 13 -152 M169 173l-8 180 21 -15 -1 -165'))
      + seam('M143 165Q178 174 217 165 M100 335Q182 355 260 335'),
  },
  {
    id: '11-high-low-halter',
    fabric: '#c69b56',
    drawing: panel('M70 311Q181 278 293 312Q243 378 188 384Q129 383 70 311Z', 'var(--binding)')
      + panel('M155 65Q181 69 205 65C205 88 213 110 231 127Q246 215 293 312Q182 351 70 311Q111 221 129 127Q149 108 155 65Z')
      + panel('M153 62q26 2 54 0l-3 13q-22 4 -49 0Z', 'var(--binding)')
      + seam('M165 76q3 24 -6 53 M181 77v63 M195 77q-1 28 6 52 M135 137l-26 163 M218 138l32 163 M76 304q110 36 210 0'),
  },
  {
    id: '12-gored-side-slit',
    fabric: '#7992a9',
    drawing: mirror(
      panel('M132 100L104 99Q98 127 69 152L102 173 139 132Z')
      + seam('M109 108q-11 32 -29 46 M104 138l-15 23'),
    )
      + panel('M116 100Q180 118 244 100L221 155 217 176Q226 254 259 339L238 344 229 292 228 346Q179 356 100 339Q130 253 143 176L139 155Z')
      + panel('M115 100Q180 112 245 100L242 113Q181 126 118 113Z', 'var(--binding)')
      + mirror(seam('M149 121q-1 16 9 52q-5 66 -32 171 M169 177q-4 90 -14 172'))
      + seam('M144 169q36 12 73 0 M143 176q33 12 74 0 M107 333q57 15 113 6'),
  },
  {
    id: '13-curve-puff-midi',
    fabric: '#7b6b98',
    drawing: mirror(
      panel('M129 103Q113 83 92 104Q69 126 78 165Q96 182 115 170L138 131Z')
      + panel('M77 161Q96 172 117 164l-2 9q-20 11 -39 -2Z', 'var(--binding)')
      + seam('M109 100l-5 15 M99 103l-6 18 M91 151l2 17 M102 150l-1 18'),
    )
      + panel('M136 175Q178 179 224 175Q254 235 278 346Q179 375 81 347Q103 238 136 175Z')
      + panel('M127 101L151 89V126H209V89L233 101Q237 123 227 145L224 175Q180 182 136 175L133 145Q123 123 127 101Z')
      + seam('M138 132l30 15 -27 -4 M222 132l-30 15 27 -4 M158 176l5 -23 5 25 M202 176l-5 -23 -5 25 M142 179l-27 153 M154 181l-14 64 M169 183l-7 112 M194 183l5 112 M211 181l15 64 M219 180l26 150 M91 341q89 23 176 0'),
  },
  {
    id: '14-straight-square-mini',
    fabric: '#a55f71',
    transform: 'translate(-20 -29) scale(1.11)',
    drawing: panel('M143 181Q180 184 217 181L264 280Q180 298 96 280Z')
      + panel('M120 85L146 80V119H214V80L240 85Q233 119 225 139L217 181Q180 186 143 181L135 139Q127 119 120 85Z')
      + seam('M138 140L164 149l-23 -3 M222 140l-26 9 23 -3 M156 181l8 -24 2 25 M204 181l-8 -24 -2 25 M150 184l-20 82 M165 185l-7 53 M195 185l7 53 M210 185l20 81 M103 275q81 16 154 0'),
  },
  {
    id: '15-pintuck-curve-tunic',
    fabric: '#7d9b9e',
    transform: 'translate(-11 -32) scale(1.06)',
    drawing: mirror(
      panel('M135 101Q110 87 94 113L62 240 91 251 132 157Z')
      + panel('M62 235l31 11 -6 17 -31 -11Z', 'var(--binding)')
      + seam('M103 104q9 17 25 21') + buttons(79, [251]),
    )
      + panel('M113 108L152 84H208L247 108Q245 129 229 155L229 201 247 294Q235 313 186 316Q128 316 113 297L131 201V155Q115 128 113 108Z')
      + panel('M154 68Q179 75 206 68L207 86Q193 92 182 86L180 95 177 86Q163 92 153 86Z', 'var(--binding)')
      + panel('M176 88h8v68h-8Z', 'var(--binding)')
      + mirror(seam('M158 92v77 M150 95v70 M143 98v63 M166 91v78 M120 269l5 24 M125 294q15 14 49 15'))
      + buttons(180, [101, 119, 137]),
  },
] as const;

const patterns = `
<pattern id="blossoms" patternUnits="userSpaceOnUse" width="52" height="47" patternTransform="rotate(-17)">
  <rect width="52" height="47" fill="#873c43"/>
  <g fill="#f8dfa5" stroke="#a66158" stroke-width=".9">
    <ellipse cx="14" cy="7.5" rx="3.7" ry="6" transform="rotate(-15 14 7.5)"/>
    <ellipse cx="20" cy="13" rx="6.4" ry="3.5" transform="rotate(-24 20 13)"/>
    <ellipse cx="16.5" cy="19.5" rx="4" ry="6"/>
    <ellipse cx="10" cy="20" rx="3.8" ry="6" transform="rotate(37 10 20)"/>
    <ellipse cx="8" cy="12" rx="5.8" ry="3.5" transform="rotate(36 8 12)"/>
    <circle cx="13.4" cy="14.1" r="2.6" fill="#e4ab65"/>
    <path d="M37 33q-7 -9 -10 -3q1 5 10 3q9 -10 11 -3q-2 5 -11 3q-1 7 -4 10" fill="#efd5a1"/>
  </g>
</pattern>
<pattern id="plaid" patternUnits="userSpaceOnUse" width="49" height="49">
  <rect width="49" height="49" fill="#ca9e75"/>
  <path d="M9 0v49M0 9h49" stroke="#a4513e" stroke-opacity=".78" stroke-width="10"/>
  <path d="M26 0v49M0 26h49" stroke="#e5ca98" stroke-opacity=".9" stroke-width="7"/>
  <path d="M40 0v49M0 40h49" stroke="#4e553b" stroke-opacity=".86" stroke-width="8"/>
  <path d="M35 0v49M0 35h49M19 0v49M0 19h49" stroke="#444431" stroke-opacity=".72" stroke-width="1.5"/>
</pattern>`;

await mkdir(outputDir, { recursive: true });
await Promise.all(drawings.map(async (entry) => {
  const transform = 'transform' in entry ? entry.transform : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 426" width="540" height="639">
<defs>
  ${patterns}
  <linearGradient id="fabric" x1="0" x2="1" y1="0" y2="1">
    <stop stop-color="${entry.fabric}"/>
    <stop offset="1" stop-color="${entry.fabric}"/>
  </linearGradient>
  <radialGradient id="paper" cx=".43" cy=".29" r=".81">
    <stop stop-color="#fbf5e9"/>
    <stop offset="1" stop-color="#e4d9c5"/>
  </radialGradient>
</defs>
<rect width="360" height="426" fill="url(#paper)"/>
<path d="M23 19H337V407H23Z" fill="none" stroke="#d4c7b5"/>
<g transform="${transform}" stroke="#493633" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
${entry.drawing.replaceAll('var(--binding)', '#9e806b')}
</g>
</svg>`;
  const target = fileURLToPath(new URL(`${entry.id}.webp`, outputDir));
  await sharp(Buffer.from(svg)).webp({ lossless: true }).toFile(target);
}));
