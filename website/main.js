const scene = document.querySelector('.light-scene');
const page = document.querySelector('.page');
const art = document.querySelector('.light-art');
const star = document.querySelector('.star-motion');
const paths = document.querySelectorAll('.orbit-path');
const pulse = document.querySelector('.pulse');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(pointer: fine)');
let targetX = 0;
let targetY = 0;
let currentX = 0;
let currentY = 0;
let frame = 0;
let previousTime = 0;

function reset() {
  targetX = 0;
  targetY = 0;
  schedule();
}

function schedule() {
  if (!frame && !document.hidden && !reduceMotion.matches) {
    frame = requestAnimationFrame(render);
  }
}

function render(time) {
  frame = 0;
  const delta = previousTime ? Math.min(time - previousTime, 50) : 16;
  previousTime = time;
  const ease = 1 - Math.exp(-delta / 240);
  currentX += (targetX - currentX) * ease;
  currentY += (targetY - currentY) * ease;
  star.style.setProperty('--star-x', `${currentX * 32}px`);
  star.style.setProperty('--star-y', `${currentY * 22}px`);
  star.style.setProperty('--star-rotation', `${currentX * 5}deg`);
  const bend = currentY * 35;
  const sweep = currentX * 40;
  const curve = `M-100 690C260 ${830 + bend} ${480 + sweep} ${740 - bend} 800 ${715 + bend * 0.25}S1300 ${700 + bend} 1700 780`;
  for (const path of paths) path.setAttribute('d', curve);
  if (Math.abs(targetX - currentX) + Math.abs(targetY - currentY) > 0.001) schedule();
  else previousTime = 0;
}

page.addEventListener('pointermove', (event) => {
  if (reduceMotion.matches || !finePointer.matches) return;
  const rect = page.getBoundingClientRect();
  targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
  targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  schedule();
});
page.addEventListener('pointerleave', reset);
page.addEventListener('pointerdown', (event) => {
  if (reduceMotion.matches || event.target.closest('a, button')) return;
  pulse.classList.remove('active');
  // Restart a single bounded pulse; no accumulating nodes or timers.
  void pulse.offsetWidth;
  pulse.classList.add('active');
});
reduceMotion.addEventListener('change', () => {
  if (reduceMotion.matches) {
    cancelAnimationFrame(frame);
    frame = 0;
    currentX = currentY = targetX = targetY = 0;
    star.removeAttribute('style');
    for (const path of paths)
      path.setAttribute('d', 'M-100 690C260 830 480 740 800 715S1300 700 1700 780');
    pulse.classList.remove('active');
  }
});
document.addEventListener('visibilitychange', () => {
  scene.style.animationPlayState = document.hidden ? 'paused' : '';
  for (const node of art.querySelectorAll('.star-trace, .flare')) {
    node.style.animationPlayState = document.hidden ? 'paused' : '';
  }
  if (document.hidden) {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  } else reset();
});
