type Next = (max: number) => number;
type CharacterStyle = 'monster' | 'bird' | 'cat' | 'robot' | 'sprout';
type Palette = readonly [string, string, string, string];

const palettes = [
  ['#edf0ff', '#6675e6', '#b7c2ff', '#ffbf77'],
  ['#ffedf3', '#e16c99', '#f5b1cd', '#ffd27c'],
  ['#e8f7ef', '#36a382', '#99dbc3', '#ffd17d'],
  ['#fff3e1', '#e7a040', '#ffcf83', '#f18b79'],
  ['#e8f5fb', '#429fc3', '#a3dbee', '#ffbc8a'],
  ['#f3edff', '#a16bda', '#d3b7f4', '#ffb6c1'],
] as const;
const dark = '#30364d';
const white = '#fffdf8';

const dot = (x: number, y: number, r: number, color: string) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const path = (d: string, color: string) => `<path d="${d}" fill="${color}"/>`;
const line = (d: string, color: string, width = 2) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const oval = (x: number, y: number, rx: number, ry: number, color: string) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}"/>`;
const rect = (x: number, y: number, w: number, h: number, r: number, color: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;

// Choose each feature independently so a color does not imply a fixed face or silhouette.
export function characterAvatar(style: CharacterStyle, next: Next): string {
  const colors = palettes[next(palettes.length)] ?? palettes[0];
  const draw = { monster, bird, cat, robot, sprout }[style];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${rect(0, 0, 64, 64, 14, colors[0])}${draw(next, colors)}</svg>`;
}

function monster(next: Next, [, accent, soft, pop]: Palette): string {
  const body = [
    'M10 35C8 20 21 14 33 16C47 12 55 24 54 38C56 52 44 58 30 56C15 59 7 49 10 35Z',
    'M14 34C13 19 20 10 32 11C46 10 50 22 49 35C57 50 45 57 31 56C16 58 8 49 14 34Z',
    'M9 37C7 24 18 18 30 20C43 13 55 23 54 37C60 49 48 57 33 55C19 60 6 51 9 37Z',
  ] as const;
  const outline = body[next(body.length)] ?? body[0];
  const ears = next(3);
  let s = ears === 0 ? dot(19, 18, 8, accent) + dot(45, 18, 8, accent) : '';
  if (ears === 1) s += path('M15 24Q11 7 17 9L27 21ZM38 21L48 9Q54 7 49 27Z', accent);
  s += path(outline, accent);
  s += oval(44, 45, 7, 5, soft);
  const gaze = next(3) - 1;
  const eyeY = 30 + next(3);
  const expression = next(5);
  for (const x of [24, 40]) {
    if (expression === 0 && x === 40) s += line(`M35 ${eyeY + 1}q5 -4 10 0`, dark, 2.5);
    else s += oval(x, eyeY, 5.5, 6.5, white) + dot(x + gaze, eyeY + 1, 2.6, dark);
  }
  s += expression === 1 ? oval(32, 44, 2.8, 3.2, dark) : line('M28 43q4 5 8 0', dark, 2.2);
  if (next(2)) s += dot(17, 42, 2, pop);
  return s;
}

function bird(next: Next, [, accent, soft, pop]: Palette): string {
  let s = path('M18 41L7 34Q6 46 21 50Z', soft);
  s += path(
    `M15 39C12 23 23 ${12 + next(3) * 2} 36 16C50 17 53 30 49 43C45 57 16 58 15 39Z`,
    accent,
  );
  s += oval(33, 43, 13, 10, white);
  s += path(next(2) ? 'M18 32Q35 30 31 45Q20 48 18 32Z' : 'M18 33Q31 32 28 47Q18 44 18 33Z', soft);
  s += path('M47 29L57 33L47 37Z', pop);
  s += next(4) === 0 ? line('M37 28q3 -3 6 0', dark, 2.5) : dot(40, 28, 2.5, dark);
  const crest = next(3);
  if (crest === 0) s += path('M28 17Q21 9 26 7Q34 10 34 17Z', soft);
  if (crest === 1) s += line('M29 16Q29 8 36 9', accent, 4);
  s += line('M27 55v3m10 -3v3', dark, 2);
  return next(2) ? `<g transform="translate(64 0) scale(-1 1)">${s}</g>` : s;
}

function cat(next: Next, [, accent, soft, pop]: Palette): string {
  const tilted = next(2);
  let s = path(
    tilted
      ? 'M11 33L17 10L30 22Q35 21 40 24L53 15L52 38Q54 55 32 56Q8 56 11 33Z'
      : 'M12 32L12 12Q14 9 27 23Q33 21 38 23Q52 9 53 13L52 35Q58 55 32 56Q7 56 12 32Z',
    accent,
  );
  s += path(
    tilted ? 'M18 17L16 28L25 25ZM49 22L43 27L49 30Z' : 'M16 18L17 29L24 25ZM48 20L41 26L49 29Z',
    pop,
  );
  const pattern = next(3);
  if (pattern === 0) s += path('M32 23Q34 38 47 40Q51 31 47 25Q41 21 32 23Z', soft);
  if (pattern === 1) s += path('M25 23L28 31L31 23ZM33 23L36 31L39 24Z', soft);
  s += oval(32, 44, 11, 8, white);
  s +=
    next(3) === 0
      ? line('M21 37q3 -3 6 0m11 0q3 -3 6 0', dark, 2.5)
      : dot(24, 36, 2.4, dark) + dot(41, 36, 2.4, dark);
  s += path('M29 41Q32 39 35 41L32 44Z', dark);
  s += line('M32 44q-3 5 -6 1m6 -1q3 5 6 1', dark, 1.8);
  s += line('M9 41l9 1m-9 5l9 -2m28 -3l9 -1m-9 4l9 2', dark, 1.6);
  return s;
}

function robot(next: Next, [, accent, soft, pop]: Palette): string {
  const radius = 5 + next(4) * 4;
  const bent = next(2);
  let s = line(bent ? 'M32 17V9h9' : 'M32 17V8', accent, 3) + dot(bent ? 41 : 32, 8, 3.5, pop);
  s += rect(7, 28, 8, 16, 4, soft) + rect(49, 28, 8, 16, 4, soft);
  s += rect(12, 16, 40, 39, radius, accent) + rect(17, 23, 30, 23, Math.min(radius, 9), dark);
  const expression = next(3);
  if (expression === 0) s += line('M22 32l3 -3 3 3m8 0l3 -3 3 3', white, 2.5);
  else
    s +=
      rect(22, 29, 5, 8, expression === 1 ? 1 : 2.5, white) +
      rect(37, 29, 5, 8, expression === 1 ? 1 : 2.5, white);
  s += line(next(2) ? 'M29 40h6' : 'M29 39q3 3 6 0', pop, 2);
  s += dot(28, 51, 1.5, soft) + dot(35, 51, 1.5, pop);
  return s;
}

function sprout(next: Next, [, accent, soft, pop]: Palette): string {
  const left = next(2);
  let s = line('M32 26Q35 17 31 11', accent, 2.5);
  s += path(left ? 'M33 19Q31 3 16 9Q17 22 33 19Z' : 'M32 18Q37 2 49 10Q47 23 32 18Z', accent);
  s += path(left ? 'M33 17Q40 7 48 15Q43 25 33 20Z' : 'M32 20Q21 6 15 17Q18 27 32 20Z', soft);
  const bodies = [
    'M13 41Q13 26 27 25Q42 21 49 33Q60 51 40 56Q17 60 13 41Z',
    'M12 43Q16 26 32 25Q50 25 53 43Q54 57 32 56Q8 58 12 43Z',
    'M15 41Q12 30 25 25Q34 19 44 28Q56 34 49 49Q42 60 25 55Q11 53 15 41Z',
  ] as const;
  s += path(bodies[next(bodies.length)] ?? bodies[0], accent) + oval(33, 46, 13, 8, soft);
  s +=
    next(4) === 0
      ? line('M22 37q3 -3 6 0m9 0q3 -3 6 0', dark, 2.5)
      : dot(25, 37, 2.3, dark) + dot(40, 37, 2.3, dark);
  s += line(next(3) ? 'M30 43q3 4 6 0' : 'M31 43h4', dark, 2);
  s += oval(19, 42, 3, 1.8, pop) + oval(46, 42, 3, 1.8, pop);
  return s;
}
