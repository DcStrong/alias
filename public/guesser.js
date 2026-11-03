export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function guesserButtons(players,activeId) {
  const choices=players.filter(player=>!player.left&&player.id!==activeId);
  return `<div role="group" aria-label="Кто первым угадал?" class="guesser-buttons">${choices.map(player=>`<button type="button" class="secondary guesser-choice" data-winner="${escapeHtml(player.id)}">${escapeHtml(player.name)}</button>`).join('')}</div>`;
}

// Keep the guard outside render(): SSE and successful actions replace all buttons.
export function createCardSubmitter({current,send,now=()=>Date.now()}) {
  let pending=false,blockedUntil=0;
  return async ({type,...data},event={})=>{
    const visible=current();
    if(event.repeat||event.detail>1||pending||now()<blockedUntil||!visible||visible.type!==type||visible.card!==data.card)return;
    pending=true;
    try {await send(type,data);} finally {pending=false;blockedUntil=now()+450;}
  };
}
