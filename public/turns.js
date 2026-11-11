import {escapeHtml as esc} from './guesser.js';

export function createSettingsDraft() {
  let draft={};
  return {
    capture(values,baseline) {
      for(const [key,value] of Object.entries(values)) {
        if(String(value)!==String(baseline[key]))draft[key]=String(value);
        else delete draft[key];
      }
    },
    values:()=>({...draft}),
    clear:()=>{draft={};}
  };
}

export function turnRoles(state) {
  const active=state.players.find(p=>p.id===state.active);
  if(!active)return '';
  let guessing;
  if(state.settings.mode==='rotating')guessing=state.players.find(p=>p.id===state.guesser)?.name;
  else if(state.settings.mode==='pair')guessing=state.players.find(p=>p.id!==active.id&&!p.left)?.name;
  else if(state.settings.mode==='teams')guessing=`команда ${active.team}: ${state.players.filter(p=>p.team===active.team&&p.id!==active.id&&!p.left).map(p=>p.name).join(', ')}`;
  else guessing='все остальные';
  return `<div class="rule turn-roles"><strong>Объясняет ${esc(active.name)} → ${state.settings.mode==='teams'||state.settings.mode==='ffa'?'угадывают':'угадывает'} ${esc(guessing||'участник вышел')}</strong></div>`;
}

export function rotationEstimate(count,cycles,seconds) {
  if(count<2)return 'Добавьте хотя бы двух игроков.';
  const turns=count*(count-1)*cycles;
  return `${turns} ходов · около ${Math.ceil(turns*seconds/60)} мин по таймерам, без передачи устройства. Каждый объясняет и угадывает по ${(count-1)*cycles} раз(а).`;
}

export function settingsMarkup(state) {
  const s=state.settings,disabled=state.you===state.host?'':'disabled';
  const select=(id,label,options)=>`<div id="${id}-field"><label for="${id}">${label}</label><select id="${id}" ${disabled}>${options}</select></div>`;
  const numbers=id=>Array.from({length:10},(_,i)=>i+1).map(n=>`<option ${s[id]===n?'selected':''}>${n}</option>`).join('');
  return `<form id="settings" class="stack">${select('mode','Режим',[['pair','Вдвоём · общий результат'],['ffa','Каждый за себя'],['teams','Команды'],['rotating','Сменные пары']].map(([id,label])=>`<option value="${id}" ${s.mode===id?'selected':''}>${label}</option>`).join(''))}${select('difficulty','Сложность слов',state.difficulties.map(d=>`<option value="${esc(d.id)}" ${s.difficulty===d.id?'selected':''}>${esc(d.label)} (${d.count})</option>`).join(''))}<p class="subtle" id="difficulty-description"></p><label class="check" id="hints-field" ${s.difficulty==='hard'?'':'hidden'}><input type="checkbox" id="hints" ${s.hints?'checked':''} ${disabled}> Подсказки — объяснение слов<span class="subtle">Объясняющий видит под словом короткое толкование. Только для сложного набора.</span></label><div class="settings">${select('seconds','Секунд на ход',[30,60,90,120].map(n=>`<option ${s.seconds===n?'selected':''}>${n}</option>`).join(''))}${select('rounds','Полных кругов',numbers('rounds'))}${select('cycles','Полных циклов',numbers('cycles'))}</div><p class="subtle" id="rotation-estimate"></p>${select('penalty','Пропуск и нарушение',`<option value="0" ${s.penalty===0?'selected':''}>Без штрафа</option><option value="1" ${s.penalty===1?'selected':''}>Штраф −1</option>`)}${disabled?'':'<button class="secondary">Сохранить правила</button>'}</form>`;
}

export function historyMarkup(state) {
  const canEdit=state.you===state.host&&['summary','finished'].includes(state.phase);
  return `<div class="history">${state.history.map(h=>`<div class="row wrap"><strong class="grow">${esc(h.word)}${h.hint?`<span class="hint">${esc(h.hint)}</span>`:''}</strong><span class="subtle">${h.result==='guess'&&h.awarded===false?'Зачёт отменён':({guess:'Угадано',skip:'Пропуск',violation:'Нарушение'})[h.result]}${h.winner?' · '+esc(h.winner):''}</span><span>${h.delta>0?'+':''}${h.delta}</span>${canEdit&&h.result==='guess'?`<button class="secondary small" data-award="${esc(h.id)}" data-awarded="${!h.awarded}">${h.awarded?'Отменить зачёт':'Восстановить'}</button>`:''}</div>`).join('')||'<p class="subtle">Нет обработанных карточек.</p>'}</div><div class="divider"></div>`;
}
