// Assistent in der App: Aufträge per Text, Sprache oder Foto („3 Dosen Tomaten in den Vorratsschrank“, „Wo ist der
// Akkuschrauber?“). Buchungen kommen mit „rückgängig“, ab 4 Buchungen fragt er nach. Nennt die Antwort Plätze, zeigt
// „Im Haus zeigen“ die Fächer im Hausplan. Server: /api/assistant (dieselben Werkzeuge wie der MCP-Server).

import { api, esc, pickPhoto, placeInfo, type LagerCtx } from './core';
import { parseCode } from './scan';
import type { View } from './views';
import { ic } from '../icons';
import { pickWho, terminal } from '../terminal';

type Msg =
  | { role: 'divider'; content: string }
  | { role: 'user'; content: string; photos?: string[]; at: number }
  | { role: 'assistant'; content: string; error?: boolean; at?: number; places?: string[]; bookings?: any[]; confirm?: { token: string; count: number; actions: string[]; done?: 'ok' | 'no' } };

// Wandterminal: eigener Verlauf, der im Ruhezustand gelöscht wird (dort sprechen wechselnde Personen)
const key = () => (terminal() ? 'zh.assistant.terminal' : 'zh.assistant');
export function clearTerminalChat() {
  try {
    localStorage.removeItem('zh.assistant.terminal');
  } catch {
    /* egal */
  }
}
const PAUSE = 30 * 60_000; // nach so langer Pause beginnt ein neues Gespräch
const load = (): Msg[] => {
  try {
    return JSON.parse(localStorage.getItem(key()) ?? '[]');
  } catch {
    return [];
  }
};
const save = (m: Msg[]) => {
  try {
    localStorage.setItem(key(), JSON.stringify(m.slice(-60)));
  } catch {
    /* zu groß (Fotos) – dann eben nicht */
  }
};
const history = (msgs: Msg[]) => {
  const start = msgs.map((m) => m.role).lastIndexOf('divider') + 1;
  return msgs.slice(start).filter((m) => m.role !== 'divider' && m.content && !(m as any).error).map((m) => ({ role: m.role, content: m.content }));
};
// Vorlesen: am Wandterminal standardmäßig an
const speakOn = () => {
  try {
    const v = localStorage.getItem('zh.speak');
    return v === '1' || (v === null && !!terminal());
  } catch {
    return false;
  }
};
function speak(text: string) {
  if (!speakOn() || !window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''));
  u.lang = 'de-DE';
  const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('de'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

/** QR-Codes (Lager-Etiketten) in einem Foto erkennen – die App liest sie selbst, der Assistent bekommt sie mit */
async function qrCodesIn(b64: string): Promise<string[]> {
  try {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const texts = new Set<string>();
    if (window.BarcodeDetector) {
      try {
        for (const c of await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(img)) texts.add(c.rawValue);
      } catch {
        /* jsQR */
      }
    }
    if (!texts.size) {
      if (!window.jsQR) await new Promise<void>((res) => document.head.appendChild(Object.assign(document.createElement('script'), { src: `${import.meta.env.BASE_URL}vendor/jsQR.js`, onload: () => res(), onerror: () => res() })));
      if (window.jsQR) {
        const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        const r = window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        if (r?.data) texts.add(r.data);
      }
    }
    return [...texts].filter((t) => parseCode(t));
  } catch {
    return [];
  }
}

/** Platzadressen („KU-B2“) → Fächer im Hausplan */
function planPlaces(ctx: LagerCtx, addrs: string[]) {
  return addrs.map((a) => [...ctx.sync.storage.values()].find((p) => p.address === a)).filter((p): p is NonNullable<typeof p> => !!p);
}

let busy = false;
let recog: any = null;
let talkListener: (() => void) | null = null;

/** Am Wandterminal: wer spricht (Kachel antippen, gilt eine Weile) – sonst nichts */
async function who(): Promise<{ person_id?: number } | null> {
  if (!terminal()) return {};
  const id = await pickWho();
  return id ? { person_id: id } : null;
}

export const viewAssistant: View = async (el, ctx, params) => {
  const status = await api<{ enabled: boolean; confirm_from: number }>('GET', '/api/assistant/status').catch(() => ({ enabled: false, confirm_from: 4 }));
  if (!status.enabled) {
    el.innerHTML = `<h1>Assistent</h1><p>Der Assistent ist noch nicht eingerichtet.</p>${ctx.user()?.role === 'admin' ? '<a class="btn primary" href="#/verwaltung/assistent">Jetzt einrichten</a>' : '<p class="hint">Ein Admin richtet ihn unter Verwaltung → Assistent ein.</p>'}`;
    return;
  }
  // Kontext: aus Gegenstand oder Fach geöffnet („das“, „hier“)
  let context: Record<string, unknown> | null = null;
  let contextLabel = '';
  if (params.get('item')) {
    const it = await api<any>('GET', `/api/items/${params.get('item')}`).catch(() => null);
    if (it) {
      context = { item_id: it.id };
      contextLabel = `${it.name} (${placeInfo(ctx, it).address})`;
    }
  } else if (params.get('wh')) {
    context = { place: { warehouse_id: Number(params.get('wh')), col: params.get('col'), row: Number(params.get('row')) } };
    contextLabel = placeInfo(ctx, context.place as any).title;
  }
  const msgs = load();
  let photos: { image: string; thumb: string; preview: string; codes: string[] }[] = [];
  const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  el.innerHTML = `
    <div class="ai-head"><h1>Assistent</h1>
      <span class="ai-tools">${window.speechSynthesis ? `<label class="l-check"><input type="checkbox" id="speak" ${speakOn() ? 'checked' : ''}/> Vorlesen</label>` : ''}<button class="btn mini" id="clear">Neues Gespräch</button></span></div>
    ${contextLabel ? `<p class="ai-context">Bezogen auf <b>${esc(contextLabel)}</b> <a href="#/assistent">entfernen</a></p>` : ''}
    <div class="ai-chat" id="chat"></div>
    <form class="ai-composer" id="form">
      <div class="ai-previews" id="prev" hidden></div>
      <div class="ai-row">
        ${terminal() ? '' : `<button type="button" class="btn icon" id="photo" title="Foto aufnehmen" aria-label="Foto aufnehmen">${ic('camera')}</button>`}
        ${SpeechRec ? `<button type="button" class="btn icon" id="mic" title="Sprechen" aria-label="Sprechen">${ic('mic')}</button>` : ''}
        <textarea id="text" rows="1" placeholder="z. B. „Leg 3 Dosen Tomaten in den Vorratsschrank“"></textarea>
        <button class="btn primary" id="send" title="Senden">➤</button>
      </div>
    </form>`;
  const chat = el.querySelector<HTMLElement>('#chat')!;
  const text = el.querySelector<HTMLTextAreaElement>('#text')!;
  const prev = el.querySelector<HTMLElement>('#prev')!;

  const msgHtml = (m: Msg, i: number) => {
    if (m.role === 'divider') return `<div class="ai-divider"><span>${esc(m.content)}</span></div>`;
    if (m.role === 'user') return `<div class="ai-msg user">${m.photos?.length ? `<div class="ai-photos">${m.photos.map((p) => `<img src="${p}" alt="Foto">`).join('')}</div>` : ''}${m.content ? `<div class="ai-bubble">${esc(m.content)}</div>` : ''}</div>`;
    const places = planPlaces(ctx, m.places ?? []);
    const c = m.confirm;
    return `<div class="ai-msg bot ${m.error ? 'error' : ''}"><div class="ai-bubble">${esc(m.content)}</div>
      ${m.bookings?.length ? `<ul class="ai-bookings">${m.bookings.map((b, j) => `<li class="${b.undone ? 'undone' : ''}"><span>${b.item_id ? `<a href="#/item/${b.item_id}">${esc(b.text || b.item)}</a>` : esc(b.text)}</span>${b.movement_id && !b.undone ? `<button class="btn mini" data-undo="${i}:${j}">rückgängig</button>` : b.undone ? '<small>rückgängig gemacht</small>' : ''}</li>`).join('')}</ul>` : ''}
      ${places.length ? `<div class="ai-places">${places.map((p) => {
        const info = placeInfo(ctx, p);
        return `<span><code>${esc(p.address)}</code> ${esc(info.title)} · ${esc(info.plan?.fach ?? '')}</span>`;
      }).join('')}<button class="btn" data-house="${i}">${ic('plan')}Im Haus zeigen</button></div>` : ''}
      ${c ? `<div class="ai-confirm ${c.done ? 'done' : ''}"><b>${c.count} Buchungen:</b><ul>${c.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        ${c.done ? `<small>${c.done === 'ok' ? 'ausgeführt' : 'abgebrochen'}</small>` : `<div class="l-actions"><button class="btn in" data-ok="${i}">Ausführen</button><button class="btn" data-no="${i}">Abbrechen</button></div>`}</div>` : ''}
    </div>`;
  };
  const render = () => {
    chat.innerHTML = msgs.length ? msgs.map(msgHtml).join('') : `<div class="ai-hello"><p><b>Was soll ich tun?</b> Schreib, sprich oder fotografiere – zum Beispiel:</p>
      <ul><li>„3 Dosen Tomaten in den Vorratsschrank, haltbar bis 05/2027“</li><li>Foto vom Gegenstand und vom Fach-Etikett: „das kommt hierhin“</li><li>„Wo ist der Akkuschrauber?“</li><li>„Was läuft diese Woche ab?“</li></ul>
      <p class="hint">Fächer kennt er beim Namen: „in die Besteckschublade“, „Küche Kühlschrank oben“, „Kellerregal Boden 2“.</p></div>`;
    if (busy) chat.insertAdjacentHTML('beforeend', '<div class="ai-msg bot"><div class="ai-bubble typing"><span></span><span></span><span></span></div></div>');
    chat.lastElementChild?.scrollIntoView({ block: 'end' });
  };
  const renderPrev = () => {
    prev.hidden = !photos.length;
    prev.innerHTML = photos.map((p, i) => `<span class="ai-prev"><img src="${p.preview}" alt="">${p.codes.length ? '<small>QR</small>' : ''}<button type="button" data-rm="${i}">✕</button></span>`).join('');
  };
  const autosize = () => {
    text.style.height = 'auto';
    text.style.height = `${Math.min(160, text.scrollHeight)}px`;
  };

  const send = async (message: string) => {
    if (busy) return;
    message = message.trim();
    if (!message && !photos.length) return;
    const person = await who();
    if (!person) return;
    const last = [...msgs].reverse().find((m) => 'at' in m && m.at) as any;
    if (last && Date.now() - last.at > PAUSE && msgs.at(-1)?.role !== 'divider') msgs.push({ role: 'divider', content: 'Neues Gespräch nach längerer Pause' });
    const hist = history(msgs);
    const sent = photos;
    photos = [];
    renderPrev();
    msgs.push({ role: 'user', content: message, photos: sent.map((p) => p.preview), at: Date.now() });
    text.value = '';
    autosize();
    busy = true;
    render();
    try {
      const r = await api<any>('POST', '/api/assistant', { message, history: hist, context, images: sent.map((p) => ({ image: p.image, thumb: p.thumb, codes: p.codes })), ...person });
      if (r.reset) msgs.length = 0;
      msgs.push({ role: 'assistant', content: r.reply, bookings: r.bookings, confirm: r.confirm, places: r.places ?? [], at: Date.now() });
      if (r.reset) msgs.push({ role: 'divider', content: 'Verlauf gelöscht – neues Gespräch' });
      if (r.bookings?.length) ctx.sync.loadStorage();
      speak(r.reply);
    } catch (e) {
      msgs.push({ role: 'assistant', content: (e as Error).message, error: true });
    } finally {
      busy = false;
      save(msgs);
      render();
    }
  };

  text.addEventListener('input', autosize);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(text.value);
    }
  });
  el.querySelector<HTMLFormElement>('#form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    send(text.value);
  });
  el.querySelector('#photo')?.addEventListener('click', async () => {
    if (photos.length >= 4) return ctx.toast('Höchstens 4 Fotos je Nachricht.');
    const p = await pickPhoto();
    if (!p) return;
    photos.push({ ...p, codes: await qrCodesIn(p.image) });
    renderPrev();
    text.focus();
  });
  prev.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rm]');
    if (b) {
      photos.splice(Number(b.dataset.rm), 1);
      renderPrev();
    }
  });
  el.querySelector<HTMLInputElement>('#speak')?.addEventListener('change', (e) => {
    try {
      localStorage.setItem('zh.speak', (e.target as HTMLInputElement).checked ? '1' : '0');
    } catch {
      /* egal */
    }
    if (!(e.target as HTMLInputElement).checked) window.speechSynthesis?.cancel();
  });
  el.querySelector('#clear')!.addEventListener('click', () => {
    msgs.length = 0;
    save(msgs);
    window.speechSynthesis?.cancel();
    render();
  });
  const mic = el.querySelector<HTMLElement>('#mic');
  const listen = async () => {
    if (!mic || !document.body.contains(mic)) return;
    if (recog) return recog.stop();
    // am Terminal zuerst „wer spricht“ – sonst würde nach dem Sprechen noch gefragt
    if (terminal() && !(await who())) return;
    const rec = new SpeechRec();
    rec.lang = 'de-DE';
    rec.interimResults = true;
    let final = '';
    const before = text.value ? `${text.value.trim()} ` : '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        if (e.results[k].isFinal) final += e.results[k][0].transcript;
        else interim += e.results[k][0].transcript;
      }
      text.value = before + final + interim;
      autosize();
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed') ctx.toast('Mikrofon nicht erlaubt – bitte im Browser freigeben.');
    };
    rec.onend = () => {
      recog = null;
      mic.classList.remove('on');
      if (final.trim()) send(before + final);
    };
    window.speechSynthesis?.cancel();
    rec.start();
    recog = rec;
    mic.classList.add('on');
  };
  mic?.addEventListener('click', listen);
  // „Sprechen“ am Wandterminal (Leiste): gleich zuhören
  if (talkListener) document.removeEventListener('zh-talk', talkListener);
  talkListener = () => void listen();
  document.addEventListener('zh-talk', talkListener);
  chat.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const u = t.closest<HTMLElement>('[data-undo]');
    if (u) {
      const [i, j] = u.dataset.undo!.split(':').map(Number);
      const b = (msgs[i] as any).bookings[j];
      try {
        const person = await who();
        if (!person) return;
        await api('POST', `/api/movements/${b.movement_id}/undo`, person);
        b.undone = true;
        ctx.sync.loadStorage();
      } catch (err) {
        ctx.toast((err as Error).message);
      }
      save(msgs);
      return render();
    }
    const h = t.closest<HTMLElement>('[data-house]');
    if (h) {
      const places = planPlaces(ctx, (msgs[Number(h.dataset.house)] as any).places ?? []);
      sessionStorage.setItem('zh.highlight', JSON.stringify(places.map((p) => `${p.plan_item}:${p.plan_slot}`)));
      return ctx.showInHouse(places[0].plan_item, places[0].plan_slot);
    }
    const ok = t.closest<HTMLElement>('[data-ok]');
    const no = t.closest<HTMLElement>('[data-no]');
    if (!ok && !no) return;
    const m = msgs[Number((ok ?? no)!.dataset.ok ?? (ok ?? no)!.dataset.no)] as any;
    if (!m?.confirm || m.confirm.done || busy) return;
    const person = await who();
    if (!person) return;
    busy = true;
    render();
    try {
      const r = await api<any>('POST', `/api/assistant/${ok ? 'confirm' : 'cancel'}`, { token: m.confirm.token, ...person });
      m.confirm.done = ok ? 'ok' : 'no';
      msgs.push({ role: 'assistant', content: r.reply, bookings: r.bookings ?? [], places: (r.bookings ?? []).map((b: any) => b.platz).filter(Boolean), at: Date.now() });
      ctx.sync.loadStorage();
      speak(r.reply);
    } catch (err) {
      m.confirm.done = 'no';
      msgs.push({ role: 'assistant', content: (err as Error).message, error: true });
    } finally {
      busy = false;
      save(msgs);
      render();
    }
  });
  render();
  if (!SpeechRec) text.placeholder = 'Nachricht schreiben … (Spracheingabe gibt es in diesem Browser nicht)';
  if (params.get('sprechen')) {
    window.history.replaceState(null, '', '#/assistent');
    if (SpeechRec) void listen();
    else ctx.toast('Spracheingabe gibt es in diesem Browser nicht – bitte tippen.');
  }
};
