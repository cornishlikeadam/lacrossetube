// The two portals. The coach desk (/coach) and the player pages (/team, /join, /placement, /test)
// look different and say which one you are in; the owner page is a third. Each person reaches
// their own portal by its address: coaches at /coach, players at /team (their invite lands them
// there), the owner at /owner. In a preview trial build, a switcher moves between the people
// held in this browser.
import { TRIAL, PEOPLE, slot, useSlot } from './trial.js';
import { esc } from './ui.js';

const TAG = { coach: 'COACH PORTAL', player: 'PLAYER PORTAL', owner: 'OWNER' };
const home = id => (id === 'coach' ? '/coach' : '/team');

export function mountPortal(kind) {
  document.body.classList.add(`portal-${kind}`);
  const hud = document.querySelector('.hud');
  if (!hud) return;
  hud.querySelector('.hud-logo')?.insertAdjacentHTML('afterend', `<span class="portal-tag">${TAG[kind]}</span>`);
  if (!TRIAL) {
    if (kind === 'player') hud.insertAdjacentHTML('beforeend', '<nav class="switcher"><a class="pill" href="/">FILM ROOM</a></nav>');
    return;
  }
  const current = kind === 'owner' ? 'owner' : slot;
  hud.insertAdjacentHTML('beforeend', `<label class="switcher">Trial as
    <select aria-label="Trial: switch person">
      ${[{ id: 'trial', label: 'Trial page' }, { id: 'owner', label: 'Owner' }, ...PEOPLE].map(p => `<option value="${p.id}"${p.id === current ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
    </select></label>`);
  hud.querySelector('.switcher select').addEventListener('change', e => {
    const id = e.target.value;
    if (id === 'trial' || id === 'owner') return location.assign(`/${id}`);
    useSlot(id); location.assign(home(id));
  });
}

// After signing out, or when this key belongs to the other portal: choose where to sign in.
export function signInChoice(root, note = 'You are signed out.') {
  root.innerHTML = `<h1>Sign in</h1><p>${esc(note)}</p>
    <div class="portal-choice">
      ${TRIAL
        ? `<button class="portal-card coach" type="button" data-slot="coach"><b>Coach</b><span>Coach desk: roster, invites, the QR sheet</span></button>
           ${PEOPLE.filter(p => p.id !== 'coach').map(p => `<button class="portal-card player" type="button" data-slot="${p.id}"><b>${esc(p.label)}</b><span>Player portal: team page, Warrior Tests, wallet</span></button>`).join('')}`
        : `<a class="portal-card coach" href="/coach"><b>Coach</b><span>Coach desk: roster, invites, the QR sheet</span></a>
           <a class="portal-card player" href="/team"><b>Player</b><span>Team page, Warrior Tests, wallet</span></a>`}
    </div>`;
  root.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => { useSlot(b.dataset.slot); location.assign(home(b.dataset.slot)); }));
}
